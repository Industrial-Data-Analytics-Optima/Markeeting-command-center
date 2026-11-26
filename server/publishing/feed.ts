import {
  AccessError,
  requireBrand,
  requireOwner,
  digest,
} from "../auth/core.ts";
import type { Actor } from "../auth/core.ts";
import { DeliveryError } from "./linkedin.ts";
export async function feedSource(db: D1Database, a: Actor, id: string) {
  const source = await db
    .prepare(
      "SELECT p.id,p.brand_id,p.provider_post_id,p.text,p.media_id FROM hub_posts p JOIN hub_linkedin_pages l ON l.id=p.page_id AND l.workspace_id=p.workspace_id AND l.brand_id=p.brand_id AND l.enabled=1 WHERE p.id=? AND p.workspace_id=? AND p.status='published'",
    )
    .bind(id, a.workspaceId)
    .first<{
      id: string;
      brand_id: string;
      provider_post_id: string;
      text: string;
      media_id: string | null;
    }>();
  if (!source) throw new AccessError(404, "Published post not found.");
  await requireBrand(db, a, source.brand_id);
  if (!/^urn:li:(share|ugcPost):\d+$/.test(source.provider_post_id))
    throw new AccessError(409, "This post has no usable LinkedIn identity.");
  return source;
}
export async function actingPage(db: D1Database, a: Actor, id: string) {
  const page = await db
    .prepare(
      "SELECT p.id,p.brand_id,p.organization_urn,p.connection_id,c.granted_scopes,c.status FROM hub_linkedin_pages p JOIN social_connections c ON c.id=p.connection_id AND c.workspace_id=p.workspace_id WHERE p.id=? AND p.workspace_id=? AND p.enabled=1 AND p.brand_id IS NOT NULL",
    )
    .bind(id, a.workspaceId)
    .first<{
      id: string;
      brand_id: string;
      organization_urn: string;
      connection_id: string;
      granted_scopes: string;
      status: string;
    }>();
  if (!page)
    throw new AccessError(403, "Choose a page explicitly assigned to a brand.");
  await requireBrand(db, a, page.brand_id);
  return page;
}
export async function saveFeedItem(
  db: D1Database,
  a: Actor,
  d: Record<string, unknown>,
) {
  const source = await feedSource(db, a, String(d.postId));
  if (d.action === "bookmark") {
    if (typeof d.saved !== "boolean")
      throw new AccessError(400, "Choose a valid saved state.");
    await db
      .prepare(
        d.saved
          ? "INSERT OR IGNORE INTO hub_feed_saved VALUES(?,?,?)"
          : "DELETE FROM hub_feed_saved WHERE workspace_id=? AND user_id=? AND post_id=?",
      )
      .bind(a.workspaceId, a.id, source.id)
      .run();
    return { saved: d.saved };
  }
  if (d.action === "note") {
    if (typeof d.text !== "string" || !d.text.trim() || d.text.length > 2000)
      throw new AccessError(
        400,
        "Write an internal note up to 2,000 characters.",
      );
    await db
      .prepare("INSERT INTO hub_feed_notes VALUES(?,?,?,?,?,?)")
      .bind(
        crypto.randomUUID(),
        a.workspaceId,
        source.id,
        a.id,
        d.text.trim(),
        Date.now(),
      )
      .run();
    return { ok: true };
  }
  throw new AccessError(400, "Choose a valid feed action.");
}
export async function resolveInteraction(
  db: D1Database,
  a: Actor,
  d: Record<string, unknown>,
) {
  requireOwner(a);
  if (
    typeof d.applied !== "boolean" ||
    typeof d.note !== "string" ||
    d.note.trim().length < 10 ||
    d.note.length > 500
  )
    throw new AccessError(
      400,
      "Confirm the result and record how you verified it on LinkedIn.",
    );
  const row = await db
    .prepare(
      "SELECT * FROM hub_feed_actions WHERE id=? AND workspace_id=? AND status='uncertain'",
    )
    .bind(d.id, a.workspaceId)
    .first<Action>();
  if (!row)
    throw new AccessError(
      409,
      "This interaction is no longer awaiting verification.",
    );
  await feedSource(db, a, row.post_id);
  const page = await actingPage(db, a, row.acting_page_id);
  if (row.acting_brand_id !== page.brand_id)
    throw new AccessError(
      409,
      "Restore the original page assignment before resolving this action.",
    );
  const status = d.applied ? "completed" : "failed";
  const results = await db.batch([
    db
      .prepare(
        "UPDATE hub_feed_actions SET status=?,error_message=?,updated_at=? WHERE id=? AND status='uncertain'",
      )
      .bind(
        status,
        "Verified by super admin: " + d.note.trim(),
        Date.now(),
        d.id,
      ),
    db
      .prepare(
        "INSERT INTO hub_audit(id,workspace_id,actor_id,action,target_id,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        a.workspaceId,
        a.id,
        "feed.outcome_verified",
        d.id,
        Date.now(),
      ),
  ]);
  if (!results[0].meta.changes)
    throw new AccessError(409, "This interaction was already verified.");
  return { status };
}
type Action = {
  acting_brand_id: string;
  id: string;
  kind: string;
  fingerprint: string;
  post_id: string;
  acting_page_id: string;
  status: string;
  error_message: string | null;
  updated_at: number;
};
export async function engage(
  db: D1Database,
  a: Actor,
  d: Record<string, unknown>,
  perform: (
    kind: string,
    organization: string,
    post: string,
    text: string,
  ) => Promise<string | null>,
) {
  const source = await feedSource(db, a, String(d.postId)),
    page = await actingPage(db, a, String(d.pageId)),
    kind = String(d.action),
    text = typeof d.text === "string" ? d.text.trim() : "";
  if (!["like", "unlike", "comment"].includes(kind))
    throw new AccessError(400, "Choose a valid interaction.");
  if (kind === "comment" && (!text || [...text].length > 1250))
    throw new AccessError(400, "Write a comment up to 1,250 characters.");
  const scopes = JSON.parse(page.granted_scopes) as string[];
  if (!scopes.includes("w_organization_social_feed"))
    throw new AccessError(
      409,
      "LinkedIn feed permissions have not been granted. Your super admin manages these in Connections.",
    );
  if (page.status === "reconnect_required")
    throw new AccessError(
      409,
      "This page needs connection attention before interacting.",
    );
  if (typeof d.clientKey !== "string" || !/^[-\w]{16,100}$/.test(d.clientKey))
    throw new AccessError(400, "Reopen this action before submitting.");
  const fingerprint = digest(JSON.stringify([source.id, page.id, kind, text]));
  await db
    .prepare(
      "UPDATE hub_feed_actions SET status='uncertain',error_message='Delivery was interrupted. Check LinkedIn before taking further action.' WHERE workspace_id=? AND post_id=? AND acting_page_id=? AND status='processing' AND updated_at<?",
    )
    .bind(a.workspaceId, source.id, page.id, Date.now() - 120000)
    .run();
  let old = await db
    .prepare(
      "SELECT * FROM hub_feed_actions WHERE workspace_id=? AND client_key=?",
    )
    .bind(a.workspaceId, d.clientKey)
    .first<Action>();
  if (old && old.fingerprint !== fingerprint)
    throw new AccessError(
      409,
      "This request key belongs to a different action.",
    );
  if (!old && kind === "comment")
    old = await db
      .prepare(
        "SELECT * FROM hub_feed_actions WHERE workspace_id=? AND post_id=? AND acting_page_id=? AND kind='comment' AND fingerprint=?",
      )
      .bind(a.workspaceId, source.id, page.id, fingerprint)
      .first<Action>();
  if (old && old.acting_brand_id !== page.brand_id)
    throw new AccessError(
      409,
      "The page assignment has changed since this action.",
    );
  if (
    old &&
    old.status === "processing" &&
    old.updated_at < Date.now() - 120000
  ) {
    await db
      .prepare(
        "UPDATE hub_feed_actions SET status='uncertain',error_message='Delivery was interrupted. Check LinkedIn before taking further action.' WHERE id=? AND status='processing'",
      )
      .bind(old.id)
      .run();
    old.status = "uncertain";
  }
  if (old && old.status !== "failed") return { id: old.id, status: old.status };
  if (kind !== "comment") {
    const pending = await db
      .prepare(
        "SELECT id FROM hub_feed_actions WHERE workspace_id=? AND post_id=? AND acting_page_id=? AND kind IN ('like','unlike') AND status IN ('processing','uncertain')",
      )
      .bind(a.workspaceId, source.id, page.id)
      .first();
    if (pending)
      throw new AccessError(
        409,
        "A reaction is still pending or needs checking on LinkedIn. A second action is blocked.",
      );
  }
  const id = old?.id || crypto.randomUUID(),
    now = Date.now();
  if (old) {
    const r = await db
      .prepare(
        "UPDATE hub_feed_actions SET status='processing',error_message=NULL,updated_at=?,created_by=? WHERE id=? AND status='failed'",
      )
      .bind(now, a.id, id)
      .run();
    if (!r.meta.changes)
      throw new AccessError(
        409,
        "This interaction is already being processed.",
      );
  } else {
    try {
      await db
        .prepare(
          "INSERT INTO hub_feed_actions(id,workspace_id,post_id,acting_page_id,kind,fingerprint,body,status,provider_id,error_message,created_by,created_at,updated_at,client_key,acting_brand_id) VALUES(?,?,?,?,?,?,?,'processing',NULL,NULL,?,?,?,?,?)",
        )
        .bind(
          id,
          a.workspaceId,
          source.id,
          page.id,
          kind,
          fingerprint,
          text,
          a.id,
          now,
          now,
          d.clientKey,
          page.brand_id,
        )
        .run();
    } catch {
      throw new AccessError(
        409,
        "This interaction is already being processed. Refresh the feed.",
      );
    }
  }
  try {
    const remote = await perform(
      kind,
      page.organization_urn,
      source.provider_post_id,
      text,
    );
    await db
      .prepare(
        "UPDATE hub_feed_actions SET status='completed',provider_id=?,updated_at=? WHERE id=?",
      )
      .bind(remote, Date.now(), id)
      .run();
    return { id, status: "completed" };
  } catch (e) {
    const safe = e instanceof DeliveryError && e.kind !== "uncertain",
      status = safe ? "failed" : "uncertain",
      message =
        e instanceof DeliveryError
          ? e.message
          : "The result could not be confirmed. Check LinkedIn before repeating this action.";
    await db
      .prepare(
        "UPDATE hub_feed_actions SET status=?,error_message=?,updated_at=? WHERE id=?",
      )
      .bind(status, message, Date.now(), id)
      .run();
    return { id, status, message };
  }
}

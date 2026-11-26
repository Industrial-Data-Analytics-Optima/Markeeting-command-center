import { feedSource } from "./feed.ts";
import { plannedTime, reviewAfterEdit } from "./editorial.ts";
import { AccessError, requireBrand, digest, audit } from "../auth/core.ts";
import type { Actor } from "../auth/core.ts";
export type PostRow = {
  id: string;
  workspace_id: string;
  brand_id: string;
  page_id: string | null;
  reshare_post_id: string | null;
  created_by: string;
  text: string;
  media_id: string | null;
  alt_text: string;
  status: string;
  scheduled_at: number | null;
  time_zone: string;
  version: number;
  attempts: number;
  next_attempt_at: number | null;
  lease_id: string | null;
  stage: string | null;
  provider_post_id: string | null;
  provider_image_id: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
  published_at: number | null;
  planned_at: number | null;
  editorial_status: string;
  review_mode: "feedback" | "approval";
  edited_by: string | null;
};
export async function schedulerActive(db: D1Database, now = Date.now()) {
  const r = await db
    .prepare("SELECT heartbeat_at FROM hub_scheduler WHERE id='publishing'")
    .first<{ heartbeat_at: number }>();
  return !!r && now - r.heartbeat_at < 180000;
}
export function validatePost(input: Record<string, unknown>, now = Date.now()) {
  const text = typeof input.text === "string" ? input.text : "",
    alt = typeof input.altText === "string" ? input.altText : "";
  if ([...text].length > 3000)
    throw new AccessError(
      400,
      "LinkedIn posts can contain up to 3,000 characters.",
    );
  if (alt.length > 4086)
    throw new AccessError(400, "Image description is too long.");
  const action = input.action;
  if (!["draft", "schedule", "publish"].includes(String(action)))
    throw new AccessError(400, "Choose a valid publishing action.");
  if (action !== "draft" && !text.trim())
    throw new AccessError(400, "Write something before publishing.");
  const scheduled =
    action === "publish"
      ? now
      : action === "schedule" && typeof input.scheduledAt === "string"
        ? Date.parse(input.scheduledAt)
        : null;
  if (
    action === "schedule" &&
    (scheduled === null ||
      !Number.isFinite(scheduled) ||
      scheduled < now + 60000 ||
      scheduled > now + 365 * 86400000)
  )
    throw new AccessError(
      400,
      "Choose a time at least one minute ahead and within the next year.",
    );
  const timeZone = typeof input.timeZone === "string" ? input.timeZone : "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(now);
  } catch {
    throw new AccessError(400, "Choose a valid time zone.");
  }
  return {
    text,
    alt,
    status: action === "draft" ? "draft" : "scheduled",
    scheduled,
    timeZone,
  };
}
export async function savePost(
  db: D1Database,
  a: Actor,
  input: Record<string, unknown>,
  ready: boolean,
  now = Date.now(),
) {
  if (typeof input.brandId !== "string")
    throw new AccessError(400, "Choose a brand.");
  await requireBrand(db, a, input.brandId);
  const v = validatePost(input, now),
    pageId =
      typeof input.pageId === "string" && input.pageId ? input.pageId : null,
    mediaId =
      typeof input.mediaId === "string" && input.mediaId ? input.mediaId : null;
  if (pageId) {
    const p = await db
      .prepare(
        "SELECT p.id,c.status FROM hub_linkedin_pages p JOIN social_connections c ON c.id=p.connection_id WHERE p.id=? AND p.workspace_id=? AND p.brand_id=? AND p.enabled=1",
      )
      .bind(pageId, a.workspaceId, input.brandId)
      .first<{ id: string; status: string }>();
    if (!p)
      throw new AccessError(
        403,
        "This page is not assigned to the selected brand.",
      );
    if (v.status !== "draft" && p.status === "reconnect_required")
      throw new AccessError(
        409,
        "This page needs reauthorization before publishing.",
      );
  }
  if (
    mediaId &&
    !(await db
      .prepare(
        "SELECT id FROM hub_media WHERE id=? AND workspace_id=? AND brand_id=?",
      )
      .bind(mediaId, a.workspaceId, input.brandId)
      .first())
  )
    throw new AccessError(
      403,
      "This media does not belong to the selected brand.",
    );
  if (v.status !== "draft") {
    if (!pageId)
      throw new AccessError(400, "Choose an assigned LinkedIn page.");
    if (!ready || !(await schedulerActive(db, now)))
      throw new AccessError(
        503,
        "Publishing is not active yet. Your draft can still be saved.",
      );
  }
  let reshare =
    typeof input.resharePostId === "string" && input.resharePostId
      ? input.resharePostId
      : null;
  if (input.id && input.resharePostId === undefined) {
    const saved = await db
      .prepare(
        "SELECT reshare_post_id FROM hub_posts WHERE id=? AND workspace_id=?",
      )
      .bind(input.id, a.workspaceId)
      .first<{ reshare_post_id: string | null }>();
    reshare = saved?.reshare_post_id || null;
  }
  if (reshare) {
    const source = await feedSource(db, a, reshare);
    if (source.id === input.id)
      throw new AccessError(400, "A post cannot reshare itself.");
    if (mediaId)
      throw new AccessError(
        400,
        "A native repost uses the original post's media. Remove the attachment.",
      );
  }
  let planned = plannedTime(input.plannedAt);
  const hash = digest(
    JSON.stringify([
      input.brandId,
      pageId,
      v.text,
      mediaId,
      v.alt,
      v.status,
      input.action === "publish" ? "now" : v.scheduled,
      v.timeZone,
      planned,
      reshare,
    ]),
  );
  if (input.id) {
    const old = await db
      .prepare("SELECT * FROM hub_posts WHERE id=? AND workspace_id=?")
      .bind(input.id, a.workspaceId)
      .first<PostRow>();
    if (!old) throw new AccessError(404, "Post not found.");
    await requireBrand(db, a, old.brand_id);
    if (old.brand_id !== input.brandId)
      throw new AccessError(
        400,
        "A saved post cannot be moved to another brand.",
      );
    if (!["draft", "scheduled", "failed", "cancelled"].includes(old.status))
      throw new AccessError(
        409,
        "This post cannot be edited after delivery has started.",
      );
    if (input.version !== old.version)
      throw new AccessError(
        409,
        "This post changed elsewhere. Reload before editing.",
      );
    if (input.plannedAt === undefined) planned = old.planned_at;
    const changed =
      old.text !== v.text ||
      old.media_id !== mediaId ||
      old.alt_text !== v.alt ||
      old.page_id !== pageId ||
      old.reshare_post_id !== reshare;
    const review = reviewAfterEdit(old.editorial_status, changed);
    if (
      v.status !== "draft" &&
      old.review_mode === "approval" &&
      !["none", "approved"].includes(review)
    )
      throw new AccessError(
        409,
        "This version needs approval before it can be published. Save the draft and request a review.",
      );
    const result = await db.batch([
      db
        .prepare(
          "UPDATE hub_posts SET review_decision=CASE WHEN ? THEN NULL ELSE review_decision END,reshare_post_id=?,planned_at=?,editorial_status=?,edited_by=?,reviewed_by=CASE WHEN ? THEN NULL ELSE reviewed_by END,reviewed_at=CASE WHEN ? THEN NULL ELSE reviewed_at END,created_by=?,page_id=?,text=?,media_id=?,alt_text=?,status=?,scheduled_at=?,time_zone=?,version=version+1,next_attempt_at=?,attempts=0,error_code=NULL,error_message=NULL,provider_image_id=NULL,payload_hash=?,updated_at=? WHERE id=? AND workspace_id=? AND version=? AND status IN ('draft','scheduled','failed','cancelled')",
        )
        .bind(
          changed ? 1 : 0,
          reshare,
          planned,
          review,
          changed ? a.id : old.edited_by || old.created_by,
          changed ? 1 : 0,
          changed ? 1 : 0,
          v.status === "scheduled" ? a.id : old.created_by,
          pageId,
          v.text,
          mediaId,
          v.alt,
          v.status,
          v.scheduled,
          v.timeZone,
          v.scheduled,
          hash,
          now,
          old.id,
          a.workspaceId,
          old.version,
        ),
      db
        .prepare(
          "INSERT INTO hub_post_events(id,post_id,status,message,created_at) SELECT ?,?,?,?,? WHERE changes()=1",
        )
        .bind(
          crypto.randomUUID(),
          old.id,
          v.status,
          v.status === "draft"
            ? changed && old.editorial_status !== "none"
              ? "Draft saved. Content changed; previous feedback or approval no longer covers this version."
              : "Draft saved."
            : "Delivery queued.",
          now,
        ),
    ]);
    if (!result[0].meta.changes)
      throw new AccessError(
        409,
        "Delivery has started or this post changed. Reload before editing.",
      );
    return { id: old.id };
  }
  if (
    typeof input.clientKey !== "string" ||
    !/^[-\w]{16,80}$/.test(input.clientKey)
  )
    throw new AccessError(
      400,
      "Missing request identifier. Reload the composer.",
    );
  const existing = await db
    .prepare(
      "SELECT id,payload_hash FROM hub_posts WHERE workspace_id=? AND client_key=?",
    )
    .bind(a.workspaceId, input.clientKey)
    .first<{ id: string; payload_hash: string }>();
  if (existing) {
    if (existing.payload_hash !== hash)
      throw new AccessError(
        409,
        "A previous save succeeded. Reload the post before changing it.",
      );
    return { id: existing.id };
  }
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT INTO hub_posts(id,workspace_id,brand_id,page_id,created_by,text,media_id,alt_text,status,scheduled_at,time_zone,client_key,payload_hash,next_attempt_at,created_at,updated_at,planned_at,edited_by,reshare_post_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        a.workspaceId,
        input.brandId,
        pageId,
        a.id,
        v.text,
        mediaId,
        v.alt,
        v.status,
        v.scheduled,
        v.timeZone,
        input.clientKey,
        hash,
        v.scheduled,
        now,
        now,
        planned,
        a.id,
        reshare,
      ),
    db
      .prepare(
        "INSERT INTO hub_post_events(id,post_id,status,message,created_at) VALUES(?,?,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        id,
        v.status,
        v.status === "draft" ? "Draft created." : "Delivery queued.",
        now,
      ),
    audit(db, a, "post.created", id),
  ]);
  return { id };
}
export async function cancelPost(
  db: D1Database,
  a: Actor,
  id: string,
  version: number,
) {
  const post = await db
    .prepare("SELECT * FROM hub_posts WHERE id=? AND workspace_id=?")
    .bind(id, a.workspaceId)
    .first<PostRow>();
  if (!post) throw new AccessError(404, "Post not found.");
  await requireBrand(db, a, post.brand_id);
  const now = Date.now(),
    r = await db.batch([
      db
        .prepare(
          "UPDATE hub_posts SET status='cancelled',version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=? AND status IN ('draft','scheduled','failed')",
        )
        .bind(now, id, a.workspaceId, version),
      db
        .prepare(
          "INSERT INTO hub_post_events(id,post_id,status,message,created_at) SELECT ?,?,'cancelled','Delivery cancelled.',? WHERE changes()=1",
        )
        .bind(crypto.randomUUID(), id, now),
    ]);
  if (!r[0].meta.changes)
    throw new AccessError(
      409,
      "This post changed or delivery has started. It cannot be cancelled here.",
    );
}

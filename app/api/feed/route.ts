import { env } from "../../../server/platform";
import {
  actorFor,
  listBrands,
  sameOrigin,
  AccessError,
} from "../../../server/auth/core";
import { database, json, failure, body } from "../../../server/auth/http";
import {
  actingPage,
  feedSource,
  saveFeedItem,
  engage,
  resolveInteraction,
} from "../../../server/publishing/feed";
import { connectionRuntime } from "../../../server/connections/runtime";
import {
  linkedinClient,
  DeliveryError,
} from "../../../server/publishing/linkedin";
export async function GET(request: Request) {
  try {
    const db = database(),
      a = await actorFor(db, request),
      ids = ((await listBrands(db, a)) as { id: string }[]).map((b) => b.id),
      marks = ids.map(() => "?").join(",") || "NULL";
    const posts = (
      await db
        .prepare(
          `SELECT p.id,p.brand_id,b.name brand_name,l.name page_name,p.text,p.media_id,p.alt_text,p.reshare_post_id,p.published_at,p.provider_post_id,m.likes,m.comments,m.shares,m.impressions,m.synced_at FROM hub_posts p JOIN hub_brands b ON b.id=p.brand_id JOIN hub_linkedin_pages l ON l.id=p.page_id AND l.workspace_id=p.workspace_id AND l.brand_id=p.brand_id AND l.enabled=1 LEFT JOIN hub_post_metrics m ON m.post_id=p.id WHERE p.workspace_id=? AND p.brand_id IN (${marks}) AND p.status='published' AND p.provider_post_id IS NOT NULL ORDER BY p.published_at DESC LIMIT 200`,
        )
        .bind(a.workspaceId, ...ids)
        .all<{ id: string }>()
    ).results;
    const pages = (
      await db
        .prepare(
          `SELECT p.id,p.name,p.brand_id,b.name brand_name,c.granted_scopes,c.status FROM hub_linkedin_pages p JOIN hub_brands b ON b.id=p.brand_id JOIN social_connections c ON c.id=p.connection_id AND c.workspace_id=p.workspace_id WHERE p.workspace_id=? AND p.brand_id IN (${marks}) AND p.enabled=1 ORDER BY b.name,p.name`,
        )
        .bind(a.workspaceId, ...ids)
        .all<{ granted_scopes: string }>()
    ).results.map(({ granted_scopes, ...p }) => ({
      ...p,
      canEngage:
        !!env.TOKEN_VAULT_KEY &&
        !!env.LINKEDIN_CLIENT_ID &&
        !!env.LINKEDIN_CLIENT_SECRET &&
        JSON.parse(granted_scopes).includes("w_organization_social_feed"),
    }));
    const postIds = posts.map((p) => p.id),
      pm = postIds.map(() => "?").join(",") || "NULL";
    await db
      .prepare(
        `UPDATE hub_feed_actions SET status='uncertain',error_message='Delivery was interrupted. Check LinkedIn before repeating this action.' WHERE workspace_id=? AND post_id IN (${pm}) AND status='processing' AND updated_at<?`,
      )
      .bind(a.workspaceId, ...postIds, Date.now() - 120000)
      .run();
    const saved = (
      await db
        .prepare(
          `SELECT post_id FROM hub_feed_saved WHERE workspace_id=? AND user_id=? AND post_id IN (${pm})`,
        )
        .bind(a.workspaceId, a.id, ...postIds)
        .all()
    ).results;
    const notes = (
      await db
        .prepare(
          `SELECT n.id,n.post_id,n.body,n.created_at,u.name author_name FROM hub_feed_notes n JOIN hub_users u ON u.id=n.author_id WHERE n.workspace_id=? AND n.post_id IN (${pm}) ORDER BY n.created_at DESC LIMIT 1000`,
        )
        .bind(a.workspaceId, ...postIds)
        .all()
    ).results;
    const actions = (
      await db
        .prepare(
          `SELECT f.id,f.post_id,f.acting_page_id,p.name page_name,b.name brand_name,f.kind,f.body,f.status,f.error_message,f.updated_at FROM hub_feed_actions f JOIN hub_linkedin_pages p ON p.id=f.acting_page_id AND p.enabled=1 JOIN hub_brands b ON b.id=f.acting_brand_id AND p.brand_id=f.acting_brand_id WHERE f.workspace_id=? AND f.post_id IN (${pm}) AND f.acting_brand_id IN (${marks}) ORDER BY f.updated_at DESC LIMIT 2000`,
        )
        .bind(a.workspaceId, ...postIds, ...ids)
        .all()
    ).results;
    return json({
      posts,
      pages,
      saved,
      notes,
      actions,
      canResolve: a.role === "super_admin",
      limit: 200,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const db = database(),
      a = await actorFor(db, request),
      d = await body(request);
    if (d.action === "resolve") return json(await resolveInteraction(db, a, d));
    if (["bookmark", "note"].includes(String(d.action)))
      return json(await saveFeedItem(db, a, d));
    const page = await actingPage(db, a, String(d.pageId));
    await feedSource(db, a, String(d.postId));
    if (
      !env.TOKEN_VAULT_KEY ||
      !env.LINKEDIN_CLIENT_ID ||
      !env.LINKEDIN_CLIENT_SECRET
    )
      throw new AccessError(
        503,
        "Live LinkedIn interactions will be enabled during the connections phase.",
      );
    return json(
      await engage(db, a, d, async (kind, organization, post, text) => {
        const runtime = await connectionRuntime(env);
        let token: string;
        try {
          token = await runtime.service.accessToken(
            a.workspaceId,
            page.connection_id,
          );
        } catch {
          throw new DeliveryError(
            "failed",
            "The LinkedIn connection needs attention before interacting.",
            "CONNECTION",
          );
        }
        return linkedinClient(token, env.LINKEDIN_API_VERSION).interact(
          kind,
          organization,
          post,
          text,
        );
      }),
    );
  } catch (e) {
    return failure(e);
  }
}

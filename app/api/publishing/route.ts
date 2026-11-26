import { env } from "../../../server/platform";
import { actorFor, sameOrigin, listBrands } from "../../../server/auth/core";
import { database, json, failure, body } from "../../../server/auth/http";
import { savePost, schedulerActive } from "../../../server/publishing/posts";
import { linkedinSettings } from "../../../server/publishing/linkedin-oauth";
export async function GET(request: Request) {
  try {
    const db = database(),
      a = await actorFor(db, request),
      brands = (await listBrands(db, a)) as { id: string; name: string }[],
      ids = brands.map((b) => b.id);
    const marks = ids.map(() => "?").join(",") || "NULL";
    const posts = (
      await db
        .prepare(
          `SELECT p.*,b.name AS brand_name,l.name AS page_name,m.impressions,m.clicks,m.likes,m.comments,m.shares,m.unique_impressions,m.synced_at,m.error_message AS metrics_error FROM hub_posts p JOIN hub_brands b ON b.id=p.brand_id LEFT JOIN hub_linkedin_pages l ON l.id=p.page_id AND l.workspace_id=p.workspace_id AND l.brand_id=p.brand_id AND l.enabled=1 LEFT JOIN hub_post_metrics m ON m.post_id=p.id WHERE p.workspace_id=? AND p.brand_id IN (${marks}) ORDER BY p.updated_at DESC LIMIT 200`,
        )
        .bind(a.workspaceId, ...ids)
        .all()
    ).results;
    const pages = (
      await db
        .prepare(
          `SELECT p.id,p.name,p.brand_id,c.status FROM hub_linkedin_pages p JOIN social_connections c ON c.id=p.connection_id WHERE p.workspace_id=? AND p.brand_id IN (${marks}) AND p.enabled=1 ORDER BY p.name`,
        )
        .bind(a.workspaceId, ...ids)
        .all()
    ).results;
    return json({
      posts,
      pages,
      schedulerActive: await schedulerActive(db),
      publishingConfigured: !!linkedinSettings(env),
      mediaAvailable: !!env.MEDIA,
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
      a = await actorFor(db, request);
    return json(
      await savePost(db, a, await body(request), !!linkedinSettings(env)),
      201,
    );
  } catch (e) {
    return failure(e);
  }
}

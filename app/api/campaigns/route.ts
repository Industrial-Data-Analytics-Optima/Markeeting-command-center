import { actorFor, listBrands, sameOrigin } from "../../../server/auth/core";
import { database, json, failure, body } from "../../../server/auth/http";
import { saveCampaign } from "../../../server/publishing/campaigns";
export async function GET(request: Request) {
  try {
    const db = database(),
      a = await actorFor(db, request),
      brands = (await listBrands(db, a)) as { id: string }[],
      ids = brands.map((b) => b.id),
      marks = ids.map(() => "?").join(",") || "NULL";
    const rows = (
      await db
        .prepare(
          `SELECT c.*,b.name AS brand_name FROM hub_campaign_plans c JOIN hub_brands b ON b.id=c.brand_id WHERE c.workspace_id=? AND c.brand_id IN (${marks}) ORDER BY c.updated_at DESC LIMIT 500`,
        )
        .bind(a.workspaceId, ...ids)
        .all<{ countries: string }>()
    ).results;
    const posts = (
      await db
        .prepare(
          `SELECT id,brand_id,text,status FROM hub_posts WHERE workspace_id=? AND brand_id IN (${marks}) ORDER BY updated_at DESC LIMIT 500`,
        )
        .bind(a.workspaceId, ...ids)
        .all()
    ).results;
    const links = (
      await db
        .prepare(
          `SELECT cp.campaign_id,cp.post_id FROM hub_campaign_posts cp JOIN hub_campaign_plans c ON c.id=cp.campaign_id WHERE c.workspace_id=? AND c.brand_id IN (${marks})`,
        )
        .bind(a.workspaceId, ...ids)
        .all()
    ).results;
    return json({
      campaigns: rows.map((r) => ({
        ...r,
        countries: JSON.parse(r.countries),
      })),
      posts,
      links,
      limit: 500,
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
    return json(await saveCampaign(db, a, await body(request)), 201);
  } catch (e) {
    return failure(e);
  }
}

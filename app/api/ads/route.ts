import { actorFor, listBrands, sameOrigin } from "../../../server/auth/core";
import { database, json, failure, body } from "../../../server/auth/http";
import { saveAdBuild } from "../../../server/publishing/ads";
export async function GET(request: Request) {
  try {
    const db = database(),
      a = await actorFor(db, request),
      ids = ((await listBrands(db, a)) as { id: string }[]).map((b) => b.id),
      marks = ids.map(() => "?").join(",") || "NULL";
    const builds = (
      await db
        .prepare(
          `SELECT d.*,b.name brand_name FROM hub_ad_builds d JOIN hub_brands b ON b.id=d.brand_id WHERE d.workspace_id=? AND d.brand_id IN (${marks}) ORDER BY d.updated_at DESC LIMIT 500`,
        )
        .bind(a.workspaceId, ...ids)
        .all<{ payload: string }>()
    ).results.map(({ payload, ...r }) => ({ ...r, ...JSON.parse(payload) }));
    const events = (
      await db
        .prepare(
          `SELECT e.*,u.name author_name FROM hub_ad_build_events e JOIN hub_ad_builds d ON d.id=e.build_id JOIN hub_users u ON u.id=e.author_id WHERE d.workspace_id=? AND d.brand_id IN (${marks}) ORDER BY e.created_at DESC LIMIT 2000`,
        )
        .bind(a.workspaceId, ...ids)
        .all()
    ).results;
    const briefs = (
      await db
        .prepare(
          `SELECT id,brand_id,name,platform,objective,currency FROM hub_campaign_plans WHERE workspace_id=? AND brand_id IN (${marks}) AND status<>'archived' ORDER BY name`,
        )
        .bind(a.workspaceId, ...ids)
        .all()
    ).results;
    return json({ builds, events, briefs, liveEnabled: false });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const db = database(),
      a = await actorFor(db, request);
    return json(await saveAdBuild(db, a, await body(request, 262144)), 201);
  } catch (e) {
    return failure(e);
  }
}

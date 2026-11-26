import { actorFor, listBrands, sameOrigin } from "../../../server/auth/core";
import { database, json, failure, body } from "../../../server/auth/http";
import { saveLead, leadMembers } from "../../../server/publishing/leads";
export async function GET(request: Request) {
  try {
    const db = database(),
      a = await actorFor(db, request),
      brands = (await listBrands(db, a)) as { id: string }[],
      ids = brands.map((b) => b.id),
      marks = ids.map(() => "?").join(",") || "NULL";
    const leads = (
      await db
        .prepare(
          `SELECT l.*,b.name brand_name,u.name assignee_name,c.name campaign_name FROM hub_leads l JOIN hub_brands b ON b.id=l.brand_id LEFT JOIN hub_users u ON u.id=l.assignee_id LEFT JOIN hub_campaign_plans c ON c.id=l.campaign_id WHERE l.workspace_id=? AND l.brand_id IN (${marks}) ORDER BY l.updated_at DESC LIMIT 1000`,
        )
        .bind(a.workspaceId, ...ids)
        .all()
    ).results;
    const notes = (
      await db
        .prepare(
          `SELECT n.*,u.name author_name FROM hub_lead_notes n JOIN hub_leads l ON l.id=n.lead_id JOIN hub_users u ON u.id=n.author_id WHERE l.workspace_id=? AND l.brand_id IN (${marks}) ORDER BY n.created_at DESC LIMIT 3000`,
        )
        .bind(a.workspaceId, ...ids)
        .all()
    ).results;
    const campaigns = (
      await db
        .prepare(
          `SELECT id,brand_id,name FROM hub_campaign_plans WHERE workspace_id=? AND brand_id IN (${marks}) ORDER BY name`,
        )
        .bind(a.workspaceId, ...ids)
        .all()
    ).results;
    const members = [];
    for (const b of brands)
      members.push(
        ...(await leadMembers(db, a, b.id)).map((m) => ({
          ...m,
          brand_id: b.id,
        })),
      );
    return json({ leads, notes, campaigns, members, limit: 1000 });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const db = database(),
      a = await actorFor(db, request);
    return json(await saveLead(db, a, await body(request)), 201);
  } catch (e) {
    return failure(e);
  }
}

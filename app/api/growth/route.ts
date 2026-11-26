import { actorFor, listBrands, AccessError } from "../../../server/auth/core";
import { database, json, failure } from "../../../server/auth/http";
export async function GET(request: Request) {
  try {
    const db = database(),
      a = await actorFor(db, request),
      ids = ((await listBrands(db, a)) as { id: string }[]).map((b) => b.id),
      marks = ids.map(() => "?").join(",") || "NULL",
      days = Number(new URL(request.url).searchParams.get("days") || 30);
    if (![7, 30, 90].includes(days))
      throw new AccessError(400, "Choose 7, 30 or 90 days.");
    const today = Math.floor(Date.now() / 86400000) * 86400000,
      start = new Date(today - (days - 1) * 86400000)
        .toISOString()
        .slice(0, 10),
      end = new Date(today).toISOString().slice(0, 10);
    const pages = (
        await db
          .prepare(
            `SELECT p.id,p.name,p.brand_id,b.name brand_name,s.checked_at,s.total_synced_at,s.gains_synced_at,s.audience_synced_at,s.error_message FROM hub_linkedin_pages p JOIN hub_brands b ON b.id=p.brand_id LEFT JOIN hub_page_growth_status s ON s.page_id=p.id AND s.brand_id=p.brand_id WHERE p.workspace_id=? AND p.brand_id IN (${marks}) AND p.enabled=1 ORDER BY b.name,p.name`,
          )
          .bind(a.workspaceId, ...ids)
          .all<{ id: string }>()
      ).results,
      keys = pages.map((p) => p.id),
      pm = keys.map(() => "?").join(",") || "NULL";
    const snapshots = (
      await db
        .prepare(
          `SELECT s.page_id,s.day,s.total,s.captured_at FROM hub_page_follower_snapshots s JOIN hub_linkedin_pages p ON p.id=s.page_id AND p.brand_id=s.brand_id WHERE s.workspace_id=? AND s.page_id IN (${pm}) AND s.day>=? AND s.day<=? ORDER BY s.day`,
        )
        .bind(a.workspaceId, ...keys, start, end)
        .all()
    ).results;
    const latest = (
      await db
        .prepare(
          `SELECT s.page_id,s.day,s.total,s.captured_at FROM hub_page_follower_snapshots s JOIN hub_linkedin_pages p ON p.id=s.page_id AND p.brand_id=s.brand_id WHERE s.workspace_id=? AND s.page_id IN (${pm}) AND s.day=(SELECT MAX(t.day) FROM hub_page_follower_snapshots t WHERE t.page_id=s.page_id AND t.brand_id=s.brand_id)`,
        )
        .bind(a.workspaceId, ...keys)
        .all()
    ).results;
    const gains = (
      await db
        .prepare(
          `SELECT g.page_id,g.day,g.organic,g.paid FROM hub_page_follower_gains g JOIN hub_linkedin_pages p ON p.id=g.page_id AND p.brand_id=g.brand_id WHERE g.workspace_id=? AND g.page_id IN (${pm}) AND g.day>=? AND g.day<=? ORDER BY g.day`,
        )
        .bind(a.workspaceId, ...keys, start, end)
        .all()
    ).results;
    const audience = (
      await db
        .prepare(
          `SELECT f.page_id,f.dimension,f.segment_key,f.label,f.followers,f.captured_at FROM hub_page_audience f JOIN hub_linkedin_pages p ON p.id=f.page_id AND p.brand_id=f.brand_id WHERE f.workspace_id=? AND f.page_id IN (${pm}) ORDER BY f.followers DESC`,
        )
        .bind(a.workspaceId, ...keys)
        .all()
    ).results;
    return json({
      pages,
      snapshots,
      latest,
      gains,
      audience,
      start,
      end,
      days,
      timeZone: "UTC",
    });
  } catch (e) {
    return failure(e);
  }
}

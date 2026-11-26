import { AccessError } from "../auth/core.ts";
export type Facet = {
  dimension: string;
  key: string;
  label: string;
  followers: number;
};
const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
export function followerFacets(data: Record<string, unknown>): Facet[] {
  const out: Facet[] = [];
  for (const [field, dimension, key] of [
    ["followerCountsByIndustry", "industry", "industry"],
    ["followerCountsByFunction", "job_function", "function"],
    ["followerCountsByGeoCountry", "country", "geo"],
    ["followerCountsBySeniority", "seniority", "seniority"],
    ["followerCountsByStaffCountRange", "company_size", "staffCountRange"],
  ] as const) {
    const rows = data[field];
    if (!Array.isArray(rows)) continue;
    for (const raw of rows.slice(0, 100)) {
      const row = raw as Record<string, unknown>,
        id = row[key],
        n = count(
          (row.followerCounts as Record<string, unknown> | undefined)
            ?.organicFollowerCount,
        );
      if (typeof id !== "string" || n === null) continue;
      out.push({
        dimension,
        key: id,
        label: id.startsWith("SIZE_")
          ? id.slice(5).replaceAll("_TO_", "–").replaceAll("_", " ")
          : id,
        followers: n,
      });
    }
  }
  return out;
}
export function followerDaily(
  rows: Record<string, unknown>[],
  organization: string,
  start: number,
  end: number,
) {
  const map = new Map<
    string,
    { day: string; organic: number | null; paid: number | null }
  >();
  for (const row of rows) {
    const range = row.timeRange as { start?: number; end?: number } | undefined,
      gains = row.followerGains as Record<string, unknown> | undefined;
    if (
      row.organizationalEntity !== organization ||
      typeof range?.start !== "number" ||
      typeof range.end !== "number" ||
      range.start < start ||
      range.start >= end ||
      range.end > end ||
      range.end - range.start !== 86400000 ||
      range.start % 86400000 !== 0
    )
      continue;
    const day = new Date(range.start).toISOString().slice(0, 10);
    map.set(day, {
      day,
      organic: count(gains?.organicFollowerGain),
      paid: count(gains?.paidFollowerGain),
    });
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}
export async function recordGrowth(
  db: D1Database,
  page: { id: string; workspace_id: string; brand_id: string },
  report: {
    total?: number | null;
    gains?: { day: string; organic: number | null; paid: number | null }[];
    audience?: Facet[];
    error?: string;
  },
  now = Date.now(),
) {
  if (
    report.total !== undefined &&
    report.total !== null &&
    count(report.total) === null
  )
    throw new AccessError(400, "Invalid follower total.");
  const day = new Date(now).toISOString().slice(0, 10),
    statements: D1PreparedStatement[] = [];
  if (report.total != null)
    statements.push(
      db
        .prepare(
          "INSERT INTO hub_page_follower_snapshots VALUES(?,?,?,?,?,?) ON CONFLICT(page_id,day) DO UPDATE SET brand_id=excluded.brand_id,total=excluded.total,captured_at=excluded.captured_at",
        )
        .bind(
          page.id,
          page.workspace_id,
          page.brand_id,
          day,
          report.total,
          now,
        ),
    );
  for (const g of report.gains || [])
    statements.push(
      db
        .prepare(
          "INSERT INTO hub_page_follower_gains VALUES(?,?,?,?,?,?,?) ON CONFLICT(page_id,day) DO UPDATE SET brand_id=excluded.brand_id,organic=excluded.organic,paid=excluded.paid,captured_at=excluded.captured_at",
        )
        .bind(
          page.id,
          page.workspace_id,
          page.brand_id,
          g.day,
          g.organic,
          g.paid,
          now,
        ),
    );
  if (report.audience !== undefined) {
    statements.push(
      db
        .prepare(
          "DELETE FROM hub_page_audience WHERE page_id=? AND workspace_id=?",
        )
        .bind(page.id, page.workspace_id),
    );
    for (const facet of report.audience)
      statements.push(
        db
          .prepare(
            "INSERT OR REPLACE INTO hub_page_audience VALUES(?,?,?,?,?,?,?,?)",
          )
          .bind(
            page.id,
            page.workspace_id,
            page.brand_id,
            facet.dimension,
            facet.key,
            facet.label,
            facet.followers,
            now,
          ),
      );
  }
  statements.push(
    db
      .prepare(
        "INSERT INTO hub_page_growth_status VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET brand_id=excluded.brand_id,checked_at=excluded.checked_at,total_synced_at=CASE WHEN hub_page_growth_status.brand_id=excluded.brand_id THEN COALESCE(excluded.total_synced_at,hub_page_growth_status.total_synced_at) ELSE excluded.total_synced_at END,gains_synced_at=CASE WHEN hub_page_growth_status.brand_id=excluded.brand_id THEN COALESCE(excluded.gains_synced_at,hub_page_growth_status.gains_synced_at) ELSE excluded.gains_synced_at END,audience_synced_at=CASE WHEN hub_page_growth_status.brand_id=excluded.brand_id THEN COALESCE(excluded.audience_synced_at,hub_page_growth_status.audience_synced_at) ELSE excluded.audience_synced_at END,error_message=excluded.error_message",
      )
      .bind(
        page.id,
        page.workspace_id,
        page.brand_id,
        now,
        report.total != null ? now : null,
        report.gains !== undefined ? now : null,
        report.audience !== undefined ? now : null,
        report.error || null,
      ),
  );
  await db.batch(statements);
}

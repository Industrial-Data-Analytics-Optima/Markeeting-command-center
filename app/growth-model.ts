export const dayMs = 86400000;
export const utcDay = (timestamp: number) =>
  new Date(timestamp).toISOString().slice(0, 10);
export type Snapshot = { day: string; total: number; captured_at: number };
export type Gain = { day: string; organic: number | null; paid: number | null };
export function growthSummary(
  snapshots: Snapshot[],
  gains: Gain[],
  start: string,
  end: string,
) {
  const points = snapshots
      .filter((s) => s.day >= start && s.day <= end)
      .sort((a, b) => a.day.localeCompare(b.day)),
    daily = gains.filter((g) => g.day >= start && g.day <= end),
    complete = daily.filter((g) => g.organic !== null && g.paid !== null),
    first = points[0],
    last = points.at(-1),
    net = points.length >= 2 ? last!.total - first.total : null;
  return {
    netChange: net,
    growthRate:
      net !== null && first.total > 0 ? (net / first.total) * 100 : null,
    baselineDay: first?.day || null,
    lastDay: last?.day || null,
    newFollowers: complete.length
      ? complete.reduce((sum, g) => sum + g.organic! + g.paid!, 0)
      : null,
    organic: complete.length
      ? complete.reduce((sum, g) => sum + g.organic!, 0)
      : null,
    paid: complete.length
      ? complete.reduce((sum, g) => sum + g.paid!, 0)
      : null,
    reportedDays: complete.length,
  };
}
export function leadProfileGroups(
  leads: Record<string, unknown>[],
  field: string,
) {
  const map = new Map<string, { label: string; count: number }>();
  let missing = 0;
  for (const lead of leads) {
    const label =
      typeof lead[field] === "string" ? (lead[field] as string).trim() : "";
    if (!label) {
      missing++;
      continue;
    }
    const key = label.toLocaleLowerCase("en");
    const value = map.get(key) || { label, count: 0 };
    value.count++;
    map.set(key, value);
  }
  return {
    rows: [...map.values()].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label),
    ),
    missing,
    total: leads.length,
  };
}

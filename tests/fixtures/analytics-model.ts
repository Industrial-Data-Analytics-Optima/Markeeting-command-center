import { currencyFactor } from "../../app/currency.ts";
export type MetricRow = {
  campaignId: string;
  campaign: string;
  brand: string;
  platform: string;
  date: string;
  kind: "Paid" | "Organic";
  currency: string;
  accountId: string;
  accountName: string;
  budgetCents: number;
  spendCents: number;
  impressions: number;
  clicks: number;
  reactions: number;
  comments: number;
  shares: number;
  leads: number;
  countries: {
    name: string;
    impressions: number;
    clicks: number;
    spendCents: number;
  }[];
};
export type ReportFilter = {
  brand: string;
  platform: string;
  days: number;
  kind: "Paid" | "Organic";
  endDate: string;
  search?: string;
  currency?: string;
  accountId?: string;
};
export function ratio(n: number, d: number) {
  return d > 0 ? n / d : null;
}
export function reportRows(rows: MetricRow[], filter: ReportFilter) {
  const end = Date.parse(filter.endDate + "T00:00:00Z");
  const start = end - (filter.days - 1) * 86400000;
  return rows.filter(
    (r) =>
      (filter.brand === "All brands" || r.brand === filter.brand) &&
      (filter.platform === "All platforms" || r.platform === filter.platform) &&
      r.kind === filter.kind &&
      (!filter.currency || r.currency === filter.currency) &&
      (!filter.accountId || r.accountId === filter.accountId) &&
      Date.parse(r.date + "T00:00:00Z") >= start &&
      Date.parse(r.date + "T00:00:00Z") <= end &&
      (!filter.search ||
        (r.campaign + " " + r.brand)
          .toLowerCase()
          .includes(filter.search.toLowerCase())),
  );
}
export function summarize(rows: MetricRow[]) {
  if (new Set(rows.map((r) => r.currency)).size > 1)
    throw new Error("Choose one currency before aggregating spend.");
  const factor = rows.length ? currencyFactor(rows[0].currency) : 100;
  const sum = (
    key:
      | "budgetCents"
      | "spendCents"
      | "impressions"
      | "clicks"
      | "reactions"
      | "comments"
      | "shares"
      | "leads",
  ) => rows.reduce((n, r) => n + r[key], 0);
  const impressions = sum("impressions"),
    clicks = sum("clicks"),
    spend = sum("spendCents") / factor,
    budget = sum("budgetCents") / factor;
  const reactions = sum("reactions"),
    comments = sum("comments"),
    shares = sum("shares"),
    engagements = reactions + comments + shares;
  return {
    impressions,
    clicks,
    spend,
    budget,
    remaining: Math.max(0, budget - spend),
    overspend: Math.max(0, spend - budget),
    reactions,
    comments,
    shares,
    engagements,
    leads: sum("leads"),
    ctr: ratio(clicks * 100, impressions),
    engagementRate: ratio(engagements * 100, impressions),
    cpc: ratio(spend, clicks),
    cpm: ratio(spend * 1000, impressions),
    cpl: ratio(spend, sum("leads")),
    budgetUsed: ratio(spend * 100, budget),
  };
}
export function countryReport(rows: MetricRow[]) {
  if (new Set(rows.map((r) => r.currency)).size > 1)
    throw new Error("Choose one currency before aggregating country spend.");
  const countries = new Map<
    string,
    { name: string; impressions: number; clicks: number; spend: number }
  >();
  for (const row of rows)
    for (const c of row.countries) {
      const current = countries.get(c.name) || {
        name: c.name,
        impressions: 0,
        clicks: 0,
        spend: 0,
      };
      current.impressions += c.impressions;
      current.clicks += c.clicks;
      current.spend += c.spendCents / currencyFactor(row.currency);
      countries.set(c.name, current);
    }
  return [...countries.values()].sort((a, b) => b.impressions - a.impressions);
}
// Demonstration records only. Never substitute these fixtures for a missing provider result.
export function sampleMetrics(endDate: string): MetricRow[] {
  const campaigns = [
    {
      currency: "ZAR",
      brand: "IDAO",
      platform: "LinkedIn",
      campaign: "Skills for your next chapter",
      daily: 15000,
      base: 2450,
    },
    {
      currency: "ZAR",
      brand: "IDAO",
      platform: "Facebook",
      campaign: "November open day",
      daily: 9000,
      base: 3700,
    },
    {
      currency: "USD",
      brand: "Optimaviz",
      platform: "LinkedIn",
      campaign: "Decisions backed by data",
      daily: 18000,
      base: 2100,
    },
    {
      currency: "USD",
      brand: "Nestwise",
      platform: "Instagram",
      campaign: "A place to call yours",
      daily: 12000,
      base: 4800,
    },
  ];
  const result: MetricRow[] = [];
  for (let i = 0; i < 180; i++)
    for (const [index, c] of campaigns.entries())
      for (const kind of ["Paid", "Organic"] as const) {
        const date = new Date(Date.parse(endDate + "T00:00:00Z") - i * 86400000)
          .toISOString()
          .slice(0, 10);
        const factor = 0.65 + ((i * 7 + index * 11) % 19) / 30;
        const impressions = Math.round(
          c.base * factor * (kind === "Paid" ? 1 : 0.32),
        );
        const clicks = Math.round(impressions * (0.021 + index * 0.003));
        const spendCents =
          kind === "Paid"
            ? Math.round(c.daily * (0.57 + ((i + index) % 9) * 0.035))
            : 0;
        const weights = [0.54, 0.22, 0.11, 0.08, 0.05],
          names = [
            "Malaysia",
            "Singapore",
            "Indonesia",
            "Australia",
            "Other / unknown",
          ];
        const split = (total: number) => {
          const parts = weights.map((w) => Math.floor(total * w));
          parts[4] += total - parts.reduce((a, b) => a + b, 0);
          return parts;
        };
        const imps = split(impressions),
          cls = split(clicks),
          cost = split(spendCents);
        result.push({
          campaignId: index + "-" + kind,
          campaign: kind === "Paid" ? c.campaign : c.brand + " page content",
          brand: c.brand,
          platform: c.platform,
          date,
          kind,
          currency: c.currency,
          accountId: "sample-account-" + index,
          accountName: c.brand + " · " + c.platform + " · " + c.currency,
          budgetCents: kind === "Paid" ? c.daily : 0,
          spendCents,
          impressions,
          clicks,
          reactions: Math.round(impressions * 0.026),
          comments: Math.round(impressions * 0.003),
          shares: Math.round(impressions * 0.002),
          leads: kind === "Paid" ? Math.round(clicks * 0.06) : 0,
          countries: names.map((name, j) => ({
            name,
            impressions: imps[j],
            clicks: cls[j],
            spendCents: cost[j],
          })),
        });
      }
  return result;
}

import { sampleMetrics, summarize, ratio } from "./analytics-model.ts";
import type { MetricRow } from "./analytics-model";
export type Performance = {
  impressions: number;
  clicks: number;
  reactions: number;
  comments: number;
  shares: number;
  saves: number | null;
  followersGained: number;
  followersLost: number;
  publishedPosts: number;
};
export type OrganicRow = Performance & {
  pageId: string;
  pageName: string;
  brand: string;
  platform: string;
  date: string;
  countries: { name: string; impressions: number }[];
};
export type OrganicPost = OrganicRow & {
  id: string;
  text: string;
  format: string;
  image?: string;
};
export type Filters = {
  brand: string;
  platform: string;
  start: string;
  end: string;
  pageId?: string;
  search?: string;
};
export function periodRange(end: string, days: number) {
  return {
    start: new Date(Date.parse(end + "T00:00:00Z") - (days - 1) * 86400000)
      .toISOString()
      .slice(0, 10),
    end,
  };
}
export function previousRange(start: string, end: string) {
  const duration =
    Date.parse(end + "T00:00:00Z") -
    Date.parse(start + "T00:00:00Z") +
    86400000;
  return {
    start: new Date(Date.parse(start + "T00:00:00Z") - duration)
      .toISOString()
      .slice(0, 10),
    end: new Date(Date.parse(start + "T00:00:00Z") - 86400000)
      .toISOString()
      .slice(0, 10),
  };
}
export function change(current: number, previous: number) {
  return previous === 0 ? null : ((current - previous) / previous) * 100;
}
export function performance(rows: Partial<Performance>[]) {
  const sum = (key: keyof Performance) =>
    rows.reduce((n, r) => n + (r[key] ?? 0), 0);
  const impressions = sum("impressions"),
    clicks = sum("clicks"),
    reactions = sum("reactions"),
    comments = sum("comments"),
    shares = sum("shares"),
    saves = rows.some((r) => r.saves != null) ? sum("saves") : null;
  const engagements = reactions + comments + shares + (saves ?? 0);
  return {
    impressions,
    clicks,
    reactions,
    comments,
    shares,
    saves,
    engagements,
    engagementRate: ratio(engagements * 100, impressions),
    ctr: ratio(clicks * 100, impressions),
    netFollowers: sum("followersGained") - sum("followersLost"),
    followersGained: sum("followersGained"),
    followersLost: sum("followersLost"),
    publishedPosts: sum("publishedPosts"),
  };
}
export function organicRows<T extends OrganicRow>(rows: T[], f: Filters) {
  return rows.filter(
    (r) =>
      (f.brand === "All brands" || r.brand === f.brand) &&
      (f.platform === "All platforms" || r.platform === f.platform) &&
      (!f.pageId || r.pageId === f.pageId) &&
      r.date >= f.start &&
      r.date <= f.end &&
      (!f.search ||
        (r.brand + " " + r.pageName)
          .toLowerCase()
          .includes(f.search.toLowerCase())),
  );
}
export function paidRows(
  rows: MetricRow[],
  f: Filters & { accountId?: string; currency?: string },
) {
  return rows.filter(
    (r) =>
      r.kind === "Paid" &&
      (f.brand === "All brands" || r.brand === f.brand) &&
      (f.platform === "All platforms" || r.platform === f.platform) &&
      (!f.accountId || r.accountId === f.accountId) &&
      (!f.currency || r.currency === f.currency) &&
      r.date >= f.start &&
      r.date <= f.end &&
      (!f.search ||
        (r.campaign + " " + r.brand)
          .toLowerCase()
          .includes(f.search.toLowerCase())),
  );
}
export function moneyGroups(rows: MetricRow[]) {
  return [...new Set(rows.map((r) => r.currency))].sort().map((currency) => {
    const group = rows.filter((r) => r.currency === currency);
    return {
      currency,
      accounts: new Set(group.map((r) => r.accountId)).size,
      ...summarize(group),
    };
  });
}
export function audienceCountries(
  rows: { countries: { name: string; impressions: number }[] }[],
) {
  const out = new Map<string, number>();
  for (const r of rows)
    for (const c of r.countries)
      out.set(c.name, (out.get(c.name) || 0) + c.impressions);
  return [...out]
    .map(([name, impressions]) => ({ name, impressions }))
    .sort((a, b) => b.impressions - a.impressions);
}
export function exportOrganic(rows: OrganicRow[]) {
  return rows.map(({ countries, ...r }) => ({
    ...r,
    ...performance([r]),
    dataSource: "Demo data",
  }));
}
export function demoReporting(end: string) {
  const raw = sampleMetrics(end);
  const organic: OrganicRow[] = raw
    .filter((r) => r.kind === "Organic")
    .map((r, i) => ({
      pageId: r.accountId.replace("account", "page"),
      pageName: r.brand + " · " + r.platform,
      brand: r.brand,
      platform: r.platform,
      date: r.date,
      impressions: r.impressions,
      clicks: r.clicks,
      reactions: r.reactions,
      comments: r.comments,
      shares: r.shares,
      saves: r.platform === "Instagram" ? Math.round(r.reactions * 0.24) : null,
      followersGained: 4 + (i % 11),
      followersLost: i % 3,
      publishedPosts: 1,
      countries: r.countries.map(({ name, impressions }) => ({
        name,
        impressions,
      })),
    }));
  const copy: Record<string, string[]> = {
    IDAO: [
      "Build skills that open doors. Your next chapter starts here.",
      "Meet the people turning ambition into opportunity.",
      "One small step today. A different tomorrow.",
    ],
    Optimaviz: [
      "Your data has a story. Here’s how to find it.",
      "From reporting to real decisions.",
      "Better questions. Clearer answers.",
    ],
    Nestwise: [
      "A place for your next chapter.",
      "Small details. Better living.",
      "Make room for the everyday moments.",
    ],
  };
  const posts: OrganicPost[] = organic.map((r, i) => ({
    ...r,
    id: r.pageId + "-" + r.date,
    text: (copy[r.brand] || ["A new chapter."])[i % 3],
    format: ["Image", "Text", "Carousel"][i % 3],
    image:
      i % 3 === 1
        ? undefined
        : r.brand === "IDAO"
          ? "/team.jpg"
          : r.brand === "Nestwise"
            ? "/home.jpg"
            : "/chart-creative.svg",
  }));
  return { organic, paid: raw.filter((r) => r.kind === "Paid"), posts };
}

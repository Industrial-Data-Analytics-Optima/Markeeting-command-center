import { useEffect, useState } from "react";
import { PublishingWorkspace } from "./publishing-workspace";
import {
  growthSummary,
  leadProfileGroups,
  utcDay,
  dayMs,
  Snapshot,
  Gain,
} from "./growth-model";
import { download } from "./workspace-model";
type Brand = { id: string; name: string };
type Page = {
  id: string;
  name: string;
  brand_id: string;
  brand_name: string;
  checked_at: number | null;
  total_synced_at: number | null;
  gains_synced_at: number | null;
  audience_synced_at: number | null;
  error_message: string | null;
};
type Data = {
  pages: Page[];
  snapshots: (Snapshot & { page_id: string })[];
  latest: (Snapshot & { page_id: string })[];
  gains: (Gain & { page_id: string })[];
  audience: {
    page_id: string;
    dimension: string;
    segment_key: string;
    label: string;
    followers: number;
    captured_at: number;
  }[];
  start: string;
  end: string;
  days: number;
};
const num = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-GB");
const dimensions = [
  ["industry", "Industries"],
  ["job_function", "Job functions"],
  ["country", "Countries"],
  ["seniority", "Seniority"],
  ["company_size", "Company sizes"],
];
async function get<T>(url: string) {
  const r = await fetch(url, { cache: "no-store" }),
    d = (await r.json()) as T & { message?: string };
  if (!r.ok) throw new Error(d.message || "Could not load analytics.");
  return d;
}
export function AnalyticsWorkspace({
  brands,
  openLeads,
}: {
  brands: Brand[];
  openLeads: () => void;
}) {
  const [tab, setTab] = useState("Growth & audience");
  return (
    <section>
      <div className="growth-tabs" role="tablist" aria-label="Analytics report">
        {["Growth & audience", "Post performance", "Lead profiles"].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Post performance" ? (
        <PublishingWorkspace brands={brands} analytics />
      ) : tab === "Lead profiles" ? (
        <LeadProfiles brands={brands} openLeads={openLeads} />
      ) : (
        <PageGrowth brands={brands} />
      )}
    </section>
  );
}
function PageGrowth({ brands }: { brands: Brand[] }) {
  const [data, setData] = useState<Data | null>(null),
    [days, setDays] = useState(30),
    [brand, setBrand] = useState(""),
    [pageId, setPageId] = useState(""),
    [dimension, setDimension] = useState("industry"),
    [mode, setMode] = useState("total"),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    get<Data>("/api/growth?days=" + days)
      .then((d) => {
        if (active) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [days]);
  const pages = (data?.pages || []).filter(
    (p) => !brand || p.brand_id === brand,
  );
  useEffect(() => {
    if (!pages.some((p) => p.id === pageId)) setPageId(pages[0]?.id || "");
  }, [data, brand]);
  const page = pages.find((p) => p.id === pageId),
    snapshots = (data?.snapshots || []).filter((s) => s.page_id === pageId),
    gains = (data?.gains || []).filter((g) => g.page_id === pageId),
    latest = data?.latest.find((s) => s.page_id === pageId),
    summary = growthSummary(
      snapshots,
      gains,
      data?.start || "",
      data?.end || "",
    ),
    facets = (data?.audience || []).filter(
      (f) => f.page_id === pageId && f.dimension === dimension,
    ),
    facetTotal = facets.reduce((sum, f) => sum + f.followers, 0),
    series = data
      ? Array.from({ length: data.days }, (_, i) => {
          const day = utcDay(Date.parse(data.start) + i * dayMs),
            s = snapshots.find((s) => s.day === day),
            g = gains.find((g) => g.day === day);
          return {
            day,
            total: s?.total ?? null,
            organic: g?.organic ?? null,
            paid: g?.paid ?? null,
            gained:
              g && g.organic !== null && g.paid !== null
                ? g.organic + g.paid
                : null,
          };
        })
      : [];
  const trend = series.map((s) => ({
      day: s.day,
      value: mode === "total" ? s.total : s.gained,
    })),
    known = trend.filter((s) => s.value !== null),
    min =
      mode === "total" && known.length
        ? Math.min(...known.map((s) => s.value!))
        : 0,
    max = known.length ? Math.max(...known.map((s) => s.value!)) : 0,
    span = Math.max(1, max - min);
  let lift = true;
  const path = trend
    .map((s, i) => {
      if (s.value === null) {
        lift = true;
        return "";
      }
      const p =
        (lift ? "M" : "L") +
        (40 + (i / Math.max(1, trend.length - 1)) * 720).toFixed(1) +
        "," +
        (165 - ((s.value - min) / span) * 130).toFixed(1);
      lift = false;
      return p;
    })
    .join(" ");
  return (
    <section className="growth-workspace">
      <header className="leads-heading">
        <div>
          <p className="ed-muted">PAGE GROWTH & AUDIENCE</p>
          <h1>Page growth & audience.</h1>
          <p>
            Follower growth over time, with professional audience insights where
            available.
          </p>
        </div>
      </header>
      <div className="growth-toolbar">
        <select
          aria-label="Growth brand"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
        >
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Growth page"
          value={pageId}
          onChange={(e) => setPageId(e.target.value)}
          disabled={!pages.length}
        >
          {!pages.length && <option value="">No selected pages</option>}
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.brand_name} · {p.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Growth date range"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {[7, 30, 90].map((n) => (
            <option key={n} value={n}>
              Past {n} days
            </option>
          ))}
        </select>
        <button
          disabled={
            !page || (!snapshots.length && !gains.length) || data?.days !== days
          }
          onClick={() =>
            download(
              "page-follower-growth.csv",
              series.map((s) => ({
                brand: page?.brand_name,
                page: page?.name,
                dayUTC: s.day,
                totalFollowers: s.total,
                newOrganic: s.organic,
                newPaid: s.paid,
                newFollowers: s.gained,
              })),
            )
          }
        >
          Export growth
        </button>
      </div>
      {data && data.days !== days && (
        <p role="status" className="growth-data-note">
          Loading the selected date range…
        </p>
      )}
      {error && (
        <p className="secure-error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <div className="leads-empty">Loading page growth…</div>
      ) : !page ? (
        <div className="leads-empty">
          <h2>Your audience story starts with a selected page.</h2>
          <p>
            Growth tracking will collect follower totals and available audience
            breakdowns after your super admin’s selected pages are activated. No
            follower figures are estimated.
          </p>
        </div>
      ) : (
        <>
          <div className="growth-context">
            <b>
              {page.brand_name} · {page.name}
            </b>
            <span>
              LinkedIn · {data.start} to {data.end} · UTC
            </span>
          </div>
          {page.error_message && (
            <p className="growth-data-note">
              {page.error_message} Previously collected figures remain
              available.
            </p>
          )}
          <div className="growth-kpis">
            <article>
              <span>FOLLOWER TOTAL</span>
              <strong>{num(latest?.total)}</strong>
              <small>
                {latest
                  ? "Observed " + new Date(latest.captured_at).toLocaleString()
                  : "Awaiting first total snapshot"}
              </small>
            </article>
            <article>
              <span>REPORTED NEW FOLLOWERS</span>
              <strong>{num(summary.newFollowers)}</strong>
              <small>
                {summary.reportedDays}/{data.days} days reported · organic{" "}
                {num(summary.organic)} / paid {num(summary.paid)}
              </small>
            </article>
            <article>
              <span>OBSERVED NET CHANGE</span>
              <strong>
                {summary.netChange !== null && summary.netChange > 0 ? "+" : ""}
                {num(summary.netChange)}
              </strong>
              <small>
                {summary.netChange !== null
                  ? summary.baselineDay + " → " + summary.lastDay
                  : "Needs two recorded totals in this window"}
              </small>
            </article>
            <article>
              <span>OBSERVED GROWTH RATE</span>
              <strong>
                {summary.growthRate !== null
                  ? (summary.growthRate > 0 ? "+" : "") +
                    summary.growthRate.toFixed(1) +
                    "%"
                  : "—"}
              </strong>
              <small>
                Change relative to the first recorded total in this window
              </small>
            </article>
          </div>
          <div className="growth-chart">
            <header>
              <div>
                <h2>Follower trend</h2>
                <p>
                  Missing observations stay empty. Provider-reported gains can
                  arrive later than follower totals.
                </p>
              </div>
              <div>
                <button
                  className={mode === "total" ? "active" : ""}
                  onClick={() => setMode("total")}
                >
                  Follower total
                </button>
                <button
                  className={mode === "gained" ? "active" : ""}
                  onClick={() => setMode("gained")}
                >
                  New followers
                </button>
              </div>
            </header>
            {known.length ? (
              <svg
                viewBox="0 0 800 210"
                role="img"
                aria-label={
                  mode === "total"
                    ? "Recorded follower totals. Missing days are gaps."
                    : "Reported new followers by day. Missing days are gaps."
                }
              >
                <text x="3" y="38">
                  {num(max)}
                </text>
                <text x="3" y="168">
                  {num(min)}
                </text>
                <line x1="40" x2="760" y1="165" y2="165" stroke="#e3e9d9" />
                <path d={path} fill="none" stroke="#6d9251" strokeWidth="2.5" />
                {trend.map((s, i) =>
                  s.value === null ? null : (
                    <circle
                      key={s.day}
                      cx={40 + (i / Math.max(1, trend.length - 1)) * 720}
                      cy={165 - ((s.value - min) / span) * 130}
                      r="3"
                      fill="#6d9251"
                    >
                      <title>
                        {s.day}: {s.value} followers
                      </title>
                    </circle>
                  ),
                )}
                <text x="40" y="200">
                  {data.start}
                </text>
                <text x="760" y="200" textAnchor="end">
                  {data.end}
                </text>
              </svg>
            ) : (
              <div className="growth-chart-empty">
                <h3>Waiting for recorded growth.</h3>
                <p>
                  Totals build a trend from the first successful sync. Daily
                  gains use the history supplied by the platform.
                </p>
              </div>
            )}
            <details>
              <summary>View daily figures</summary>
              <div className="growth-table">
                <table>
                  <thead>
                    <tr>
                      <th>Date (UTC)</th>
                      <th>Total observed</th>
                      <th>New organic</th>
                      <th>New paid</th>
                      <th>New followers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {series.map((s) => (
                      <tr key={s.day}>
                        <td>{s.day}</td>
                        <td>{num(s.total)}</td>
                        <td>{num(s.organic)}</td>
                        <td>{num(s.paid)}</td>
                        <td>{num(s.gained)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
          <section className="growth-audience">
            <header>
              <div>
                <p className="ed-muted">
                  AGGREGATE FOLLOWERS · LATEST SNAPSHOT
                </p>
                <h2>Who follows your page.</h2>
                <p>
                  Audience composition is a current snapshot, independent of the
                  growth date range.
                </p>
              </div>
              <select
                aria-label="Audience breakdown"
                value={dimension}
                onChange={(e) => setDimension(e.target.value)}
              >
                {dimensions.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </header>
            {facets.length ? (
              <>
                <div className="growth-segments">
                  {facets.slice(0, 20).map((f) => (
                    <div key={f.segment_key}>
                      <div>
                        <b>
                          {f.label.startsWith("urn:")
                            ? "Label unavailable · " + f.segment_key
                            : f.label}
                        </b>
                        <span>
                          {num(f.followers)} ·{" "}
                          {facetTotal
                            ? ((f.followers / facetTotal) * 100).toFixed(1) +
                              "%"
                            : "—"}
                        </span>
                      </div>
                      <progress
                        value={f.followers}
                        max={Math.max(1, facetTotal)}
                      />
                    </div>
                  ))}
                </div>
                <button
                  onClick={() =>
                    download(
                      "follower-audience.csv",
                      facets.map((f) => ({
                        brand: page.brand_name,
                        page: page.name,
                        dimension: f.dimension,
                        label: f.label,
                        segmentId: f.segment_key,
                        followers: f.followers,
                        asOfUTC: new Date(f.captured_at).toISOString(),
                      })),
                    )
                  }
                >
                  Export this breakdown
                </button>
                <small>
                  Showing the top {Math.min(20, facets.length)} of{" "}
                  {facets.length} returned segments. Percentages refer to
                  returned segments, not every follower. Privacy thresholds and
                  reporting limits can omit data.
                </small>
              </>
            ) : (
              <div className="growth-chart-empty">
                <h3>No audience breakdown available yet.</h3>
                <p>
                  Industry, job function, seniority, country and company-size
                  details appear only when the platform supplies them.
                </p>
              </div>
            )}
            <footer>
              {page.audience_synced_at
                ? "Snapshot checked " +
                  new Date(page.audience_synced_at).toLocaleString()
                : "Awaiting audience sync"}{" "}
              · Aggregate audience information does not identify individual
              followers or create lead records.
            </footer>
          </section>
          <p className="growth-data-note">
            New followers and net change are different measures. Net change
            compares actual stored totals over the dates shown and can include
            removals or platform corrections. Unfollows are unavailable unless
            explicitly supplied; they are not inferred.
          </p>
        </>
      )}
    </section>
  );
}
type LeadProfile = {
  id: string;
  brand_id: string;
  name: string;
  company: string;
  industry: string;
  job_title: string;
  country: string;
  company_size: string;
  campaign_id: string | null;
  campaign_name: string;
  profile_source: string;
};
function LeadProfiles({
  brands,
  openLeads,
}: {
  brands: Brand[];
  openLeads: () => void;
}) {
  const [data, setData] = useState<{
      leads: LeadProfile[];
      campaigns: { id: string; brand_id: string; name: string }[];
    } | null>(null),
    [brand, setBrand] = useState(""),
    [campaign, setCampaign] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    get<NonNullable<typeof data>>("/api/leads")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  const leads = (data?.leads || []).filter(
    (l) =>
      (!brand || l.brand_id === brand) &&
      (!campaign || l.campaign_id === campaign),
  );
  return (
    <section>
      <header className="leads-heading">
        <div>
          <p className="ed-muted">LEAD PROFILES</p>
          <h1>Lead profiles.</h1>
          <p>
            Professional details from saved lead records. These are separate
            from follower demographics.
          </p>
        </div>
        <button className="primary" onClick={openLeads}>
          Manage leads
        </button>
      </header>
      <div className="growth-toolbar">
        <select
          aria-label="Lead profile brand"
          value={brand}
          onChange={(e) => {
            setBrand(e.target.value);
            setCampaign("");
          }}
        >
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Lead profile campaign"
          value={campaign}
          onChange={(e) => setCampaign(e.target.value)}
        >
          <option value="">All campaigns</option>
          {data?.campaigns
            .filter((c) => !brand || c.brand_id === brand)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        <button
          disabled={!leads.length}
          onClick={() =>
            download(
              "lead-professional-profiles.csv",
              leads.map((l) => ({
                name: l.name,
                company: l.company,
                industry: l.industry,
                jobTitle: l.job_title,
                country: l.country,
                companySize: l.company_size,
                campaign: l.campaign_name,
                profileSource: l.profile_source,
              })),
            )
          }
        >
          Export lead profiles
        </button>
      </div>
      {error && <p className="secure-error">{error}</p>}
      <p className="growth-data-note">
        {leads.length} matching records from the latest 1,000 leads. Missing
        details remain unknown. Manual entries are labelled as such; automatic
        form-answer import will be enabled during integrations.
      </p>
      <div className="growth-profile-grid">
        {[
          ["industry", "Industries / fields"],
          ["job_title", "Job titles"],
          ["country", "Countries / regions"],
          ["company_size", "Company sizes"],
        ].map(([field, label]) => {
          const group = leadProfileGroups(
            leads as unknown as Record<string, unknown>[],
            field,
          );
          return (
            <article className="growth-audience" key={field}>
              <h2>{label}</h2>
              {!data ? (
                <p>Loading…</p>
              ) : group.rows.length ? (
                <div className="growth-segments">
                  {group.rows.slice(0, 10).map((row) => (
                    <div key={row.label}>
                      <div>
                        <b>{row.label}</b>
                        <span>{row.count} leads</span>
                      </div>
                      <progress
                        max={Math.max(1, group.total)}
                        value={row.count}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="ed-muted">
                  No recorded details for this field yet.
                </p>
              )}
              <small>
                {group.missing} of {group.total} records have no value for this
                field.
              </small>
            </article>
          );
        })}
      </div>
      <div className="growth-table">
        <table>
          <thead>
            <tr>
              <th>Lead</th>
              <th>Company</th>
              <th>Job title</th>
              <th>Industry / field</th>
              <th>Country</th>
              <th>Detail source</th>
            </tr>
          </thead>
          <tbody>
            {leads.slice(0, 50).map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>{l.company || "—"}</td>
                <td>{l.job_title || "—"}</td>
                <td>{l.industry || "—"}</td>
                <td>{l.country || "—"}</td>
                <td>
                  {l.profile_source === "manual"
                    ? "Team entry"
                    : l.profile_source}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

import { useEffect, useState } from "react";
import { Modal, Icon } from "./ui";
import { formatMoney } from "./currency";
import { download } from "./workspace-model";
import {
  budgetGroups,
  parseBudget,
  campaignCountries,
  campaignCurrencies,
} from "./campaign-model";
import type { CampaignPlan } from "./campaign-model";
type Brand = { id: string; name: string };
type Content = { id: string; brand_id: string; text: string; status: string };
type CampaignData = {
  campaigns: CampaignPlan[];
  posts: Content[];
  links: { campaign_id: string; post_id: string }[];
  limit: number;
};
async function call<T>(body?: unknown) {
  const r = await fetch("/api/campaigns", {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    d = (await r.json()) as T & { message?: string };
  if (!r.ok)
    throw new Error(d.message || "Could not save the campaign. Please retry.");
  return d;
}
export function CampaignWorkspace({ brands }: { brands: Brand[] }) {
  const [data, setData] = useState<CampaignData | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [filter, setFilter] = useState("active"),
    [brand, setBrand] = useState(""),
    [search, setSearch] = useState(""),
    [editing, setEditing] = useState<CampaignPlan | "new" | null>(null);
  async function load() {
    try {
      setData(await call<CampaignData>());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  const rows = (data?.campaigns || []).filter(
      (c) =>
        (!brand || c.brand_id === brand) &&
        (!search ||
          (c.name + " " + c.brief + " " + c.brand_name)
            .toLowerCase()
            .includes(search.toLowerCase())) &&
        (filter === "active" ? c.status !== "archived" : c.status === filter),
    ),
    groups = budgetGroups(rows);
  function exportPlans() {
    download(
      "campaign-plans.csv",
      rows.map((c) => ({
        name: c.name,
        brand: c.brand_name,
        status: c.status,
        platform: c.platform,
        objective: c.objective,
        currency: c.currency,
        plannedBudget: c.budget_minor == null ? "" : c.budget_minor / 100,
        budgetBasis: c.budget_basis,
        startDate: c.start_date,
        endDate: c.end_date,
        countries: c.countries
          .map(
            (code) => campaignCountries.find(([k]) => k === code)?.[1] || code,
          )
          .join("; "),
        audience: c.audience,
        brief: c.brief,
        destination: c.destination,
        dataType: "Campaign plan — not live delivery or spend",
      })),
    );
  }
  return (
    <div className="campaign-workspace">
      <div className="lp-intro">
        <div>
          <span className="a-eyebrow">CAMPAIGN PLANNING</span>
          <h1>Give every campaign a clear purpose.</h1>
          <p>
            Bring the objective, audience, budget and content together before
            activation.
          </p>
        </div>
        <button
          className="primary"
          disabled={!brands.length || !data}
          onClick={() => setEditing("new")}
        >
          <Icon name="plus" />
          New campaign
        </button>
      </div>
      <div className="cp-context">
        <span>PLANNING WORKSPACE</span>
        <p>
          These are saved campaign plans. Marking a plan ready does not launch
          ads or spend money.
        </p>
      </div>
      {error && (
        <div className="access-error" role="alert">
          {error}
          <button onClick={load}>Retry</button>
        </div>
      )}
      {notice && (
        <div className="secure-notice" role="status">
          {notice}
          <button onClick={() => setNotice("")} aria-label="Dismiss notice">
            ×
          </button>
        </div>
      )}
      <div className="cp-budget-strip">
        {groups.length ? (
          groups.map((g) => (
            <article key={g.currency + g.basis}>
              <span>
                {g.currency} ·{" "}
                {g.basis === "daily" ? "Daily budgets" : "Total budgets"}
              </span>
              <strong>
                {formatMoney(g.minor / 100, g.currency)}
                {g.basis === "daily" && <small>/ day</small>}
              </strong>
              <p>
                {g.plans} non-archived plan{g.plans === 1 ? "" : "s"} · proposed
                allocation
                {g.basis === "daily" ? "; plan dates may not overlap" : ""}
              </p>
            </article>
          ))
        ) : (
          <article className="cp-budget-empty">
            <span>BUDGET OVERVIEW</span>
            <strong>A budget for each ambition.</strong>
            <p>
              Planned amounts will appear here, grouped by currency and daily or
              total budget.
            </p>
          </article>
        )}
      </div>
      <div className="lp-toolbar">
        <div className="lp-tablist" role="tablist" aria-label="Campaign status">
          {[
            ["active", "All plans"],
            ["draft", "Draft"],
            ["ready", "Ready"],
            ["archived", "Archived"],
          ].map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={filter === value}
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="lp-filters">
          <select
            aria-label="Campaign brand"
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
          <input
            aria-label="Find campaign"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a campaign…"
          />
          <button disabled={!rows.length} onClick={exportPlans}>
            Export plans ↗
          </button>
          <button aria-label="Refresh campaigns" onClick={load}>
            ↻
          </button>
        </div>
      </div>
      {!data ? (
        <div className="secure-empty">
          <h3>Loading campaign plans…</h3>
        </div>
      ) : !rows.length ? (
        <div className="lp-empty">
          <div className="lp-empty-symbol">↗</div>
          <h2>
            {data.campaigns.length
              ? "No plans in this view."
              : "Start with the outcome you want."}
          </h2>
          <p>
            {data.campaigns.length
              ? "Try another brand, status or search."
              : "Create a brief, set the audience and choose a budget in its own currency. Add existing brand posts when they are ready."}
          </p>
          {!data.campaigns.length && (
            <button
              className="primary"
              disabled={!brands.length}
              onClick={() => setEditing("new")}
            >
              Create a campaign plan →
            </button>
          )}
        </div>
      ) : (
        <div className="cp-cards">
          {rows.map((c) => (
            <article key={c.id}>
              <header>
                <span>{c.brand_name}</span>
                <b
                  className={
                    "ed-pill " + (c.status === "ready" ? "approved" : "")
                  }
                >
                  {c.status === "ready" ? "Ready for activation" : c.status}
                </b>
              </header>
              <h2>{c.name}</h2>
              <p className="cp-objective">
                {c.platform || "Channel to be decided"} <span>·</span>{" "}
                {c.objective || "Objective to be decided"}
              </p>
              <p className="cp-brief">
                {c.brief ||
                  "Add the idea, message and outcome behind this campaign."}
              </p>
              <div className="cp-card-budget">
                <small>
                  Planned {c.budget_basis === "daily" ? "daily" : "total"}{" "}
                  budget
                </small>
                <strong>
                  {c.currency && c.budget_minor != null
                    ? formatMoney(c.budget_minor / 100, c.currency)
                    : "Not set"}
                  {c.budget_basis === "daily" && c.budget_minor != null && (
                    <small> / day</small>
                  )}
                </strong>
              </div>
              <div className="cp-card-detail">
                <span>Timing</span>
                <b>
                  {c.start_date && c.end_date
                    ? c.start_date + " → " + c.end_date
                    : "Dates to be decided"}
                </b>
              </div>
              <div className="cp-card-detail">
                <span>Markets</span>
                <b>
                  {c.countries.length
                    ? c.countries
                        .map(
                          (code) =>
                            campaignCountries.find(
                              ([key]) => key === code,
                            )?.[1] || code,
                        )
                        .join(", ")
                    : "Audience to be decided"}
                </b>
              </div>
              <footer>
                <span>
                  {data.links.filter((l) => l.campaign_id === c.id).length}{" "}
                  linked posts
                </span>
                <button onClick={() => setEditing(c)}>Open brief ↗</button>
              </footer>
            </article>
          ))}
        </div>
      )}
      <p className="lp-footnote">
        Currencies are never combined or converted. Daily and total budgets are
        shown separately. Live spend and campaign results will be added during
        account activation.
        {data && data.campaigns.length >= data.limit
          ? " Showing the latest 500 plans."
          : ""}
      </p>
      {editing && data && (
        <CampaignEditor
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          brands={brands}
          posts={data.posts}
          linked={
            editing === "new"
              ? []
              : data.links
                  .filter((l) => l.campaign_id === editing.id)
                  .map((l) => l.post_id)
          }
          close={() => setEditing(null)}
          saved={async () => {
            setEditing(null);
            setNotice(
              "Campaign plan saved. No ads were launched and no budget was spent.",
            );
            await load();
          }}
        />
      )}
    </div>
  );
}
function CampaignEditor({
  initial,
  brands,
  posts,
  linked,
  close,
  saved,
}: {
  initial: CampaignPlan | null;
  brands: Brand[];
  posts: Content[];
  linked: string[];
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [brand, setBrand] = useState(initial?.brand_id || brands[0]?.id || ""),
    [name, setName] = useState(initial?.name || ""),
    [platform, setPlatform] = useState(initial?.platform || ""),
    [objective, setObjective] = useState(initial?.objective || ""),
    [currency, setCurrency] = useState(initial?.currency || ""),
    [budget, setBudget] = useState(
      initial?.budget_minor != null
        ? (initial.budget_minor / 100).toFixed(2)
        : "",
    ),
    [basis, setBasis] = useState(initial?.budget_basis || "total"),
    [start, setStart] = useState(initial?.start_date || ""),
    [end, setEnd] = useState(initial?.end_date || ""),
    [countries, setCountries] = useState<string[]>(initial?.countries || []),
    [audience, setAudience] = useState(initial?.audience || ""),
    [brief, setBrief] = useState(initial?.brief || ""),
    [destination, setDestination] = useState(initial?.destination || ""),
    [status, setStatus] = useState(initial?.status || "draft"),
    [selected, setSelected] = useState<string[]>(linked),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [countrySearch, setCountrySearch] = useState("");
  const [clientKey] = useState(() => crypto.randomUUID());
  let amount: number | null = null;
  try {
    amount = parseBudget(budget);
  } catch {}
  function dismiss() {
    if (
      !busy &&
      (!dirty || window.confirm("Discard your unsaved campaign changes?"))
    )
      close();
  }
  function country(code: string) {
    setCountries((prev) =>
      prev.includes(code)
        ? prev.filter((c) => c !== code)
        : code === "ALL"
          ? ["ALL"]
          : [...prev.filter((c) => c !== "ALL"), code],
    );
    setDirty(true);
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      await call({
        ...(initial ? { id: initial.id, version: initial.version } : {}),
        clientKey,
        brandId: brand,
        name,
        platform,
        objective,
        currency,
        budget,
        budgetBasis: basis,
        startDate: start,
        endDate: end,
        countries,
        audience,
        brief,
        destination,
        status,
        postIds: selected,
      });
      setDirty(false);
      await saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={initial ? "Campaign brief" : "Plan a campaign"}
      close={dismiss}
      wide
    >
      <form
        onChange={() => setDirty(true)}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="cp-editor">
          <section className="cp-fields">
            <span className="a-eyebrow">01 · THE INTENT</span>
            <label className="ed-label">
              Campaign name
              <input
                required
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. IDAO — next intake"
              />
            </label>
            <div className="cp-form-row">
              <label className="ed-label">
                Brand
                <select
                  disabled={!!initial || busy}
                  value={brand}
                  onChange={(e) => {
                    setBrand(e.target.value);
                    setSelected([]);
                  }}
                >
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ed-label">
                Channel
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  required={status === "ready"}
                >
                  <option value="">Choose channel</option>
                  {["LinkedIn", "Facebook", "Instagram"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="ed-label">
              Primary objective
              <select
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                required={status === "ready"}
              >
                <option value="">Choose an outcome</option>
                {["Awareness", "Traffic", "Leads", "Engagement"].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="ed-label">
              Campaign brief
              <textarea
                value={brief}
                rows={4}
                maxLength={4000}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="What are we saying, why now, and what should people do next?"
              />
            </label>
            <span className="a-eyebrow">02 · BUDGET & TIMING</span>
            <div className="cp-form-row">
              <label className="ed-label">
                Currency
                <select
                  value={currency}
                  required={!!budget || status === "ready"}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  <option value="">Choose currency</option>
                  {campaignCurrencies.map((c) => (
                    <option key={c} value={c}>
                      {c === "ZAR"
                        ? "ZAR · South African rand"
                        : c === "USD"
                          ? "USD · US dollar"
                          : c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ed-label">
                Budget
                <input
                  inputMode="decimal"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="0.00"
                  required={status === "ready"}
                />
              </label>
            </div>
            <label className="ed-label">
              Budget basis
              <select
                value={basis}
                onChange={(e) => setBasis(e.target.value as typeof basis)}
              >
                <option value="total">Total campaign budget</option>
                <option value="daily">Daily budget</option>
              </select>
              <small>
                Amounts stay in the selected currency. Changing it does not
                convert the amount.
              </small>
            </label>
            <div className="cp-form-row">
              <label className="ed-label">
                Start date
                <input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  required={status === "ready"}
                />
              </label>
              <label className="ed-label">
                End date
                <input
                  type="date"
                  value={end}
                  min={start || undefined}
                  onChange={(e) => setEnd(e.target.value)}
                  required={status === "ready"}
                />
              </label>
            </div>
            <span className="a-eyebrow">03 · THE AUDIENCE</span>
            <label className="ed-label">
              Target countries
              <input
                value={countrySearch}
                onChange={(e) => setCountrySearch(e.target.value)}
                placeholder="Find a market…"
              />
            </label>
            <div
              className="cp-country-choices"
              role="group"
              aria-label="Target countries"
            >
              {campaignCountries
                .filter(([, label]) =>
                  label.toLowerCase().includes(countrySearch.toLowerCase()),
                )
                .map(([code, label]) => (
                  <button
                    type="button"
                    key={code}
                    aria-pressed={countries.includes(code)}
                    className={countries.includes(code) ? "active" : ""}
                    onClick={() => country(code)}
                  >
                    {countries.includes(code) ? "✓ " : ""}
                    {label}
                  </button>
                ))}
            </div>
            <label className="ed-label">
              Audience definition
              <textarea
                value={audience}
                rows={3}
                maxLength={1500}
                onChange={(e) => setAudience(e.target.value)}
                required={status === "ready"}
                placeholder="Who are we trying to reach? Include needs, interests or roles."
              />
            </label>
            <label className="ed-label">
              Destination URL
              <input
                type="url"
                value={destination}
                maxLength={1000}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="https://…"
                required={status === "ready" && objective === "Traffic"}
              />
            </label>
            <span className="a-eyebrow">04 · SUPPORTING CONTENT</span>
            <p className="ed-muted">
              Link existing posts from this brand. Linking content does not
              publish or promote it.
            </p>
            <div className="cp-post-picker">
              {posts.filter((p) => p.brand_id === brand).length ? (
                posts
                  .filter((p) => p.brand_id === brand)
                  .map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(p.id)}
                        onChange={() =>
                          setSelected((prev) =>
                            prev.includes(p.id)
                              ? prev.filter((x) => x !== p.id)
                              : [...prev, p.id],
                          )
                        }
                      />
                      <span>
                        <b>{p.text || "Untitled draft"}</b>
                        <small>{p.status}</small>
                      </span>
                    </label>
                  ))
              ) : (
                <p>No posts for this brand yet. You can add them later.</p>
              )}
            </div>
          </section>
          <aside className="cp-plan-preview">
            <span className="a-eyebrow">THE PLAN AT A GLANCE</span>
            <h2>{name || "Your next campaign"}</h2>
            <p>
              {brands.find((b) => b.id === brand)?.name} ·{" "}
              {platform || "Channel to be decided"}
            </p>
            <div className="cp-preview-budget">
              <span>
                {basis === "daily" ? "Daily allocation" : "Total allocation"}
              </span>
              <strong>
                {currency && amount !== null
                  ? formatMoney(amount / 100, currency)
                  : "Budget to be set"}
              </strong>
            </div>
            <dl>
              <dt>Outcome</dt>
              <dd>{objective || "To be decided"}</dd>
              <dt>Timing</dt>
              <dd>
                {start || "Start date"} → {end || "End date"}
              </dd>
              <dt>Markets</dt>
              <dd>
                {countries.length
                  ? countries
                      .map(
                        (c) =>
                          campaignCountries.find(([code]) => code === c)?.[1],
                      )
                      .join(", ")
                  : "To be decided"}
              </dd>
              <dt>Supporting posts</dt>
              <dd>{selected.length} linked</dd>
            </dl>
            <label className="ed-label">
              Plan status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
              >
                <option value="draft">Draft · still taking shape</option>
                <option value="ready">Ready · prepared for activation</option>
                {initial && (
                  <option value="archived">
                    Archived · retained for reference
                  </option>
                )}
              </select>
            </label>
            <p className="lp-footnote">
              Ready means the brief is complete. Launching ads is a separate
              step that will be enabled later.
            </p>
            {error && (
              <p className="access-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy || !brand}>
              {busy ? "Saving…" : "Save campaign plan →"}
            </button>
            <button
              type="button"
              className="cp-close"
              disabled={busy}
              onClick={dismiss}
            >
              Cancel
            </button>
          </aside>
        </div>
      </form>
    </Modal>
  );
}

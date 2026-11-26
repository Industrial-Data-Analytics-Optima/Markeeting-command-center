import { useUnsavedChanges } from "./use-unsaved-changes";
import { useEffect, useState } from "react";
import { Modal } from "./ui";
import { MediaWorkspace, Asset } from "./media-workspace";
import { AssetPreview } from "./asset-preview";
import { campaignCurrencies, campaignCountries } from "./campaign-model";
type Ad = {
  name: string;
  headline: string;
  text: string;
  destination: string;
  mediaId: string;
  cta: string;
};
type Group = {
  name: string;
  audience: string;
  exclusions: string;
  basis: string;
  budget: string;
  start: string;
  end: string;
  countries: string[];
  ads: Ad[];
};
type Build = {
  campaignId?: string;
  campaign_id?: string | null;
  id?: string;
  version?: number;
  brandId: string;
  brand_id?: string;
  brand_name?: string;
  name: string;
  platform: string;
  currency: string;
  objective: string;
  status: string;
  groups: Group[];
  clientKey: string;
};
const ad = (): Ad => ({
    name: "",
    headline: "",
    text: "",
    destination: "",
    mediaId: "",
    cta: "Learn more",
  }),
  group = (): Group => ({
    name: "",
    audience: "",
    exclusions: "",
    basis: "total",
    budget: "",
    start: "",
    end: "",
    countries: [],
    ads: [ad()],
  });
async function call(data?: unknown) {
  const r = await fetch("/api/ads", {
      method: data ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      ...(data ? { body: JSON.stringify(data) } : {}),
    }),
    d = (await r.json()) as {
      builds: Build[];
      briefs: { id: string; brand_id: string; name: string }[];
      events: {
        id: string;
        build_id: string;
        message: string;
        author_name: string;
        created_at: number;
      }[];
      message?: string;
    };
  if (!r.ok) throw new Error(d.message || "Could not save ads.");
  return d;
}
export function AdsWorkspace({
  brands,
  discuss,
}: {
  brands: { id: string; name: string }[];
  discuss?: (item: {
    brandId: string;
    referenceKind: "ad";
    referenceId: string;
    title: string;
  }) => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof call>> | null>(
      null,
    ),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<Build | null>(null),
    [step, setStep] = useState(0),
    [gi, setGi] = useState(0),
    [ai, setAi] = useState(0),
    [picker, setPicker] = useState(false),
    [busy, setBusy] = useState(false),
    [uploadBusy, setUploadBusy] = useState(false),
    [baseline, setBaseline] = useState(""),
    [brand, setBrand] = useState(""),
    [archived, setArchived] = useState(false);
  async function load() {
    setData(await call());
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  useUnsavedChanges(
    uploadBusy || (!!editing && JSON.stringify(editing) !== baseline),
  );
  function open(b?: Build) {
    const next: Build = b
      ? {
          ...structuredClone(b),
          brandId: b.brand_id || b.brandId,
          campaignId: b.campaign_id || "",
          clientKey: crypto.randomUUID(),
        }
      : {
          brandId: brand || brands[0]?.id || "",
          name: "",
          platform: "LinkedIn",
          objective: "Traffic",
          currency: "",
          status: "draft",
          groups: [group()],
          clientKey: crypto.randomUUID(),
        };
    setEditing(next);
    setBaseline(JSON.stringify(next));
    setStep(0);
    setGi(0);
    setAi(0);
    setPicker(false);
    setError("");
  }
  function edit(key: string, value: unknown) {
    setEditing((old) => (old ? { ...old, [key]: value } : null));
  }
  function eg(key: string, value: unknown) {
    setEditing((old) => {
      if (!old) return old;
      const next = structuredClone(old);
      Object.assign(next.groups[gi], { [key]: value });
      return next;
    });
  }
  function ea(key: string, value: unknown) {
    setEditing((old) => {
      if (!old) return old;
      const next = structuredClone(old);
      Object.assign(next.groups[gi].ads[ai], { [key]: value });
      return next;
    });
  }
  async function save(status: string) {
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      await call({ ...editing, status });
      await load();
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const g = editing?.groups[gi],
    a = g?.ads[ai],
    rows = (data?.builds || []).filter(
      (b) =>
        (!brand || b.brand_id === brand) &&
        (archived ? b.status === "archived" : b.status !== "archived"),
    );
  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    type = "text",
    max = 200,
  ) => (
    <label>
      {label}
      <input
        type={type}
        value={value}
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
  return (
    <section className="ads-workspace">
      <header className="leads-heading">
        <div>
          <p className="ed-muted">ADS MANAGER</p>
          <h1>From campaign idea to a complete ad build.</h1>
          <p>
            Organise campaigns, audiences and creative variants in a guided
            workspace.
          </p>
        </div>
        <button
          className="primary"
          disabled={!brands.length}
          onClick={() => open()}
        >
          + Build campaign
        </button>
      </header>
      <div className="email-service">
        <b>Campaign preparation</b>
        <span>
          Live ad accounts, billing currencies, targeting IDs and platform
          limits will be verified during connections. Saved allocations are
          planned budgets.
        </span>
      </div>
      {error && !editing && (
        <p role="alert" className="secure-error">
          {error}
        </p>
      )}
      <div className="growth-toolbar">
        <select
          aria-label="Ad brand"
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
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{" "}
          Archived builds
        </label>
      </div>
      <div className="ads-cards">
        {rows.map((b) => (
          <article key={b.id}>
            <small>
              {b.brand_name} · {b.platform}
            </small>
            <h2>{b.name}</h2>
            <p>
              {b.objective} · {b.groups.length} groups ·{" "}
              {b.groups.reduce((n, g) => n + g.ads.length, 0)} ads
            </p>
            <span className="ed-pill">
              {b.status === "ready"
                ? "Ready for platform validation"
                : b.status}
            </span>
            <button onClick={() => open(b)}>Open build →</button>
            {discuss && (
              <button
                onClick={() =>
                  discuss({
                    brandId: b.brand_id || b.brandId,
                    referenceKind: "ad",
                    referenceId: b.id!,
                    title: b.name,
                  })
                }
              >
                Discuss with team
              </button>
            )}
          </article>
        ))}
      </div>
      {!rows.length && (
        <div className="leads-empty">
          <h2>
            {data ? "Your next campaign starts here." : "Loading campaigns…"}
          </h2>
          <p>
            Build an audience, prepare creative variants and review the full
            structure before activating an ad account.
          </p>
        </div>
      )}
      {editing && g && a && (
        <Modal
          title={editing.name || "New ad campaign"}
          wide
          close={() => {
            if (
              !busy &&
              !uploadBusy &&
              confirm("Close the builder? Unsaved changes will be discarded.")
            )
              setEditing(null);
          }}
        >
          <div className="ads-builder">
            <nav aria-label="Campaign steps">
              {["Campaign", "Ad groups", "Creatives", "Review"].map((s, i) => (
                <button
                  key={s}
                  className={step === i ? "active" : ""}
                  disabled={busy || uploadBusy}
                  onClick={() => setStep(i)}
                >
                  {i + 1} · {s}
                </button>
              ))}
            </nav>
            {step === 0 && (
              <div className="leads-fields">
                <label>
                  Brand
                  <select
                    disabled={!!editing.id}
                    value={editing.brandId}
                    onChange={(e) => {
                      edit("brandId", e.target.value);
                      edit("campaignId", "");
                      edit("groups", [group()]);
                      setGi(0);
                      setAi(0);
                    }}
                  >
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                {field("Campaign name", editing.name, (v) => edit("name", v))}
                <label>
                  Linked campaign brief
                  <select
                    value={editing.campaignId || ""}
                    onChange={(e) => edit("campaignId", e.target.value)}
                  >
                    <option value="">Standalone ad build</option>
                    {data?.briefs
                      .filter((b) => b.brand_id === editing.brandId)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Platform
                  <select
                    value={editing.platform}
                    onChange={(e) => edit("platform", e.target.value)}
                  >
                    {["LinkedIn", "Facebook", "Instagram"].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Objective
                  <select
                    value={editing.objective}
                    onChange={(e) => edit("objective", e.target.value)}
                  >
                    {["Awareness", "Traffic", "Leads", "Engagement"].map(
                      (p) => (
                        <option key={p}>{p}</option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Planned currency
                  <select
                    value={editing.currency}
                    onChange={(e) => edit("currency", e.target.value)}
                  >
                    <option value="">Choose currency</option>
                    {campaignCurrencies.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  <small>
                    The live ad account will determine its billing currency
                    before launch.
                  </small>
                </label>
              </div>
            )}
            {step > 0 && step < 3 && (
              <div className="ads-item-tabs">
                {editing.groups.map((x, i) => (
                  <button
                    key={i}
                    disabled={uploadBusy || busy}
                    className={gi === i ? "active" : ""}
                    onClick={() => {
                      setGi(i);
                      setAi(0);
                    }}
                  >
                    {x.name || "Group " + (i + 1)}
                  </button>
                ))}
                <button
                  disabled={uploadBusy || busy || editing.groups.length >= 10}
                  onClick={() => {
                    edit("groups", [...editing.groups, group()]);
                    setGi(editing.groups.length);
                    setAi(0);
                  }}
                >
                  + Group
                </button>
                {editing.groups.length > 1 && (
                  <button
                    disabled={uploadBusy || busy}
                    onClick={() => {
                      edit(
                        "groups",
                        editing.groups.filter((_, i) => i !== gi),
                      );
                      setGi(0);
                      setAi(0);
                    }}
                  >
                    Remove group
                  </button>
                )}
              </div>
            )}
            {step === 1 && (
              <div className="leads-fields">
                {field("Ad group name", g.name, (v) => eg("name", v))}
                <label>
                  Budget basis
                  <select
                    value={g.basis}
                    onChange={(e) => eg("basis", e.target.value)}
                  >
                    <option value="total">Total allocation</option>
                    <option value="daily">Daily allocation</option>
                  </select>
                </label>
                {field(
                  "Planned budget · " + (editing.currency || "choose currency"),
                  g.budget,
                  (v) => eg("budget", v),
                  "text",
                  20,
                )}
                {field("Start date", g.start, (v) => eg("start", v), "date")}
                {field("End date", g.end, (v) => eg("end", v), "date")}
                <fieldset className="ads-countries">
                  <legend>Countries</legend>
                  {campaignCountries.map(([id, label]) => (
                    <label key={id}>
                      <input
                        type="checkbox"
                        checked={g.countries.includes(id)}
                        onChange={() =>
                          eg(
                            "countries",
                            g.countries.includes(id)
                              ? g.countries.filter((c) => c !== id)
                              : id === "ALL"
                                ? ["ALL"]
                                : [
                                    ...g.countries.filter((c) => c !== "ALL"),
                                    id,
                                  ],
                          )
                        }
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <label>
                  Audience brief
                  <textarea
                    maxLength={2000}
                    value={g.audience}
                    onChange={(e) => eg("audience", e.target.value)}
                    placeholder="Roles, industries, interests, locations and who this offer is for…"
                  />
                </label>
                <label>
                  Exclusions brief
                  <textarea
                    maxLength={1000}
                    value={g.exclusions}
                    onChange={(e) => eg("exclusions", e.target.value)}
                    placeholder="Existing customers, irrelevant audiences or excluded markets…"
                  />
                </label>
                <p className="ed-muted">
                  Audience briefs will be mapped to supported platform targeting
                  options when ad accounts are activated.
                </p>
              </div>
            )}
            {step === 2 && (
              <>
                <div className="ads-item-tabs">
                  {g.ads.map((x, i) => (
                    <button
                      key={i}
                      disabled={uploadBusy || busy}
                      className={ai === i ? "active" : ""}
                      onClick={() => setAi(i)}
                    >
                      {x.name || "Ad " + (i + 1)}
                    </button>
                  ))}
                  <button
                    disabled={uploadBusy || busy || g.ads.length >= 20}
                    onClick={() => {
                      eg("ads", [...g.ads, ad()]);
                      setAi(g.ads.length);
                    }}
                  >
                    + Ad variant
                  </button>
                  {g.ads.length > 1 && (
                    <button
                      disabled={uploadBusy || busy}
                      onClick={() => {
                        eg(
                          "ads",
                          g.ads.filter((_, i) => i !== ai),
                        );
                        setAi(0);
                      }}
                    >
                      Remove ad
                    </button>
                  )}
                </div>
                <div className="ads-creative">
                  <div className="leads-fields">
                    {field("Ad name", a.name, (v) => ea("name", v))}
                    {field("Headline", a.headline, (v) => ea("headline", v))}
                    <label>
                      Primary copy
                      <textarea
                        maxLength={3000}
                        value={a.text}
                        onChange={(e) => ea("text", e.target.value)}
                      />
                    </label>
                    {field(
                      "Destination URL",
                      a.destination,
                      (v) => ea("destination", v),
                      "url",
                      1000,
                    )}
                    <label>
                      Call to action
                      <select
                        value={a.cta}
                        onChange={(e) => ea("cta", e.target.value)}
                      >
                        {[
                          "Learn more",
                          "Sign up",
                          "Contact us",
                          "Download",
                          "Apply now",
                        ].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      disabled={uploadBusy || busy}
                      onClick={() => setPicker(!picker)}
                    >
                      {picker ? "Close media library" : "Choose image or video"}
                    </button>
                  </div>
                  <aside className="ads-preview">
                    <small>CREATIVE PREVIEW · {editing.platform}</small>
                    <b>
                      {brands.find((b) => b.id === editing.brandId)?.name} ·
                      Sponsored
                    </b>
                    <p>{a.text || "Your primary ad copy"}</p>
                    {a.mediaId ? (
                      <AssetPreview id={a.mediaId} alt={a.headline} />
                    ) : (
                      <div className="growth-chart-empty">
                        Choose an image or video
                      </div>
                    )}
                    <h3>{a.headline || "Your headline"}</h3>
                    <span>
                      {a.destination || "Destination URL"} · {a.cta}
                    </span>
                    <small>
                      Layout preview. Final placements and eligibility are
                      checked by the platform.
                    </small>
                  </aside>
                </div>
                {picker && (
                  <MediaWorkspace
                    brands={brands.filter((b) => b.id === editing.brandId)}
                    onBusy={setUploadBusy}
                    onSelect={(asset: Asset) => {
                      ea("mediaId", asset.id);
                      setPicker(false);
                    }}
                  />
                )}
              </>
            )}
            {step === 3 && (
              <div className="ads-review">
                <h2>{editing.name || "Unnamed campaign"}</h2>
                <p>
                  {editing.platform} · {editing.objective} ·{" "}
                  {editing.currency || "Currency needed"}
                </p>
                {editing.groups.map((x, i) => (
                  <article key={i}>
                    <h3>{x.name || "Group " + (i + 1)}</h3>
                    <p>
                      Planned {x.basis} budget: {x.budget || "Not set"}{" "}
                      {editing.currency} · {x.start || "Start needed"} →{" "}
                      {x.end || "End needed"}
                    </p>
                    <p>Countries: {x.countries.join(", ") || "Not set"}</p>
                    <p>{x.audience || "Audience brief needed"}</p>
                    {x.exclusions && <p>Exclusions: {x.exclusions}</p>}
                    {x.ads.map((ad, j) => (
                      <p key={j}>
                        {ad.name || "Ad " + (j + 1)} ·{" "}
                        {ad.headline || "Headline needed"} ·{" "}
                        {ad.mediaId ? "Creative selected" : "Creative needed"} ·{" "}
                        {ad.destination || "Destination needed"}
                      </p>
                    ))}
                  </article>
                ))}
                <p className="email-draft-note">
                  Ready means the brief is complete for platform validation.
                  Launch, scheduling, pause/resume, spend and delivery results
                  become available after live ad-account integration.
                </p>
                {data?.events
                  .filter((e) => e.build_id === editing.id)
                  .map((e) => (
                    <p className="ed-muted" key={e.id}>
                      {e.message} · {e.author_name} ·{" "}
                      {new Date(e.created_at).toLocaleString()}
                    </p>
                  ))}
              </div>
            )}
            {error && (
              <p className="secure-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                disabled={!step || uploadBusy || busy}
                onClick={() => setStep(step - 1)}
              >
                Back
              </button>
              {step < 3 && (
                <button
                  disabled={uploadBusy || busy}
                  onClick={() => setStep(step + 1)}
                >
                  Continue →
                </button>
              )}
              <button
                disabled={busy || uploadBusy}
                onClick={() => save("draft")}
              >
                {busy ? "Saving…" : "Save draft"}
              </button>
              {step === 3 && (
                <button
                  className="primary"
                  disabled={busy || uploadBusy}
                  onClick={() => save("ready")}
                >
                  Mark ready for validation
                </button>
              )}
              {editing.id && (
                <button
                  disabled={busy || uploadBusy}
                  onClick={() =>
                    save(editing.status === "archived" ? "draft" : "archived")
                  }
                >
                  {editing.status === "archived"
                    ? "Restore draft"
                    : "Archive build"}
                </button>
              )}
            </footer>
          </div>
        </Modal>
      )}
    </section>
  );
}

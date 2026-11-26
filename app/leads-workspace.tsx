import { useEffect, useState, FormEvent } from "react";
import { Modal } from "./ui";
import { download } from "./workspace-model";
type Lead = {
  industry: string;
  job_title: string;
  country: string;
  company_size: string;
  interests: string;
  profile_source: string;
  id: string;
  brand_id: string;
  brand_name: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  source: string;
  campaign_id: string | null;
  campaign_name: string;
  assignee_id: string | null;
  assignee_name: string;
  stage: string;
  follow_up: string | null;
  version: number;
  updated_at: number;
};
type Data = {
  leads: Lead[];
  notes: {
    id: string;
    lead_id: string;
    author_name: string;
    body: string;
    created_at: number;
  }[];
  campaigns: { id: string; brand_id: string; name: string }[];
  members: { id: string; brand_id: string; name: string }[];
  limit: number;
};
const stages = ["New", "Contacted", "Qualified", "Won", "Lost"];
async function call(data?: unknown) {
  const r = await fetch("/api/leads", {
      method: data ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      ...(data ? { body: JSON.stringify(data) } : {}),
    }),
    d = (await r.json()) as Data & { message?: string };
  if (!r.ok) throw new Error(d.message || "Could not load leads.");
  return d;
}
export function LeadsWorkspace({
  brands,
  emailLead,
}: {
  brands: { id: string; name: string }[];
  emailLead?: (lead: Lead) => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [brand, setBrand] = useState(""),
    [stage, setStage] = useState(""),
    [due, setDue] = useState(false),
    [editing, setEditing] = useState<Lead | null | undefined>(),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [formBrand, setFormBrand] = useState("");
  async function load() {
    setData(await call());
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  const today = new Date().toLocaleDateString("en-CA"),
    rows = (data?.leads || []).filter(
      (l) =>
        (!brand || l.brand_id === brand) &&
        (!stage || l.stage === stage) &&
        (!due ||
          (l.follow_up &&
            l.follow_up <= today &&
            !["Won", "Lost"].includes(l.stage))) &&
        [
          l.name,
          l.email,
          l.company,
          l.campaign_name,
          l.assignee_name,
          l.industry,
          l.job_title,
          l.country,
        ]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  function open(l: Lead | null) {
    setEditing(l);
    setFormBrand(l?.brand_id || brand || brands[0]?.id || "");
    setNote("");
    setError("");
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    try {
      await call({ ...fields, id: editing?.id, version: editing?.version });
      await load();
      setEditing(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function addNote() {
    if (!editing) return;
    setBusy(true);
    try {
      await call({
        id: editing.id,
        brandId: editing.brand_id,
        action: "note",
        note,
      });
      await load();
      setNote("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="leads-workspace">
      <header className="leads-heading">
        <div>
          <p className="ed-muted">RELATIONSHIPS & FOLLOW-UP</p>
          <h1>Every conversation, carried forward.</h1>
          <p>Keep each brand’s enquiries, ownership and next steps together.</p>
        </div>
        <button
          className="primary"
          disabled={!brands.length}
          onClick={() => open(null)}
        >
          + Add lead
        </button>
      </header>
      {error && (
        <div className="secure-error" role="alert">
          {error}
        </div>
      )}
      <div className="cp-budget-strip">
        {stages.map((s) => (
          <article key={s}>
            <span>{s}</span>
            <strong>
              {
                (data?.leads || []).filter(
                  (l) => (!brand || l.brand_id === brand) && l.stage === s,
                ).length
              }
            </strong>
            <p>leads in this stage</p>
          </article>
        ))}
      </div>
      <div className="lp-toolbar">
        <input
          aria-label="Search leads"
          placeholder="Search name, company, role or industry"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Brand"
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
          aria-label="Stage"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
        >
          <option value="">All stages</option>
          {stages.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={due}
            onChange={(e) => setDue(e.target.checked)}
          />{" "}
          Follow-up due
        </label>
        <button
          disabled={!rows.length}
          onClick={() =>
            download(
              "leads.csv",
              rows.map((l) => ({
                name: l.name,
                email: l.email,
                phone: l.phone,
                company: l.company,
                industry: l.industry,
                jobTitle: l.job_title,
                country: l.country,
                companySize: l.company_size,
                interests: l.interests,
                profileSource: l.profile_source,
                brand: l.brand_name,
                campaign: l.campaign_name,
                source: l.source,
                owner: l.assignee_name,
                stage: l.stage,
                followUp: l.follow_up,
              })),
            )
          }
        >
          Download CSV
        </button>
        <button onClick={() => load().catch((e) => setError(e.message))}>
          Refresh
        </button>
      </div>
      <p className="ed-muted">
        {rows.length} leads · Manual entries · Showing up to{" "}
        {data?.limit || 1000} most recently updated leads
      </p>
      <div className="leads-table">
        <table>
          <thead>
            <tr>
              {[
                "Contact",
                "Brand / campaign",
                "Owner",
                "Stage",
                "Next follow-up",
                "",
              ].map((v, i) => (
                <th key={i}>{v}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td>
                  <b>{l.name}</b>
                  {(l.job_title || l.industry) && (
                    <small>
                      {[l.job_title, l.industry].filter(Boolean).join(" · ")}
                    </small>
                  )}
                  <small>
                    {l.company || l.email || "Contact details pending"}
                  </small>
                </td>
                <td>
                  {l.brand_name}
                  <small>{l.campaign_name || l.source}</small>
                </td>
                <td>{l.assignee_name || "Unassigned"}</td>
                <td>
                  <span className="ed-pill">{l.stage}</span>
                </td>
                <td>{l.follow_up || "No date set"}</td>
                <td>
                  <button onClick={() => open(l)}>Open lead</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data ? (
          <p>Loading leads…</p>
        ) : !rows.length ? (
          <div className="leads-empty">
            <h2>
              {data.leads.length
                ? "No matching leads."
                : "Make room for your next customer."}
            </h2>
            <p>
              {data.leads.length
                ? "Adjust the filters to see more contacts."
                : "Add an enquiry, assign a teammate and set the next follow-up. Campaign attribution is available for saved campaign plans."}
            </p>
          </div>
        ) : null}
      </div>
      {editing !== undefined && (
        <Modal
          title={editing ? "Lead details" : "Add a lead"}
          close={() => {
            if (
              !busy &&
              confirm(
                "Close this lead? Unsaved field changes will be discarded.",
              )
            )
              setEditing(undefined);
          }}
          wide
        >
          {error && (
            <div className="secure-error" role="alert">
              {error}
            </div>
          )}
          <form onSubmit={save} className="leads-form">
            <div className="leads-fields">
              <label>
                Brand
                <select
                  required
                  name="brandId"
                  value={formBrand}
                  disabled={!!editing}
                  onChange={(e) => setFormBrand(e.target.value)}
                >
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                {editing && (
                  <input type="hidden" name="brandId" value={formBrand} />
                )}
              </label>
              {[
                ["name", "Full name", 160],
                ["email", "Email", 254],
                ["phone", "Phone", 80],
                ["company", "Company", 200],
                ["source", "Source", 160],
                ["job_title", "Job title / role", 120],
                ["industry", "Industry / field of work", 120],
                ["country", "Country / region", 120],
                ["company_size", "Company size (employees)", 120],
              ].map(([key, label, max]) => (
                <label key={key}>
                  {label}
                  <input
                    name={String(key)}
                    type={key === "email" ? "email" : "text"}
                    maxLength={Number(max)}
                    required={key === "name"}
                    defaultValue={
                      (editing?.[key as keyof Lead] as string) ||
                      (key === "source" ? "Manual entry" : "")
                    }
                  />
                </label>
              ))}
              <label>
                Interests / what they need
                <textarea
                  name="interests"
                  maxLength={1000}
                  defaultValue={editing?.interests || ""}
                />
              </label>
              <label>
                Campaign
                <select
                  name="campaignId"
                  defaultValue={editing?.campaign_id || ""}
                >
                  <option value="">No campaign</option>
                  {data?.campaigns
                    .filter((c) => c.brand_id === formBrand)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Assigned teammate
                <select
                  name="assigneeId"
                  defaultValue={editing?.assignee_id || ""}
                >
                  <option value="">Unassigned</option>
                  {data?.members
                    .filter((m) => m.brand_id === formBrand)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Stage
                <select name="stage" defaultValue={editing?.stage || "New"}>
                  {stages.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Follow-up date
                <input
                  type="date"
                  name="followUp"
                  defaultValue={editing?.follow_up || ""}
                />
              </label>
            </div>
            <p className="ed-muted">
              Professional details are recorded by your team. Lead-form answers
              will populate available fields after integration; missing
              information is left blank.
            </p>
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save lead"}
            </button>
          </form>
          {editing && (
            <section className="leads-notes">
              <h3>Conversation notes</h3>
              {editing.email && emailLead && (
                <button type="button" onClick={() => emailLead(editing)}>
                  Draft email to {editing.name}
                </button>
              )}
              <textarea
                aria-label="New note"
                placeholder="Record a conversation or next step…"
                maxLength={4000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button disabled={busy || !note.trim()} onClick={addNote}>
                Add note
              </button>
              {data?.notes
                .filter((n) => n.lead_id === editing.id)
                .map((n) => (
                  <article key={n.id}>
                    <b>{n.author_name}</b>
                    <small>{new Date(n.created_at).toLocaleString()}</small>
                    <p>{n.body}</p>
                  </article>
                ))}
            </section>
          )}
        </Modal>
      )}
    </section>
  );
}

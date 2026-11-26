import { useEffect, useRef, useState } from "react";
import { Modal, Icon } from "./ui";
import { useUnsavedChanges } from "./use-unsaved-changes";

type Entry = {
  id: string;
  brand_id: string;
  brand_name?: string;
  author_name?: string;
  created_by: string;
  kind: "discussion" | "report";
  category: string;
  title: string;
  body: string;
  next_steps: string;
  observations: string;
  requests: string;
  week_start: string | null;
  reference_kind: string | null;
  reference_id: string | null;
  status: string;
  version: number;
  created_at: number;
  updated_at: number;
  seen_at?: number;
  reply_count?: number;
};
type Listing = {
  entries: Entry[];
  hasMore: boolean;
  offset: number;
  userId: string;
  role: string;
};
type Detail = {
  entry: Entry;
  linked: { kind: string; title: string; status: string } | null;
  replies: {
    id: string;
    author_name: string;
    body: string;
    created_at: number;
  }[];
  replyLimit: boolean;
  readers: { name: string }[];
  versions: { version: number; created_at: number; snapshot: Entry }[];
  userId: string;
  role: string;
};
type Form = {
  id?: string;
  version?: number;
  clientKey: string;
  brandId: string;
  kind: "discussion" | "report";
  category: string;
  title: string;
  body: string;
  next_steps: string;
  observations: string;
  requests: string;
  weekStart: string;
  referenceKind: string;
  referenceId: string;
  published: boolean;
};
type References = {
  posts: { id: string; title: string; status: string }[];
  ads: { id: string; title: string; status: string }[];
};
async function api<T>(query = "", body?: unknown) {
  const r = await fetch("/api/team-space" + query, {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    d = (await r.json()) as T & { message?: string };
  if (!r.ok) throw new Error(d.message || "Could not load Team space.");
  return d;
}
const date = (n: number) =>
  new Date(n).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
const weekDate = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const weekLabel = (s: string) =>
  new Date(s + "T12:00:00").toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
export type TeamIntent = {
  brandId: string;
  referenceKind: "post" | "ad";
  referenceId: string;
  title: string;
};
export function TeamSpace({
  brands,
  intent,
  onIntentUsed,
}: {
  brands: { id: string; name: string }[];
  intent?: TeamIntent | null;
  onIntentUsed?: () => void;
}) {
  const [tab, setTab] = useState<"discussion" | "report">("discussion"),
    [brand, setBrand] = useState(""),
    [month, setMonth] = useState(""),
    [scope, setScope] = useState("all"),
    [status, setStatus] = useState(""),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [list, setList] = useState<Listing | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [selected, setSelected] = useState(""),
    [form, setForm] = useState<Form | null>(null),
    [refs, setRefs] = useState<References>({ posts: [], ads: [] }),
    [reply, setReply] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [fetching, setFetching] = useState(false);
  const listGeneration = useRef(0),
    detailGeneration = useRef(0),
    replyKey = useRef("");
  useUnsavedChanges(!!form || !!reply.trim());
  useEffect(() => {
    if (!intent) return;
    setTab("discussion");
    setForm({
      clientKey: crypto.randomUUID(),
      brandId: intent.brandId,
      kind: "discussion",
      category: "question",
      title: ("About: " + intent.title).slice(0, 160),
      body: "",
      next_steps: "",
      observations: "",
      requests: "",
      weekStart: weekDate(),
      referenceKind: intent.referenceKind,
      referenceId: intent.referenceId,
      published: false,
    });
    onIntentUsed?.();
  }, [intent, onIntentUsed]);
  const params = new URLSearchParams({
    kind: tab,
    brand,
    month: tab === "report" ? month : "",
    status,
    q: query,
    offset: String(offset),
    mine: String(scope === "mine"),
    unread: String(scope === "unread"),
  });
  const filter = params.toString();
  async function load() {
    const generation = ++listGeneration.current;
    setFetching(true);
    try {
      const d = await api<Listing>("?" + filter);
      if (generation === listGeneration.current) setList(d);
    } catch (e) {
      if (generation === listGeneration.current) setError((e as Error).message);
    } finally {
      if (generation === listGeneration.current) setFetching(false);
    }
  }
  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => {
      clearInterval(timer);
      listGeneration.current++;
    };
  }, [filter]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    let active = true;
    setRefs({ posts: [], ads: [] });
    if (form?.kind === "discussion" && form.brandId && !form.id)
      api<References>(
        "?references=true&brand=" + encodeURIComponent(form.brandId),
      )
        .then((d) => {
          if (active) setRefs(d);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [form?.brandId, form?.kind, form?.id]);
  function leave() {
    return !reply.trim() || confirm("Discard your unsent reply?");
  }
  function changeTab(kind: "discussion" | "report") {
    if (!leave()) return;
    detailGeneration.current++;
    setTab(kind);
    setStatus("");
    setOffset(0);
    setSelected("");
    setDetail(null);
    setReply("");
    setError("");
  }
  async function show(id: string) {
    if (id !== selected && !leave()) return;
    const generation = ++detailGeneration.current;
    setSelected(id);
    setDetail(null);
    setReply("");
    setError("");
    try {
      const d = await api<Detail>("?id=" + encodeURIComponent(id));
      if (generation !== detailGeneration.current) return;
      setDetail(d);
      await api("", { action: "read", id, seenAt: d.entry.updated_at });
      await load();
    } catch (e) {
      if (generation === detailGeneration.current)
        setError((e as Error).message);
    }
  }
  function compose(entry?: Entry) {
    if (!leave()) return;
    setReply("");
    setError("");
    setForm(
      entry
        ? {
            id: entry.id,
            version: entry.version,
            clientKey: crypto.randomUUID(),
            brandId: entry.brand_id,
            kind: entry.kind,
            category: entry.category,
            title: entry.title,
            body: entry.body,
            next_steps: entry.next_steps,
            observations: entry.observations,
            requests: entry.requests,
            weekStart: entry.week_start || weekDate(),
            referenceKind: entry.reference_kind || "",
            referenceId: entry.reference_id || "",
            published: entry.status === "published",
          }
        : {
            clientKey: crypto.randomUUID(),
            brandId: brand || brands[0]?.id || "",
            kind: tab,
            category: "question",
            title: "",
            body: "",
            next_steps: "",
            observations: "",
            requests: "",
            weekStart: weekDate(),
            referenceKind: "",
            referenceId: "",
            published: false,
          },
    );
  }
  function edit(key: keyof Form, value: string) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }
  async function save(publish: boolean) {
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: string }>("", {
        ...form,
        action: form.id ? "save" : "create",
        publish,
      });
      setForm(null);
      setNotice(
        form.kind === "report"
          ? publish || form.published
            ? "Report shared with the brand team."
            : "Private draft saved. Only you can see it."
          : "Discussion started. Teammates with access to this brand can reply.",
      );
      await load();
      await show(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function act(action: string) {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await api("", {
        action,
        id: detail.entry.id,
        version: detail.entry.version,
        ...(action === "reply"
          ? {
              body: reply,
              clientKey: (replyKey.current ||= crypto.randomUUID()),
            }
          : {}),
      });
      if (action === "reply") {
        setReply("");
        replyKey.current = "";
      }
      const d = await api<Detail>("?id=" + encodeURIComponent(detail.entry.id));
      setDetail(d);
      await api("", {
        action: "read",
        id: d.entry.id,
        seenAt: d.entry.updated_at,
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function digest() {
    setBusy(true);
    setError("");
    try {
      const rows: Entry[] = [];
      let page = 0,
        more = true;
      while (more) {
        const p = new URLSearchParams(params);
        p.set("offset", String(page));
        const data = await api<Listing>("?" + p);
        rows.push(...data.entries);
        more = data.hasMore;
        page += 40;
        if (more && page > 10000)
          throw new Error("Narrow your filters before exporting.");
      }
      const content = [
        "TEAM WEEKLY REPORTS",
        month ? "Month: " + month : "All selected weeks",
        scope === "mine" ? "My reports" : "",
        ...rows.map((e) =>
          [
            brands.find((b) => b.id === e.brand_id)?.name,
            e.title,
            "Week of " +
              e.week_start +
              " · " +
              e.author_name +
              " · " +
              e.status,
            "WORK COMPLETED\n" + e.body,
            "OBSERVATIONS\n" + e.observations,
            "REQUESTS / BLOCKERS\n" + e.requests,
            "NEXT WEEK\n" + e.next_steps,
          ].join("\n\n"),
        ),
      ].join("\n\n————————————————————————\n\n");
      const url = URL.createObjectURL(
          new Blob([content], { type: "text/plain;charset=utf-8" }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = "team-reports-" + (month || "archive") + ".txt";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`${rows.length} reports exported using your current filters.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const current = detail?.entry,
    author = list?.entries.find((e) => e.id === current?.id)?.author_name;
  return (
    <section className="team-space">
      <header className="ts-heading">
        <div>
          <span className="a-eyebrow">THE TEAM NOTEBOOK</span>
          <h1>Keep the conversation with the work.</h1>
          <p>
            Ask, share what you’ve learned, and leave a useful record for
            whoever comes next.
          </p>
        </div>
        <button
          className="primary"
          disabled={busy || !brands.length}
          onClick={() => compose()}
        >
          <Icon name="plus" />
          {tab === "report" ? "Write weekly report" : "Start discussion"}
        </button>
      </header>
      <div className="ts-tabs" role="tablist" aria-label="Team space">
        <button
          role="tab"
          aria-selected={tab === "discussion"}
          onClick={() => changeTab("discussion")}
        >
          Discussions
        </button>
        <button
          role="tab"
          aria-selected={tab === "report"}
          onClick={() => changeTab("report")}
        >
          Weekly reports
        </button>
        <span>
          {tab === "report"
            ? "A shared history, week by week."
            : "Questions, requests and decisions in one place."}
        </span>
      </div>
      {notice && (
        <div className="secure-notice" role="status">
          {notice}
          <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      {error && !form && (
        <p className="secure-error" role="alert">
          {error}
          <button
            disabled={busy}
            onClick={() => (selected ? show(selected) : load())}
          >
            Reload
          </button>
        </p>
      )}
      <div className="ts-toolbar">
        <input
          aria-label="Search Team space"
          placeholder="Search notes, people or observations"
          maxLength={200}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Filter brand"
          value={brand}
          onChange={(e) => {
            setBrand(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All my brands</option>
          {brands.map((b) => (
            <option value={b.id} key={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter scope"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setOffset(0);
          }}
        >
          <option value="all">Everyone</option>
          <option value="mine">Written by me</option>
          <option value="unread">Unread updates</option>
        </select>
        <select
          aria-label="Filter status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All statuses</option>
          {(tab === "report"
            ? ["published", "draft"]
            : ["open", "resolved"]
          ).map((s) => (
            <option key={s} value={s}>
              {s === "draft"
                ? "My private drafts"
                : s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
        {tab === "report" && (
          <>
            <label className="ts-month">
              Week starts in
              <input
                aria-label="Report month"
                type="month"
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            {month && (
              <button
                onClick={() => {
                  setMonth("");
                  setOffset(0);
                }}
              >
                All months
              </button>
            )}
            <button disabled={busy || !list?.entries.length} onClick={digest}>
              <Icon name="download" />
              Export reports
            </button>
          </>
        )}
      </div>
      {tab === "report" && (
        <p className="ts-hint">
          One report per person, brand and week. Weeks start Monday. Filter a
          month to read or export that month’s reports; weeks are grouped by
          their start date. Drafts stay private until shared.
        </p>
      )}
      <div className="ts-layout">
        <aside
          className="ts-list"
          aria-label={tab === "report" ? "Weekly reports" : "Discussions"}
          aria-busy={fetching}
        >
          <header>
            <b>{tab === "report" ? "Reports archive" : "Team conversations"}</b>
            <small>
              {fetching
                ? "Updating…"
                : (list?.entries.length || 0) + " on this page"}
            </small>
          </header>
          {list?.entries.map((e) => (
            <button
              key={e.id}
              className={"ts-item " + (selected === e.id ? "selected" : "")}
              onClick={() => show(e.id)}
            >
              <div>
                <span>{e.brand_name}</span>
                <span className="ts-status">
                  {e.status === "draft" ? "Private draft" : e.status}
                </span>
              </div>
              {e.week_start && <small>Week of {weekLabel(e.week_start)}</small>}
              <h2>{e.title}</h2>
              <p>{e.body}</p>
              <footer>
                <span>
                  {e.author_name} · {e.reply_count || 0} replies
                </span>
                {e.created_by !== list.userId &&
                  (!e.seen_at || e.seen_at < e.updated_at) && <b>Unread</b>}
              </footer>
            </button>
          ))}
          {!list?.entries.length && (
            <div className="ts-empty">
              <Icon name="Team space" />
              <h2>
                {fetching
                  ? "Loading…"
                  : search || brand || scope !== "all" || month || status
                    ? "No matching notes"
                    : "Start a useful conversation."}
              </h2>
              <p>
                {tab === "report"
                  ? "Capture this week’s work, what you noticed and what support you need."
                  : "Ask about a post or ad, request help, or share an observation."}
              </p>
            </div>
          )}
          <footer className="ts-pagination">
            <button
              disabled={fetching || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 40))}
            >
              Previous
            </button>
            <span>Page {offset / 40 + 1}</span>
            <button
              disabled={fetching || !list?.hasMore}
              onClick={() => setOffset(offset + 40)}
            >
              Next
            </button>
          </footer>
        </aside>
        <article className="ts-detail" aria-busy={!!selected && !detail}>
          {!detail ? (
            <div className="ts-empty">
              <Icon name="Team space" />
              <h2>
                {selected
                  ? "Opening note…"
                  : "A little context goes a long way."}
              </h2>
              <p>
                Open a discussion or report to read the full story and add your
                response. Notes are shared only with teammates who can access
                that brand.
              </p>
            </div>
          ) : (
            <>
              <header className="ts-detail-heading">
                <small>
                  {brands.find((b) => b.id === current!.brand_id)?.name} ·{" "}
                  {current!.kind === "report"
                    ? "Weekly report"
                    : current!.category}{" "}
                  · {current!.status}
                </small>
                <h2>{current!.title}</h2>
                <p>
                  {current!.author_name || author || "Team member"} ·{" "}
                  {date(current!.created_at)}
                  {current!.week_start
                    ? " · Week of " + weekLabel(current!.week_start)
                    : ""}
                </p>
                <div>
                  <button
                    disabled={busy || !!reply.trim()}
                    onClick={() => show(current!.id)}
                  >
                    Refresh conversation
                  </button>
                  {current!.created_by === detail.userId && (
                    <button disabled={busy} onClick={() => compose(current!)}>
                      Edit {current!.kind === "report" ? "report" : "note"}
                    </button>
                  )}
                  {current!.kind === "discussion" &&
                    (current!.created_by === detail.userId ||
                      detail.role === "super_admin") && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          act(
                            current!.status === "resolved"
                              ? "reopen"
                              : "resolve",
                          )
                        }
                      >
                        {current!.status === "resolved"
                          ? "Reopen"
                          : "Mark resolved"}
                      </button>
                    )}
                </div>
              </header>
              {current!.reference_id && (
                <aside className="ts-reference">
                  <b>
                    {current!.reference_kind === "ad" ? "Ad build" : "Post"}{" "}
                    reference
                  </b>
                  <p>
                    {detail.linked?.title ||
                      "This linked item is no longer available."}
                  </p>
                  {detail.linked && (
                    <small>
                      {detail.linked.status} · Live reference; open the relevant
                      workspace to edit.
                    </small>
                  )}
                </aside>
              )}
              <section className="ts-body">
                {current!.kind === "report" && (
                  <h3>Work completed & outcomes</h3>
                )}
                <p>{current!.body}</p>
                {current!.kind === "report" &&
                  [
                    ["Observations & lessons", current!.observations],
                    ["Requests & blockers", current!.requests],
                    ["Next week’s priorities", current!.next_steps],
                  ].map(([title, value]) => (
                    <section key={title}>
                      <h3>{title}</h3>
                      <p>{value || "Nothing added."}</p>
                    </section>
                  ))}
              </section>
              {current!.status !== "draft" ? (
                <>
                  <div className="ts-readers">
                    <small>
                      {detail.readers.length
                        ? "Read current update: " +
                          detail.readers.map((r) => r.name).join(", ")
                        : "No read acknowledgements yet."}
                    </small>
                  </div>
                  <section className="ts-replies">
                    <h3>
                      Conversation <span>{detail.replies.length}</span>
                    </h3>
                    {detail.replies.map((r) => (
                      <article key={r.id}>
                        <header>
                          <b>{r.author_name}</b>
                          <small>{date(r.created_at)}</small>
                        </header>
                        <p>{r.body}</p>
                      </article>
                    ))}
                    {!detail.replies.length && (
                      <p className="ed-muted">
                        Add context, answer a question or help unblock the next
                        step.
                      </p>
                    )}
                    {detail.replyLimit && (
                      <p className="ed-muted">
                        Showing the latest 500 replies. Start a follow-up
                        discussion to continue.
                      </p>
                    )}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        act("reply");
                      }}
                    >
                      <label htmlFor="team-reply">Your reply</label>
                      <textarea
                        id="team-reply"
                        rows={3}
                        maxLength={4000}
                        value={reply}
                        onChange={(e) => {
                          setReply(e.target.value);
                          replyKey.current = "";
                        }}
                        placeholder="Write to the team…"
                      />
                      <button
                        className="primary"
                        disabled={busy || !reply.trim()}
                      >
                        {busy ? "Saving…" : "Send reply"}
                      </button>
                    </form>
                  </section>
                </>
              ) : (
                <div className="ts-private">
                  <b>Only you can see this draft.</b>
                  <p>
                    Open Edit report, then Share report when it’s ready for the
                    team.
                  </p>
                </div>
              )}
              {!!detail.versions.length && (
                <details className="ts-history">
                  <summary>
                    Shared report history · {detail.versions.length} versions
                    {detail.versions.length === 50 ? " (latest 50)" : ""}
                  </summary>
                  {detail.versions.map((v) => (
                    <details key={v.version}>
                      <summary>
                        Version {v.version} · {date(v.created_at)}
                      </summary>
                      <h3>{v.snapshot.title}</h3>
                      {[
                        ["Work completed", v.snapshot.body],
                        ["Observations", v.snapshot.observations],
                        ["Requests", v.snapshot.requests],
                        ["Next week", v.snapshot.next_steps],
                      ].map(([label, value]) => (
                        <section key={label}>
                          <b>{label}</b>
                          <p>{value || "Nothing added."}</p>
                        </section>
                      ))}
                    </details>
                  ))}
                </details>
              )}
            </>
          )}
        </article>
      </div>
      {form && (
        <Modal
          wide
          title={
            form.kind === "report"
              ? "Your weekly report"
              : form.id
                ? "Edit discussion"
                : "Start a discussion"
          }
          close={() => {
            if (!busy && confirm("Close without saving these changes?"))
              setForm(null);
          }}
        >
          <form
            className="ts-composer"
            onSubmit={(e) => {
              e.preventDefault();
              save(form.kind === "discussion" || form.published);
            }}
          >
            <p className="ts-hint">
              {form.kind === "report"
                ? "Make it useful for someone who wasn’t in the room. Record outcomes, context and the help you need."
                : "Keep questions and decisions beside the brand’s work. Everyone with access to this brand can read and reply."}
            </p>
            <div className="ts-form-grid">
              <label>
                Brand
                <select
                  required
                  value={form.brandId}
                  disabled={busy || !!form.id}
                  onChange={(e) => {
                    edit("brandId", e.target.value);
                    edit("referenceId", "");
                  }}
                >
                  {brands.map((b) => (
                    <option value={b.id} key={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              {form.kind === "report" ? (
                <label>
                  Week containing
                  <input
                    type="date"
                    required
                    value={form.weekStart}
                    disabled={busy || !!form.id}
                    onChange={(e) => edit("weekStart", e.target.value)}
                  />
                  <small>Saved under the Monday of this week.</small>
                </label>
              ) : (
                <label>
                  Type
                  <select
                    value={form.category}
                    disabled={busy || !!form.id}
                    onChange={(e) => edit("category", e.target.value)}
                  >
                    {["question", "request", "observation", "update"].map(
                      (c) => (
                        <option key={c} value={c}>
                          {c[0].toUpperCase() + c.slice(1)}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              )}
            </div>
            <label>
              {form.kind === "report" ? "Report headline" : "Subject"}
              <input
                required
                maxLength={160}
                value={form.title}
                disabled={busy}
                onChange={(e) => edit("title", e.target.value)}
                placeholder={
                  form.kind === "report"
                    ? "Launch progress, audience learning and next steps"
                    : "What would you like to discuss?"
                }
              />
            </label>
            {form.kind === "discussion" && !form.id && (
              <div className="ts-form-grid">
                <label>
                  Link to work (optional)
                  <select
                    value={form.referenceKind}
                    disabled={busy}
                    onChange={(e) => {
                      edit("referenceKind", e.target.value);
                      edit("referenceId", "");
                    }}
                  >
                    <option value="">General discussion</option>
                    <option value="post">Post</option>
                    <option value="ad">Ad build</option>
                  </select>
                </label>
                {form.referenceKind && (
                  <label>
                    Choose {form.referenceKind === "ad" ? "ad build" : "post"}
                    <select
                      required
                      value={form.referenceId}
                      disabled={busy}
                      onChange={(e) => edit("referenceId", e.target.value)}
                    >
                      <option value="">Choose an item</option>
                      {form.referenceId &&
                        !(
                          form.referenceKind === "ad" ? refs.ads : refs.posts
                        ).some((r) => r.id === form.referenceId) && (
                          <option value={form.referenceId}>{form.title}</option>
                        )}
                      {(form.referenceKind === "ad"
                        ? refs.ads
                        : refs.posts
                      ).map((r) => (
                        <option value={r.id} key={r.id}>
                          {r.title || "Untitled"} · {r.status}
                        </option>
                      ))}
                    </select>
                    <small>Latest 100 items for this brand.</small>
                  </label>
                )}
              </div>
            )}
            <label>
              {form.kind === "report" ? "Work completed & outcomes" : "Message"}
              <textarea
                required
                rows={6}
                maxLength={8000}
                value={form.body}
                disabled={busy}
                onChange={(e) => edit("body", e.target.value)}
                placeholder={
                  form.kind === "report"
                    ? "What moved forward? Add concrete results, relevant dates and any context the team should retain."
                    : "Explain the question, issue or decision needed."
                }
              />
            </label>
            {form.kind === "report" && (
              <>
                <label>
                  Observations & lessons
                  <textarea
                    rows={3}
                    maxLength={4000}
                    value={form.observations}
                    disabled={busy}
                    onChange={(e) => edit("observations", e.target.value)}
                    placeholder="Audience responses, campaign learnings, patterns worth watching…"
                  />
                </label>
                <label>
                  Requests & blockers
                  <textarea
                    rows={3}
                    maxLength={4000}
                    value={form.requests}
                    disabled={busy}
                    onChange={(e) => edit("requests", e.target.value)}
                    placeholder="What do you need, from whom, and by when?"
                  />
                </label>
                <label>
                  Next week’s priorities
                  <textarea
                    rows={3}
                    maxLength={4000}
                    value={form.next_steps}
                    disabled={busy}
                    onChange={(e) => edit("next_steps", e.target.value)}
                    placeholder="The next few outcomes you’re working towards…"
                  />
                </label>
              </>
            )}
            {error && (
              <p className="secure-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <span>
                {form.published
                  ? "Shared updates keep a version history."
                  : form.kind === "report"
                    ? "Drafts are private. Sharing makes this visible to the brand team."
                    : "Visible to this brand’s team."}
              </span>
              {form.kind === "report" && !form.published && (
                <button type="submit" disabled={busy || !form.brandId}>
                  Save private draft
                </button>
              )}
              <button
                type={
                  form.kind === "discussion" || form.published
                    ? "submit"
                    : "button"
                }
                className="primary"
                disabled={
                  busy ||
                  !form.brandId ||
                  !form.title.trim() ||
                  !form.body.trim()
                }
                onClick={
                  form.kind === "report" && !form.published
                    ? () => save(true)
                    : undefined
                }
              >
                {busy
                  ? "Saving…"
                  : form.id
                    ? form.kind === "report"
                      ? form.published
                        ? "Save shared update"
                        : "Share report"
                      : "Save changes"
                    : form.kind === "report"
                      ? "Share report"
                      : "Post discussion"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}

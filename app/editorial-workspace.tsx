import { AssetPreview } from "./asset-preview";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { useEffect, useState } from "react";
import { Modal, Icon } from "./ui";
import { PostComposer } from "./publishing-workspace";
import type { Post, Data } from "./publishing-workspace";
type Brand = { id: string; name: string };
type Editorial = Post & { author_name: string; reviewer_name: string | null };
type Results = {
  posts: Editorial[];
  undated: Editorial[];
  userId: string;
  role: string;
  limit: number;
  undatedLimit: number;
};
type Detail = {
  post: Post;
  reviewers: { id: string; name: string; email: string }[];
  comments: {
    id: string;
    body: string;
    author_name: string;
    created_at: number;
  }[];
  events: { id: string; message: string; created_at: number }[];
};
const reviewLabel: Record<string, string> = {
  none: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
};
const reviewName = (p: Post) =>
  p.editorial_status === "changes_requested" && p.review_decision === "rejected"
    ? "Rejected · revise draft"
    : p.editorial_status === "approved" && p.review_mode === "feedback"
      ? "Feedback complete"
      : reviewLabel[p.editorial_status];
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayDate = (key: string) => new Date(key + "T12:00:00");
const localInput = (n: number | null) =>
  n
    ? new Date(n - new Date(n).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
const format = (n: number) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(n);
const dateOf = (p: Post) => p.published_at || p.scheduled_at || p.planned_at;
const stateOf = (p: Post) =>
  p.status === "draft"
    ? reviewName(p) || "Draft"
    : p.status === "uncertain"
      ? "Delivery needs review"
      : p.status[0].toUpperCase() + p.status.slice(1);
async function api<T>(path: string, body?: unknown) {
  const r = await fetch(path, {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    d = (await r.json()) as T & { message?: string };
  if (!r.ok)
    throw new Error(
      d.message || "Could not complete the request. Please retry.",
    );
  return d;
}
export function EditorialWorkspace({
  brands,
  reviews = false,
}: {
  brands: Brand[];
  reviews?: boolean;
}) {
  const [month, setMonth] = useState(
      () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    ),
    [selectedDay, setSelectedDay] = useState(() => dayKey(new Date())),
    [brand, setBrand] = useState(""),
    [result, setResult] = useState<Results | null>(null),
    [publishing, setPublishing] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [scope, setScope] = useState("All reviews"),
    [status, setStatus] = useState("in_review"),
    [selected, setSelected] = useState<Editorial | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [comment, setComment] = useState(""),
    [reviewer, setReviewer] = useState(""),
    [reviewMode, setReviewMode] = useState<"feedback" | "approval">("feedback"),
    [planned, setPlanned] = useState(""),
    [composer, setComposer] = useState<Post | "new" | null>(null),
    [search, setSearch] = useState("");
  const unsaved =
    !!selected &&
    !!detail &&
    (!!note.trim() ||
      !!comment.trim() ||
      planned !== localInput(detail.post.planned_at));
  useUnsavedChanges(unsaved);
  function dismissReview() {
    if (
      !busy &&
      (!unsaved ||
        confirm("Close without saving your review notes or planning changes?"))
    )
      setSelected(null);
  }
  const start = new Date(
      month.getFullYear(),
      month.getMonth(),
      1 - ((month.getDay() + 6) % 7),
    ),
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42),
    monthKey = dayKey(month),
    today = dayKey(new Date()),
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  async function load() {
    try {
      const [data, pub] = await Promise.all([
        api<Results>(
          reviews
            ? "/api/editorial?view=reviews"
            : `/api/editorial?start=${start.getTime()}&end=${end.getTime()}`,
        ),
        api<Data>("/api/publishing"),
      ]);
      setResult(data);
      setPublishing(pub);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setLoading(true);
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [monthKey, reviews]);
  async function show(post: Editorial) {
    setSelected(post);
    setDetail(null);
    setNote("");
    setComment("");
    setPlanned(localInput(post.planned_at));
    setError("");
    try {
      const d = await api<Detail>("/api/editorial/" + post.id);
      setDetail(d);
      setReviewMode(
        d.post.editorial_status === "none" ? "feedback" : d.post.review_mode,
      );
      setPlanned(localInput(d.post.planned_at));
      setReviewer(
        d.reviewers.some((r) => r.id === d.post.reviewer_id)
          ? d.post.reviewer_id!
          : d.reviewers[0]?.id || "",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function act(action: string) {
    if (!selected || !detail) return;
    if (
      action === "withdraw" &&
      !confirm(
        detail.post.review_mode === "approval"
          ? "Cancel this approval hold? Authorized teammates will be able to publish without approval. The activity history will be kept."
          : "Cancel this feedback request? The discussion and activity history will be kept.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api("/api/editorial/" + selected.id, {
        action,
        version: detail.post.version,
        note: action === "comment" ? comment : note,
        reviewerId: reviewer,
        reviewMode,
        plannedAt: planned ? new Date(planned).toISOString() : null,
      });
      const fresh = await api<Detail>("/api/editorial/" + selected.id);
      setDetail(fresh);
      if (action === "comment") setComment("");
      else if (action !== "plan") setNote("");
      if (action === "plan") setPlanned(localInput(fresh.post.planned_at));
      await load();
      setNotice(
        (
          {
            plan: "Calendar updated. No delivery was scheduled.",
            submit: "Review requested.",
            approve:
              "This content version is approved. Nothing has been published.",
            request_changes: "Revision request saved.",
            reject:
              "Version rejected. Feedback is saved in the activity history; the draft is retained.",
            comment: "Comment added.",
            withdraw:
              "Review cancelled. This draft no longer has a publishing hold.",
            reassign: "Review reassigned to your teammate.",
          } as Record<string, string>
        )[action],
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const matches = (p: Editorial) =>
    (!brand || p.brand_id === brand) &&
    (!search ||
      (p.text + " " + p.brand_name + " " + p.author_name)
        .toLowerCase()
        .includes(search.toLowerCase()));
  const posts = (result?.posts || []).filter(matches),
    undated = (result?.undated || []).filter(matches),
    dayPosts = posts.filter(
      (p) => dateOf(p) && dayKey(new Date(dateOf(p)!)) === selectedDay,
    ),
    reviewPosts = posts.filter(
      (p) =>
        (!status || p.editorial_status === status) &&
        (scope === "All reviews" ||
          (scope === "Assigned to me" && p.reviewer_id === result?.userId) ||
          (scope === "My submissions" && p.submitted_by === result?.userId)),
    );
  const current = detail ? { ...selected!, ...detail.post } : selected,
    canManage =
      !!current &&
      current.status === "draft" &&
      (result?.role === "super_admin" ||
        [
          current.created_by,
          current.edited_by,
          current.submitted_by,
          current.reviewer_id,
        ].includes(result?.userId || "")),
    canDecide =
      !!current &&
      current.editorial_status === "in_review" &&
      current.status === "draft" &&
      result?.userId !== current.submitted_by &&
      result?.userId !== (current.edited_by || current.created_by) &&
      (result?.role === "super_admin" ||
        result?.userId === current.reviewer_id);
  function step(n: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + n, 1);
    setMonth(next);
    setSelectedDay(dayKey(next));
  }
  return (
    <div className="editorial-workspace">
      <div className="lp-intro">
        <div>
          <span className="a-eyebrow">
            {reviews ? "TEAM REVIEW" : "YOUR EDITORIAL CALENDAR"}
          </span>
          <h1>
            {reviews
              ? "Good work gets a second pair of eyes."
              : "Make room for the right stories."}
          </h1>
          <p>
            {reviews
              ? "Ask a teammate for feedback when it helps. Routine posts need no approval; choose a publishing hold only for content that needs sign-off."
              : "Plan the month across your brands. Dates on this calendar are plans until you explicitly schedule delivery."}
          </p>
        </div>
        <button
          className="primary"
          disabled={!brands.length || !publishing}
          onClick={() => setComposer("new")}
        >
          <Icon name="plus" />
          Create draft
        </button>
      </div>
      {notice && (
        <div className="secure-notice" role="status">
          {notice}
          <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      {error && !selected && (
        <div className="access-error" role="alert">
          {error}
          <button onClick={load}>Retry</button>
        </div>
      )}
      <div className="ed-toolbar">
        <div className="ed-month-nav">
          {reviews ? (
            <div className="ed-scope">
              {["All reviews", "Assigned to me", "My submissions"].map((s) => (
                <button
                  className={scope === s ? "active" : ""}
                  key={s}
                  onClick={() => setScope(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : (
            <>
              <button aria-label="Previous month" onClick={() => step(-1)}>
                ←
              </button>
              <h2>
                {month.toLocaleString("en-GB", {
                  month: "long",
                  year: "numeric",
                })}
              </h2>
              <button aria-label="Next month" onClick={() => step(1)}>
                →
              </button>
              <button
                onClick={() => {
                  setMonth(
                    new Date(
                      new Date().getFullYear(),
                      new Date().getMonth(),
                      1,
                    ),
                  );
                  setSelectedDay(today);
                }}
              >
                Today
              </button>
            </>
          )}
        </div>
        <select
          aria-label="Filter by brand"
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
          aria-label="Search editorial content"
          placeholder="Find a story…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button aria-label="Refresh editorial workspace" onClick={load}>
          ↻
        </button>
      </div>
      {loading ? (
        <div className="secure-empty">
          <h3>Loading your editorial workspace…</h3>
        </div>
      ) : reviews ? (
        <>
          <div className="ed-review-tabs">
            {[
              ["in_review", "Awaiting review"],
              ["changes_requested", "Changes requested"],
              ["approved", "Completed"],
              ["none", "Drafts to share"],
            ].map(([s, label]) => (
              <button
                key={s}
                className={status === s ? "active" : ""}
                onClick={() => setStatus(s)}
              >
                {label}
                <b>{posts.filter((p) => p.editorial_status === s).length}</b>
              </button>
            ))}
          </div>
          {!reviewPosts.length ? (
            <div className="lp-empty">
              <div className="lp-empty-symbol">✓</div>
              <h2>
                {status === "in_review"
                  ? "A little breathing room."
                  : "Nothing here yet."}
              </h2>
              <p>
                {status === "in_review"
                  ? "No one is waiting for feedback in this view. Open Drafts to share to ask a teammate for a second opinion."
                  : "Try another review status, brand or view."}
              </p>
            </div>
          ) : (
            <div className="ed-review-list">
              {reviewPosts.map((p) => (
                <button key={p.id} onClick={() => show(p)}>
                  <div className="ed-review-content">
                    {p.media_id && <AssetPreview id={p.media_id} alt="" />}
                    <div>
                      <small>
                        {p.brand_name} · {p.page_name || "Page not assigned"}
                      </small>
                      <h3>{p.text || "Untitled draft"}</h3>
                      <p>
                        By {p.author_name} · Reviewer:{" "}
                        {p.reviewer_name || "Not assigned"}
                      </p>
                    </div>
                  </div>
                  <span className={"ed-pill " + p.editorial_status}>
                    {reviewName(p)}
                    {p.editorial_status !== "none" && (
                      <small>
                        {p.review_mode === "approval"
                          ? "Approval hold"
                          : "Feedback only"}
                      </small>
                    )}
                  </span>
                  <span className="ed-review-date">
                    {p.planned_at ? format(p.planned_at) : "No planned date"}
                    <b>Open draft</b>
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="ed-calendar-layout">
          <section className="ed-calendar">
            <div className="ed-weekdays">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="ed-month-grid">
              {Array.from({ length: 42 }, (_, i) => {
                const d = new Date(
                    start.getFullYear(),
                    start.getMonth(),
                    start.getDate() + i,
                  ),
                  key = dayKey(d),
                  items = posts.filter(
                    (p) => dateOf(p) && dayKey(new Date(dateOf(p)!)) === key,
                  );
                return (
                  <div
                    key={key}
                    className={
                      "ed-day " +
                      (d.getMonth() !== month.getMonth() ? "outside " : "") +
                      (key === selectedDay ? "selected " : "") +
                      (key === today ? "today" : "")
                    }
                  >
                    <button
                      className="ed-day-number"
                      aria-label={d.toLocaleDateString("en-GB", {
                        dateStyle: "full",
                      })}
                      aria-pressed={key === selectedDay}
                      onClick={() => setSelectedDay(key)}
                    >
                      {d.getDate()}
                    </button>
                    {items.slice(0, 3).map((p) => (
                      <button
                        className={"ed-calendar-post " + p.editorial_status}
                        key={p.id}
                        onClick={() => show(p)}
                      >
                        <b>{p.brand_name}</b>
                        <span>{p.text || "Untitled draft"}</span>
                        <small>
                          {p.status === "draft" ? "Planned" : stateOf(p)}
                        </small>
                      </button>
                    ))}
                    {items.length > 3 && (
                      <button
                        className="ed-more"
                        onClick={() => setSelectedDay(key)}
                      >
                        +{items.length - 3} more
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <footer className="ed-calendar-legend">
              <span>
                <i />
                Draft
              </span>
              <span>
                <i className="in_review" />
                In review
              </span>
              <span>
                <i className="approved" />
                Approved
              </span>
              <small>{zone}</small>
            </footer>
          </section>
          <aside className="ed-day-panel">
            <header>
              <span className="a-eyebrow">DAY PLAN</span>
              <h2>
                {dayDate(selectedDay).toLocaleDateString("en-GB", {
                  weekday: "long",
                  day: "numeric",
                  month: "short",
                })}
              </h2>
            </header>
            {dayPosts.length ? (
              dayPosts.map((p) => (
                <button
                  className="ed-day-item"
                  key={p.id}
                  onClick={() => show(p)}
                >
                  <small>
                    {p.brand_name} · {stateOf(p)}
                  </small>
                  <b>{p.text || "Untitled draft"}</b>
                </button>
              ))
            ) : (
              <p className="ed-muted">An open space in your calendar.</p>
            )}
            <button
              className="ed-add-day"
              disabled={!publishing || !brands.length}
              onClick={() => setComposer("new")}
            >
              + Plan a post for this day
            </button>
            <div className="ed-unscheduled">
              <h3>
                Without a date <span>{undated.length}</span>
              </h3>
              <p>Ideas ready to find their place.</p>
              {undated.length ? (
                undated.map((p) => (
                  <button key={p.id} onClick={() => show(p)}>
                    <small>{p.brand_name}</small>
                    <b>{p.text || "Untitled draft"}</b>
                  </button>
                ))
              ) : (
                <small>No undated drafts.</small>
              )}
            </div>
          </aside>
        </div>
      )}
      <p className="lp-footnote">
        {reviews
          ? "Feedback never blocks publishing. An explicit approval hold covers one content version. Review actions never publish automatically."
          : "Planning dates do not create delivery jobs. Published and scheduled posts also appear on their actual delivery dates."}
        {result && posts.length >= result.limit
          ? " Showing up to 1,000 matching posts."
          : ""}
        {undated.length >= 100 ? " Showing the latest 100 undated drafts." : ""}
      </p>
      {composer && publishing && (
        <PostComposer
          key={composer === "new" ? "new" : composer.id}
          initial={composer === "new" ? null : composer}
          brands={brands}
          data={publishing}
          initialPlanned={!reviews ? selectedDay + "T09:00" : undefined}
          close={() => setComposer(null)}
          saved={async () => {
            setComposer(null);
            setNotice("Draft saved. Your team can now plan and review it.");
            await load();
          }}
        />
      )}
      {selected && (
        <Modal title="Editorial review" close={dismissReview} wide>
          {!detail ? (
            <div className="secure-empty">
              <p>{error || "Loading this draft…"}</p>
              {error && <button onClick={() => show(selected)}>Retry</button>}
            </div>
          ) : (
            <div className="ed-review-detail">
              <section className="ed-review-preview">
                <div className="ed-review-brand">
                  <span className="li-platform">in</span>
                  <div>
                    <b>{selected.brand_name}</b>
                    <small>
                      {selected.page_name || "Page can be assigned later"}
                    </small>
                  </div>
                  <span className={"ed-pill " + current!.editorial_status}>
                    {stateOf(current!)}
                  </span>
                </div>
                <p className="ed-full-text">
                  {current!.text || "Untitled draft"}
                </p>
                {current!.media_id && (
                  <AssetPreview
                    className="ed-full-image"
                    id={current!.media_id}
                    alt={current!.alt_text || "Draft media"}
                  />
                )}
                <div className="ed-preview-footer">
                  <small>
                    Version {current!.version} · {current!.status}
                  </small>
                  {current!.status === "draft" && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (
                          unsaved &&
                          !confirm(
                            "Open the editor without saving your review notes?",
                          )
                        )
                          return;
                        setComposer(current!);
                        setSelected(null);
                      }}
                    >
                      Edit draft →
                    </button>
                  )}
                </div>
                <h3>Discussion</h3>
                {detail.comments.length ? (
                  detail.comments.map((c) => (
                    <article className="ed-comment" key={c.id}>
                      <header>
                        <b>{c.author_name}</b>
                        <small>{format(c.created_at)}</small>
                      </header>
                      <p>{c.body}</p>
                    </article>
                  ))
                ) : (
                  <p className="ed-muted">
                    Keep feedback with the draft so nothing gets lost.
                  </p>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    act("comment");
                  }}
                >
                  <label className="ed-label">
                    Comment or flag one issue
                    <textarea
                      value={comment}
                      maxLength={2000}
                      rows={3}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Share context, a suggestion or a question…"
                    />
                  </label>
                  <button
                    className="ed-comment-submit"
                    disabled={busy || !comment.trim()}
                  >
                    Add comment
                  </button>
                </form>
              </section>
              <aside className="ed-review-actions">
                {error && (
                  <p role="alert" className="access-error">
                    {error}
                  </p>
                )}
                <span className="a-eyebrow">PLAN & TEAM REVIEW</span>
                <div
                  className={
                    "ed-review-policy " +
                    (current!.review_mode === "approval" &&
                    current!.editorial_status !== "none"
                      ? "held"
                      : "")
                  }
                >
                  <b>
                    {current!.review_mode === "approval" &&
                    current!.editorial_status !== "none"
                      ? "Approval requested for this content"
                      : "Feedback is optional"}
                  </b>
                  <p>
                    {current!.review_mode === "approval" &&
                    current!.editorial_status !== "none"
                      ? "An authorized teammate can approve this version. Review participants can reassign the request or cancel the hold."
                      : "Admins can publish routine content directly. Ask another brand teammate for advice whenever it helps; no super-admin sign-off is needed."}
                  </p>
                </div>
                <label className="ed-label">
                  Planned date
                  <input
                    type="datetime-local"
                    value={planned}
                    disabled={busy || current!.status !== "draft"}
                    onChange={(e) => setPlanned(e.target.value)}
                  />
                  <small>{zone} · Planning only</small>
                </label>
                {current!.status === "draft" && (
                  <button
                    className="ed-secondary"
                    disabled={busy}
                    onClick={() => act("plan")}
                  >
                    Save planning date
                  </button>
                )}
                {current!.review_note && (
                  <div className="ed-review-note">
                    <b>Latest review note</b>
                    <p>{current!.review_note}</p>
                  </div>
                )}
                {current!.status === "draft" &&
                  ["none", "changes_requested"].includes(
                    current!.editorial_status,
                  ) && (
                    <>
                      <label className="ed-review-hold">
                        <input
                          type="checkbox"
                          checked={reviewMode === "approval"}
                          disabled={busy}
                          onChange={(e) =>
                            setReviewMode(
                              e.target.checked ? "approval" : "feedback",
                            )
                          }
                        />
                        <span>
                          Hold publishing until approved
                          <small>
                            Use for a launch, new product or content that needs
                            sign-off. Leave off for everyday feedback.
                          </small>
                        </span>
                      </label>
                      <label className="ed-label">
                        Reviewer
                        <select
                          value={reviewer}
                          onChange={(e) => setReviewer(e.target.value)}
                          disabled={busy}
                        >
                          <option value="">Choose a teammate</option>
                          {detail.reviewers.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!detail.reviewers.length && (
                        <p className="ed-muted">
                          A second teammate with brand access is needed to
                          review this draft.
                        </p>
                      )}
                      <label className="ed-label">
                        Context for the reviewer
                        <textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          rows={3}
                          maxLength={2000}
                          placeholder="Anything they should look out for?"
                        />
                      </label>
                      <button
                        className="primary"
                        disabled={busy || !reviewer || !current!.text.trim()}
                        onClick={() => act("submit")}
                      >
                        {busy
                          ? "Saving…"
                          : reviewMode === "approval"
                            ? "Request approval & hold"
                            : "Ask for feedback"}
                      </button>
                    </>
                  )}
                {canDecide && (
                  <>
                    <label className="ed-label">
                      Review feedback
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={4}
                        maxLength={2000}
                        placeholder="Be specific: what needs fixing, why, and what a good revision would look like."
                      />
                    </label>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => act("approve")}
                    >
                      {current!.review_mode === "approval"
                        ? "Approve this version"
                        : "Mark feedback complete"}
                    </button>
                    <button
                      className="ed-secondary"
                      disabled={busy || !note.trim()}
                      onClick={() => act("request_changes")}
                    >
                      Request changes
                    </button>
                    <button
                      className="ed-secondary"
                      disabled={busy || !note.trim()}
                      onClick={() => act("reject")}
                    >
                      Reject this version
                    </button>
                    <small className="ed-muted">
                      Changes and rejection require feedback. To flag one issue
                      without deciding the review, add a comment in the
                      discussion. Feedback-only reviews do not block publishing.
                    </small>
                  </>
                )}
                {current!.editorial_status === "in_review" && !canDecide && (
                  <p className="ed-muted">
                    {current!.review_mode === "approval"
                      ? "Publishing is held for the assigned reviewer. You can reassign or cancel the request below."
                      : "Your teammate has been asked for feedback. You can continue working and publish when ready."}
                  </p>
                )}
                {current!.editorial_status === "approved" &&
                  current!.status === "draft" && (
                    <div className="ed-approved-note">
                      <b>
                        {current!.review_mode === "approval"
                          ? "Approved for the next step"
                          : "Feedback complete"}
                      </b>
                      <p>
                        Team review does not schedule or publish this post. Open
                        the editor when you are ready for delivery.
                      </p>
                    </div>
                  )}
                {canManage && current!.editorial_status === "in_review" && (
                  <div className="ed-review-manage">
                    <label className="ed-label">
                      Pass to another teammate
                      <select
                        value={reviewer}
                        disabled={busy}
                        onChange={(e) => setReviewer(e.target.value)}
                      >
                        <option value="">Choose a teammate</option>
                        {detail.reviewers
                          .filter((r) => r.id !== current!.submitted_by)
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      className="ed-secondary"
                      disabled={
                        busy ||
                        !reviewer ||
                        reviewer === current!.reviewer_id ||
                        reviewer === current!.submitted_by
                      }
                      onClick={() => act("reassign")}
                    >
                      Reassign review
                    </button>
                  </div>
                )}
                {canManage && current!.editorial_status !== "none" && (
                  <button
                    className="ed-secondary"
                    disabled={busy}
                    onClick={() => act("withdraw")}
                  >
                    {current!.review_mode === "approval"
                      ? "Cancel approval hold"
                      : "Cancel feedback request"}
                  </button>
                )}
                <h3>Activity</h3>
                <div className="ed-history">
                  {detail.events.map((e) => (
                    <div className="lp-event" key={e.id}>
                      <i />
                      <div>
                        <b>{e.message}</b>
                        <small>{format(e.created_at)}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

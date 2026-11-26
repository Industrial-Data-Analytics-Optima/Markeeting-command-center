import { useUnsavedChanges } from "./use-unsaved-changes";
import { AssetPreview } from "./asset-preview";
import { MediaWorkspace } from "./media-workspace";
import { uploadMedia } from "./upload-media";
import { useEffect, useState, useRef } from "react";
import { Modal, Icon } from "./ui";
import { download } from "./workspace-model";
type Brand = { id: string; name: string };
type Page = { id: string; name: string; brand_id: string; status: string };
export type Post = {
  id: string;
  planned_at: number | null;
  editorial_status: string;
  review_mode: "feedback" | "approval";
  review_decision?: "approved" | "changes_requested" | "rejected" | null;
  reviewer_id: string | null;
  submitted_by: string | null;
  edited_by: string | null;
  created_by: string;
  review_note: string | null;
  brand_id: string;
  brand_name: string;
  page_id: string | null;
  page_name: string | null;
  text: string;
  alt_text: string;
  media_id: string | null;
  reshare_post_id: string | null;
  status: string;
  version: number;
  scheduled_at: number | null;
  published_at: number | null;
  updated_at: number;
  time_zone: string;
  error_message: string | null;
  provider_post_id: string | null;
  impressions: number | null;
  clicks: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  unique_impressions: number | null;
  synced_at: number | null;
  metrics_error: string | null;
};
export type Data = {
  posts: Post[];
  pages: Page[];
  schedulerActive: boolean;
  publishingConfigured: boolean;
  mediaAvailable: boolean;
  limit: number;
};
const labels: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  processing: "Publishing",
  published: "Published",
  failed: "Failed",
  uncertain: "Needs review",
  cancelled: "Cancelled",
};
const number = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-GB");
const engagements = (p: Post) =>
  [p.likes, p.comments, p.shares].some((v) => v == null)
    ? null
    : p.likes! + p.comments! + p.shares!;
const when = (n: number | null) =>
  n
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(n)
    : "Not scheduled";
async function request<T>(path: string, method = "GET", body?: unknown) {
  const r = await fetch(path, {
      method,
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    d = (await r.json()) as T & { message?: string };
  if (!r.ok)
    throw new Error(
      d.message || "The request could not be completed. Please retry.",
    );
  return d;
}
export function PublishingWorkspace({
  brands,
  analytics = false,
  openReviews,
}: {
  brands: Brand[];
  analytics?: boolean;
  openReviews?: () => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [tab, setTab] = useState("All posts"),
    [brand, setBrand] = useState(""),
    [search, setSearch] = useState(""),
    [composer, setComposer] = useState<Post | "new" | null>(null),
    [detail, setDetail] = useState<Post | null>(null),
    [events, setEvents] = useState<
      { status: string; message: string; created_at: number }[]
    >([]),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(0);
  async function load() {
    try {
      setData(await request<Data>("/api/publishing"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setPage(0);
  }, [tab, brand, search]);
  async function show(post: Post) {
    setDetail(post);
    setEvents([]);
    try {
      setEvents(
        (await request<{ events: typeof events }>("/api/publishing/" + post.id))
          .events,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function cancel(post: Post) {
    setBusy(true);
    try {
      await request("/api/publishing/" + post.id, "DELETE", {
        version: post.version,
      });
      setDetail(null);
      setNotice("Delivery cancelled. The saved content is still available.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const all = data?.posts || [],
    rows = all.filter(
      (p) =>
        (!brand || p.brand_id === brand) &&
        (!search ||
          (p.text + " " + p.brand_name + " " + p.page_name)
            .toLowerCase()
            .includes(search.toLowerCase())) &&
        (analytics
          ? p.status === "published"
          : tab === "All posts" ||
            (tab === "Needs attention"
              ? ["failed", "uncertain"].includes(p.status)
              : p.status ===
                (
                  {
                    Drafts: "draft",
                    Scheduled: "scheduled",
                    Published: "published",
                  } as Record<string, string>
                )[tab])),
    ),
    currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 10) - 1));
  const synced = rows.filter((p) => p.synced_at),
    sum = (key: "impressions" | "clicks" | "likes" | "comments" | "shares") =>
      synced.some((p) => p[key] != null)
        ? synced.reduce((n, p) => n + (p[key] ?? 0), 0)
        : null;
  return (
    <div className="live-publishing">
      <div className="lp-intro">
        <div>
          <span className="a-eyebrow">
            {analytics
              ? "LINKEDIN · ORGANIC PERFORMANCE"
              : "PLAN. REVIEW. PUBLISH."}
          </span>
          <h1>
            {analytics
              ? "The response to your work."
              : "A clear path from idea to published."}
          </h1>
          <p>
            {analytics
              ? "Reported results for posts published through this workspace."
              : "Create with context. Schedule with confidence. Keep every brand’s voice in view."}
          </p>
        </div>
        {!analytics && openReviews && (
          <button className="ed-secondary" onClick={openReviews}>
            Team review
          </button>
        )}
        {!analytics && (
          <button
            className="primary"
            disabled={!brands.length}
            onClick={() => setComposer("new")}
          >
            <Icon name="plus" />
            Create post
          </button>
        )}
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
          <button onClick={() => setNotice("")}>×</button>
        </div>
      )}
      {!analytics && data && (
        <div className="lp-service">
          <span
            className={
              "lp-service-dot " +
              (data.schedulerActive && data.publishingConfigured ? "ready" : "")
            }
          />
          <b>
            {data.schedulerActive && data.publishingConfigured
              ? "Publishing service ready"
              : "Draft workspace ready"}
          </b>
          <span>
            {!data.publishingConfigured
              ? "LinkedIn publishing is awaiting provider setup."
              : !data.schedulerActive
                ? "Delivery is paused until the scheduler is running."
                : "Scheduled posts are delivered by the server, even when you close the app."}
          </span>
          <small>No sample content</small>
        </div>
      )}
      <div className="lp-summary">
        {(analytics
          ? [
              ["Impressions", number(sum("impressions"))],
              [
                "Engagements",
                synced.some((p) => engagements(p) != null)
                  ? number(
                      synced.reduce((n, p) => n + (engagements(p) ?? 0), 0),
                    )
                  : "—",
              ],
              ["Clicks", number(sum("clicks"))],
              ["Posts with metrics", synced.length + " / " + rows.length],
            ]
          : [
              ["Drafts", all.filter((p) => p.status === "draft").length],
              ["Scheduled", all.filter((p) => p.status === "scheduled").length],
              ["Published", all.filter((p) => p.status === "published").length],
              [
                "Needs attention",
                all.filter((p) => ["failed", "uncertain"].includes(p.status))
                  .length,
              ],
            ]
        ).map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
      <div className="lp-toolbar">
        <div className="lp-tablist" role="tablist" aria-label="Post status">
          {(analytics
            ? ["Published posts"]
            : [
                "All posts",
                "Drafts",
                "Scheduled",
                "Published",
                "Needs attention",
              ]
          ).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={analytics || tab === t}
              className={analytics || tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="lp-filters">
          <select
            aria-label="Filter brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          >
            <option value="">All brands</option>
            {brands.map((b) => (
              <option value={b.id} key={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <input
            aria-label="Search posts"
            placeholder="Search posts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button aria-label="Refresh posts" onClick={load}>
            ↻
          </button>
        </div>
      </div>
      {loading ? (
        <div className="secure-empty">
          <h3>Loading your posts…</h3>
        </div>
      ) : !rows.length ? (
        <div className="lp-empty">
          <div className="lp-empty-symbol">{analytics ? "↗" : "✎"}</div>
          <h2>
            {analytics
              ? "Your published work will tell the story."
              : all.length
                ? "No posts match these filters."
                : "Your next post starts here."}
          </h2>
          <p>
            {analytics
              ? "Once posts are published, available LinkedIn metrics will appear here with their last sync time."
              : all.length
                ? "Try another brand or status."
                : "Choose a brand, write your message and save a draft. Your content stays in the workspace until you choose to publish."}
          </p>
          {!analytics && !all.length && (
            <button
              className="primary"
              disabled={!brands.length}
              onClick={() => setComposer("new")}
            >
              Create your first draft →
            </button>
          )}
        </div>
      ) : (
        <div className="lp-posts">
          {rows.slice(currentPage * 10, currentPage * 10 + 10).map((p) => (
            <article key={p.id}>
              <div className="lp-post-top">
                <span className="li-platform">in</span>
                <b>{p.brand_name}</b>
                <span>{p.page_name || "No page selected"}</span>
                <span className={"lp-status " + p.status}>
                  {labels[p.status]}
                </span>
              </div>
              <div className="lp-post-body">
                {p.media_id && (
                  <AssetPreview id={p.media_id} alt={p.alt_text || ""} />
                )}
                <button onClick={() => show(p)} className="lp-post-copy">
                  <p>{p.text || "Untitled draft"}</p>
                  <small>
                    {p.published_at
                      ? "Published " + when(p.published_at)
                      : p.scheduled_at
                        ? "Scheduled " + when(p.scheduled_at)
                        : "Edited " + when(p.updated_at)}{" "}
                    · {Intl.DateTimeFormat().resolvedOptions().timeZone}
                  </small>
                </button>
                {analytics ? (
                  <div className="lp-row-metrics">
                    <span>
                      <b>{number(p.impressions)}</b>Impressions
                    </span>
                    <span>
                      <b>{p.synced_at ? number(engagements(p)) : "—"}</b>
                      Engagements
                    </span>
                    <span>
                      <b>{number(p.clicks)}</b>Clicks
                    </span>
                  </div>
                ) : (
                  <div className="lp-post-actions">
                    {["draft", "scheduled", "failed", "cancelled"].includes(
                      p.status,
                    ) && (
                      <button onClick={() => setComposer(p)}>
                        {p.status === "failed" ? "Review & edit" : "Edit post"}
                      </button>
                    )}
                    <button onClick={() => show(p)}>Details ↗</button>
                  </div>
                )}
              </div>
              {p.error_message && (
                <div className={"lp-delivery-note " + p.status}>
                  {p.error_message}
                </div>
              )}
              {analytics && (
                <footer className="lp-metric-freshness">
                  {p.synced_at
                    ? "Last synced " + when(p.synced_at)
                    : "Awaiting first metrics sync"}
                  {p.metrics_error ? " · " + p.metrics_error : ""}
                </footer>
              )}
            </article>
          ))}
          <footer className="a-pagination">
            <span>
              {currentPage * 10 + 1}–
              {Math.min(rows.length, (currentPage + 1) * 10)} of {rows.length}
            </span>
            <button
              disabled={!currentPage}
              onClick={() => setPage(currentPage - 1)}
            >
              ← Previous
            </button>
            <button
              disabled={(currentPage + 1) * 10 >= rows.length}
              onClick={() => setPage(currentPage + 1)}
            >
              Next →
            </button>
            {analytics && (
              <button
                onClick={() =>
                  download(
                    "linkedin-organic-posts.csv",
                    rows.map((p) => ({
                      brand: p.brand_name,
                      page: p.page_name,
                      post: p.text,
                      published: p.published_at
                        ? new Date(p.published_at).toISOString()
                        : "",
                      impressions: p.impressions,
                      clicks: p.clicks,
                      likes: p.likes,
                      comments: p.comments,
                      shares: p.shares,
                      syncedAt: p.synced_at
                        ? new Date(p.synced_at).toISOString()
                        : "",
                      syncError: p.metrics_error,
                    })),
                  )
                }
              >
                Export CSV
              </button>
            )}
          </footer>
        </div>
      )}
      <p className="lp-footnote">
        {analytics
          ? "Lifetime organic metrics for these posts. Engagements = likes + comments + shares; clicks are separate. Unique reach is shown per post only and is never summed. Missing metrics appear as —."
          : "Times are shown in your browser’s time zone. Cancelling is available until delivery begins."}{" "}
        {all.length >= 200
          ? "Showing the 200 most recently updated posts."
          : ""}
      </p>
      {composer && data && (
        <PostComposer
          key={composer === "new" ? "new" : composer.id}
          brands={brands}
          data={data}
          initial={composer === "new" ? null : composer}
          close={() => setComposer(null)}
          saved={async (action) => {
            setComposer(null);
            setNotice(
              action === "draft"
                ? "Draft saved to your workspace."
                : "Post queued. Follow its delivery status here.",
            );
            await load();
          }}
        />
      )}
      {detail && (
        <Modal title="Post details" close={() => setDetail(null)}>
          <div className="lp-details">
            <span className={"lp-status " + detail.status}>
              {labels[detail.status]}
            </span>
            <h3>
              {detail.brand_name} · {detail.page_name || "No page selected"}
            </h3>
            <p className="lp-detail-text">{detail.text || "Untitled draft"}</p>
            {detail.error_message && (
              <p className="access-error">{detail.error_message}</p>
            )}
            {detail.provider_post_id && (
              <a
                target="_blank"
                rel="noreferrer"
                href={
                  "https://www.linkedin.com/feed/update/" +
                  encodeURIComponent(detail.provider_post_id)
                }
              >
                View on LinkedIn ↗
              </a>
            )}
            {detail.status === "uncertain" && (
              <p className="lp-footnote">
                Automatic retry is blocked to avoid a duplicate. A super admin
                should verify the page before preparing any replacement post.
              </p>
            )}
            {detail.status === "published" && (
              <div className="lp-detail-metrics">
                {[
                  ["Impressions", detail.impressions],
                  ["Unique impressions", detail.unique_impressions],
                  ["Clicks", detail.clicks],
                  ["Likes", detail.likes],
                  ["Comments", detail.comments],
                  ["Shares", detail.shares],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <span>{label}</span>
                    <b>{number(value as number | null)}</b>
                  </div>
                ))}
              </div>
            )}
            <h4>Delivery history</h4>
            {events.map((e, i) => (
              <div className="lp-event" key={i}>
                <i />
                <div>
                  <b>{e.message}</b>
                  <small>{when(e.created_at)}</small>
                </div>
              </div>
            ))}
            {["draft", "scheduled", "failed"].includes(detail.status) && (
              <button
                className="lp-cancel"
                disabled={busy}
                onClick={() => cancel(detail)}
              >
                {busy ? "Cancelling…" : "Cancel delivery"}
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
export function PostComposer({
  brands,
  data,
  initial,
  close,
  saved,
  initialPlanned,
}: {
  brands: Brand[];
  data: Data;
  initial: Post | null;
  close: () => void;
  saved: (action: string) => Promise<void>;
  initialPlanned?: string;
}) {
  const [brand, setBrand] = useState(initial?.brand_id || brands[0]?.id || ""),
    [page, setPage] = useState(initial?.page_id || ""),
    [text, setText] = useState(initial?.text || ""),
    [media, setMedia] = useState(initial?.media_id || ""),
    [library, setLibrary] = useState(false),
    [alt, setAlt] = useState(initial?.alt_text || ""),
    [date, setDate] = useState(
      initial?.scheduled_at
        ? new Date(
            initial.scheduled_at -
              new Date(initial.scheduled_at).getTimezoneOffset() * 60000,
          )
            .toISOString()
            .slice(0, 16)
        : "",
    ),
    [planned, setPlanned] = useState(
      initial?.planned_at
        ? new Date(
            initial.planned_at -
              new Date(initial.planned_at).getTimezoneOffset() * 60000,
          )
            .toISOString()
            .slice(0, 16)
        : initialPlanned || "",
    ),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [uploadPercent, setUploadPercent] = useState(0),
    [uploadMessage, setUploadMessage] = useState(""),
    [error, setError] = useState(""),
    [action, setAction] = useState<"draft" | "schedule" | "publish">(
      initial?.status === "scheduled" ? "schedule" : "draft",
    ),
    [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty || uploading);
  const uploadController = useRef<AbortController | null>(null);
  useEffect(() => () => uploadController.current?.abort(), []);
  const [clientKey] = useState(() => crypto.randomUUID()),
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const approvalHeld =
    !!initial &&
    initial.review_mode === "approval" &&
    initial.editorial_status !== "none" &&
    !(
      initial.editorial_status === "approved" &&
      initial.text === text &&
      (initial.media_id || "") === media &&
      initial.alt_text === alt &&
      (initial.page_id || "") === page
    );
  const pages = data.pages.filter((p) => p.brand_id === brand),
    selected = pages.find((p) => p.id === page),
    canDeliver =
      !!selected &&
      data.publishingConfigured &&
      data.schedulerActive &&
      selected.status !== "reconnect_required" &&
      !approvalHeld,
    deliveryIssue = !selected
      ? "Choose a page assigned to this brand."
      : selected.status === "reconnect_required"
        ? "This page needs your super admin’s attention in Connections."
        : !data.publishingConfigured
          ? "Live publishing will be activated during the connections phase. Your draft can still be saved."
          : !data.schedulerActive
            ? "Delivery is paused because the background scheduler is unavailable. Your draft can still be saved."
            : approvalHeld
              ? "This post has an approval hold. Get this version approved, or ask a review participant to cancel the hold in Team review."
              : "";
  const display =
    selected?.name || brands.find((b) => b.id === brand)?.name || "Your brand";
  function dismiss() {
    if (
      !busy &&
      !uploading &&
      (!dirty || window.confirm("Discard your unsaved changes?"))
    )
      close();
  }
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    setUploadPercent(0);
    setUploading(true);
    uploadController.current = new AbortController();
    try {
      const d = await uploadMedia(
        file,
        brand,
        (p, m) => {
          if (p >= 0) setUploadPercent(p);
          setUploadMessage(m);
        },
        uploadController.current.signal,
      );
      setMedia(d.id);
      setDirty(true);
    } catch (e) {
      setError(
        uploadController.current?.signal.aborted
          ? "Upload cancelled."
          : (e as Error).message,
      );
    } finally {
      setUploading(false);
      setUploadMessage("");
    }
  }
  async function submit() {
    setError("");
    setBusy(true);
    try {
      if (action === "schedule" && !date)
        throw new Error("Choose a date and time.");
      if (
        action !== "draft" &&
        !confirm(
          (action === "publish" ? "Publish now" : "Schedule publication") +
            " on " +
            display +
            "?\n" +
            (action === "schedule"
              ? when(new Date(date).getTime()) + " · " + zone
              : "Your post will be submitted to LinkedIn.") +
            "\n" +
            (media ? "One media attachment" : "Text post") +
            "\n" +
            text.slice(0, 180),
        )
      )
        return;
      await request("/api/publishing", "POST", {
        ...(initial ? { id: initial.id, version: initial.version } : {}),
        clientKey,
        brandId: brand,
        pageId: page,
        text,
        mediaId: media,
        resharePostId: initial?.reshare_post_id || null,
        altText: alt,
        action,
        scheduledAt: date ? new Date(date).toISOString() : null,
        timeZone: zone,
        plannedAt: planned ? new Date(planned).toISOString() : null,
      });
      setDirty(false);
      await saved(action);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={initial ? "Edit LinkedIn post" : "Create a LinkedIn post"}
      close={dismiss}
      wide
    >
      <div className="lp-composer">
        <section className="lp-editor">
          {initial?.reshare_post_id && (
            <div className="secure-notice">
              Native LinkedIn repost · your commentary appears above the
              original post. Reposts use the original post’s media.
            </div>
          )}
          <span className="a-eyebrow">DESTINATION</span>
          <div className="lp-destination">
            <label>
              Brand
              <select
                disabled={!!initial || uploading || busy}
                value={brand}
                onChange={(e) => {
                  setBrand(e.target.value);
                  setPage("");
                  setMedia("");
                  setDirty(true);
                }}
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              LinkedIn page
              <select
                disabled={busy}
                value={page}
                onChange={(e) => {
                  setPage(e.target.value);
                  setDirty(true);
                }}
              >
                <option value="">
                  {pages.length ? "Select a page" : "No assigned pages"}
                </option>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!pages.length && (
            <p className="lp-footnote">
              Your super admin assigns pages in Connections. You can save a
              draft now.
            </p>
          )}
          <span className="a-eyebrow">02 · YOUR MESSAGE</span>
          <label className="lp-caption">
            <span>Post text</span>
            <textarea
              value={text}
              disabled={busy}
              onChange={(e) => {
                setText(e.target.value);
                setDirty(true);
              }}
              placeholder="What does your audience need to hear today?"
              rows={9}
            />
          </label>
          <div className="lp-editor-meta">
            <span>Public · LinkedIn company page</span>
            <span className={[...text].length > 3000 ? "negative" : ""}>
              {[...text].length.toLocaleString()} / 3,000
            </span>
          </div>
          {media ? (
            <div className="lp-media-editor">
              <AssetPreview id={media} alt="Selected media" />
              <button
                disabled={busy}
                onClick={() => {
                  setMedia("");
                  setDirty(true);
                }}
              >
                Remove media
              </button>
              <label>
                Media description (image alt text)
                <input
                  value={alt}
                  disabled={busy}
                  maxLength={4086}
                  onChange={(e) => {
                    setAlt(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="Describe this asset; video captions are not generated"
                />
              </label>
            </div>
          ) : (
            <label
              className={
                "lp-upload " + (!data.mediaAvailable ? "disabled" : "")
              }
            >
              <Icon name="plus" />
              <b>
                {uploading
                  ? "Uploading to your workspace…"
                  : "Add image or video"}
              </b>
              <small>Images ≤5 MB · MP4 video ≤500 MB, 3s–30min</small>
              <input
                type="file"
                accept="image/png,image/jpeg,video/mp4"
                disabled={
                  !data.mediaAvailable ||
                  busy ||
                  uploading ||
                  !brand ||
                  !!initial?.reshare_post_id
                }
                onChange={(e) => upload(e.target.files?.[0])}
              />
            </label>
          )}
          <button
            type="button"
            disabled={!brand || busy || uploading || !!initial?.reshare_post_id}
            onClick={() => setLibrary(!library)}
          >
            {library ? "Close media library" : "Choose from media library"}
          </button>
          {uploadMessage && (
            <div className="media-progress" role="status">
              <b>
                {uploadMessage} {uploadPercent}%
              </b>
              <progress max={100} value={uploadPercent} />
              <button
                type="button"
                disabled={uploadPercent >= 96}
                onClick={() => uploadController.current?.abort()}
              >
                Cancel upload
              </button>
            </div>
          )}
          {library && (
            <MediaWorkspace
              onBusy={setUploading}
              brands={brands.filter((b) => b.id === brand)}
              onSelect={(a) => {
                setMedia(a.id);
                setAlt(a.alt_text);
                setDirty(true);
                setLibrary(false);
              }}
            />
          )}
          <label className="lp-date">
            Planned calendar date{" "}
            <input
              type="datetime-local"
              value={planned}
              onChange={(e) => {
                setPlanned(e.target.value);
                setDirty(true);
              }}
              disabled={busy}
            />
            <small>
              {zone} · Planning only; this does not schedule publication.
            </small>
          </label>
          <span className="a-eyebrow">DELIVERY</span>
          <p className="lp-footnote">
            Routine posts need no approval. For a second opinion, save a draft
            and open Team review. Only an explicit approval hold pauses
            publishing.
          </p>
          {initial?.review_mode === "approval" &&
            initial.editorial_status !== "none" && (
              <p className="lp-footnote">
                This draft is part of a review workflow. Changes to its text,
                video, image or destination require another approval before
                delivery. Review participants can cancel the hold from Team
                review.
              </p>
            )}
          <div className="lp-delivery-options">
            {(["draft", "schedule", "publish"] as const).map((a) => (
              <button
                type="button"
                disabled={busy || (a !== "draft" && !canDeliver)}
                key={a}
                className={action === a ? "active" : ""}
                onClick={() => setAction(a)}
              >
                {a === "draft"
                  ? "Save draft"
                  : a === "schedule"
                    ? "Schedule"
                    : "Publish now"}
              </button>
            ))}
          </div>
          {action === "schedule" && (
            <label className="lp-date">
              Publish date and time
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setDirty(true);
                }}
              />
              <small>
                {zone} ·{" "}
                {date ? when(new Date(date).getTime()) : "Choose a future time"}
              </small>
            </label>
          )}
          {!canDeliver && <p className="lp-footnote">{deliveryIssue}</p>}
          {error && (
            <p className="access-error" role="alert">
              {error}
            </p>
          )}
          <div className="lp-composer-actions">
            <button onClick={dismiss} disabled={busy || uploading}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                uploading ||
                [...text].length > 3000 ||
                !brand ||
                (action !== "draft" && !canDeliver)
              }
              onClick={submit}
            >
              {busy
                ? "Saving…"
                : action === "draft"
                  ? "Save draft"
                  : action === "schedule"
                    ? "Schedule post"
                    : "Publish to LinkedIn"}
            </button>
          </div>
        </section>
        <aside className="lp-preview">
          <div className="lp-preview-label">
            <span>LINKEDIN PREVIEW</span>
            <small>Approximate appearance</small>
          </div>
          <div className="lp-network-post">
            <header>
              <div className="lp-preview-logo">
                {display.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <b>{display}</b>
                <small>Company page</small>
                <small>Just now · ◉</small>
              </div>
              <span>···</span>
            </header>
            <p>
              {text ||
                "Your message will appear here. Keep the opening line clear and give people a reason to read on."}
            </p>
            {media && (
              <AssetPreview
                className="lp-preview-image"
                id={media}
                alt={alt || "Post image preview"}
              />
            )}
            <footer>
              <span>♧ Like</span>
              <span>▢ Comment</span>
              <span>↻ Repost</span>
              <span>↗ Send</span>
            </footer>
          </div>
          <div className="lp-preview-note">
            <Icon name="lock" />
            <p>
              {action === "draft"
                ? "Drafts stay private in your workspace. Nothing is published until you choose a delivery action."
                : action === "schedule"
                  ? "The server will deliver this post at the selected time. You can close the app after scheduling."
                  : "This will queue a public post on the selected LinkedIn company page."}
            </p>
          </div>
        </aside>
      </div>
    </Modal>
  );
}

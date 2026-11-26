import { useEffect, useState, FormEvent } from "react";
import { Modal, Icon } from "./ui";
import { AssetPreview } from "./asset-preview";
type Brand = { id: string; name: string };
type Post = {
  id: string;
  brand_id: string;
  brand_name: string;
  page_name: string;
  text: string;
  media_id: string | null;
  alt_text: string;
  reshare_post_id: string | null;
  published_at: number;
  provider_post_id: string;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  impressions: number | null;
  synced_at: number | null;
};
type Page = {
  id: string;
  name: string;
  brand_id: string;
  brand_name: string;
  status: string;
  canEngage: boolean;
};
type Note = {
  id: string;
  post_id: string;
  body: string;
  author_name: string;
  created_at: number;
};
type Action = {
  id: string;
  post_id: string;
  acting_page_id: string;
  page_name: string;
  brand_name: string;
  kind: string;
  body: string;
  status: string;
  error_message: string | null;
  updated_at: number;
};
type Data = {
  canResolve: boolean;
  posts: Post[];
  pages: Page[];
  saved: { post_id: string }[];
  notes: Note[];
  actions: Action[];
};
async function request<T>(url: string, data?: unknown) {
  const r = await fetch(url, {
      method: data ? "POST" : "GET",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}),
    }),
    d = (await r.json()) as T & { message?: string };
  if (!r.ok) throw new Error(d.message || "Could not load the brand feed.");
  return d;
}
export function BrandFeed({
  brands,
  openPublishing,
}: {
  brands: Brand[];
  openPublishing: () => void;
}) {
  const [clock, setClock] = useState(() => Date.now());
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pageId, setPageId] = useState(""),
    [sourceBrand, setSourceBrand] = useState(""),
    [query, setQuery] = useState(""),
    [savedOnly, setSavedOnly] = useState(false),
    [days, setDays] = useState(""),
    [modal, setModal] = useState<{
      kind: string;
      post: Post;
      page: Page | null;
    } | null>(null),
    [busy, setBusy] = useState(""),
    [resolving, setResolving] = useState<Action | null>(null);
  async function load() {
    const d = await request<Data>("/api/feed");
    setData(d);
    setClock(Date.now());
    setPageId((current) =>
      d.pages.some((p) => p.id === current) ? current : d.pages[0]?.id || "",
    );
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  const page = data?.pages.find((p) => p.id === pageId) || null,
    rows = (data?.posts || []).filter(
      (p) =>
        (!sourceBrand || p.brand_id === sourceBrand) &&
        (!savedOnly || data?.saved.some((s) => s.post_id === p.id)) &&
        (!days || p.published_at >= clock - Number(days) * 86400000) &&
        [p.text, p.brand_name, p.page_name]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  async function bookmark(p: Post) {
    setBusy(p.id);
    try {
      await request("/api/feed", {
        action: "bookmark",
        postId: p.id,
        saved: !data?.saved.some((s) => s.post_id === p.id),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="brand-feed">
      <header className="leads-heading">
        <div>
          <p className="ed-muted">YOUR BRANDS, IN CONVERSATION</p>
          <h1>One feed. The right voice.</h1>
          <p>
            Review posts published through the hub and support them as another
            brand.
          </p>
        </div>
        <button onClick={() => load().catch((e) => setError(e.message))}>
          Refresh feed
        </button>
      </header>
      <div className="feed-identity">
        <span className="feed-identity-dot" />
        <div>
          <b>Acting as</b>
          <small>Public interactions use this page’s identity.</small>
        </div>
        <select
          aria-label="Acting brand page"
          value={pageId}
          onChange={(e) => setPageId(e.target.value)}
          disabled={!data?.pages.length}
        >
          <option value="" disabled>
            Choose an assigned page
          </option>
          {data?.pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.brand_name} · {p.name}
            </option>
          ))}
        </select>
        <span className="feed-platform">in · LinkedIn</span>
      </div>
      {page && !page.canEngage && (
        <p className="feed-permission-note">
          Reactions and public comments will become available after your super
          admin enables LinkedIn feed permissions in Connections. Repost drafts
          and internal notes use the workspace workflow.
        </p>
      )}
      {!page && (
        <p className="feed-permission-note">
          Your super admin’s selected brand pages will appear here. Unselected
          pages stay private.
        </p>
      )}
      {error && (
        <p className="secure-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="secure-notice" role="status">
          {notice}
          <button onClick={() => setNotice("")} aria-label="Dismiss">
            ×
          </button>
        </p>
      )}
      <div className="feed-controls">
        <div>
          <button
            className={!savedOnly ? "active" : ""}
            onClick={() => setSavedOnly(false)}
          >
            All posts
          </button>
          <button
            className={savedOnly ? "active" : ""}
            onClick={() => setSavedOnly(true)}
          >
            Saved by you
          </button>
        </div>
        <select
          aria-label="Source brand"
          value={sourceBrand}
          onChange={(e) => setSourceBrand(e.target.value)}
        >
          <option value="">Posts from all brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Post date range"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        >
          <option value="">Any time</option>
          <option value="7">Past 7 days</option>
          <option value="30">Past 30 days</option>
          <option value="90">Past 90 days</option>
        </select>
        <input
          aria-label="Search feed"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a post or topic"
        />
      </div>
      <div className="feed-layout">
        <main>
          {!data ? (
            <div className="leads-empty">Loading your brand feed…</div>
          ) : !rows.length ? (
            <div className="leads-empty">
              <span className="feed-empty-mark">↗</span>
              <h2>
                {data.posts.length
                  ? "No posts match this view."
                  : "Your published work will live here."}
              </h2>
              <p>
                {data.posts.length
                  ? "Adjust your filters or review all brand posts."
                  : "Once a selected brand page publishes through the hub, its post will appear here with available engagement metrics. Drafts and scheduled posts stay in Publishing and Calendar."}
              </p>
              <button className="primary" onClick={openPublishing}>
                Go to Publishing
              </button>
            </div>
          ) : (
            rows.map((p) => {
              const saved = data.saved.some((s) => s.post_id === p.id),
                history = data.actions.filter((a) => a.post_id === p.id),
                reaction = history.find(
                  (a) =>
                    a.acting_page_id === pageId &&
                    ["like", "unlike"].includes(a.kind) &&
                    a.status === "completed",
                ),
                pending = history.some(
                  (a) =>
                    a.acting_page_id === pageId &&
                    ["like", "unlike"].includes(a.kind) &&
                    ["processing", "uncertain"].includes(a.status),
                );
              return (
                <article className="feed-card" key={p.id}>
                  <header>
                    <span className="feed-brand-avatar">
                      {p.brand_name.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <b>{p.brand_name}</b>
                      <small>{p.page_name} · LinkedIn</small>
                      <small>{new Date(p.published_at).toLocaleString()}</small>
                    </div>
                    <button
                      aria-pressed={saved}
                      aria-label={saved ? "Unsave post" : "Save post privately"}
                      title="Saved posts are private to you"
                      disabled={busy === p.id}
                      className={saved ? "feed-saved" : ""}
                      onClick={() => bookmark(p)}
                    >
                      <Icon name="bookmark" />
                    </button>
                  </header>
                  <p className="feed-post-body">{p.text}</p>
                  {p.reshare_post_id && (
                    <div className="feed-reshare-context">
                      <small>NATIVE REPOST</small>
                      <b>
                        {data.posts.find((x) => x.id === p.reshare_post_id)
                          ?.brand_name || "Original LinkedIn post"}
                      </b>
                      {data.posts.find((x) => x.id === p.reshare_post_id) && (
                        <p>
                          {
                            data.posts.find((x) => x.id === p.reshare_post_id)
                              ?.text
                          }
                        </p>
                      )}
                    </div>
                  )}
                  {p.media_id && (
                    <AssetPreview
                      className="feed-media"
                      id={p.media_id}
                      alt={p.alt_text || "Post media"}
                    />
                  )}
                  <div className="feed-metrics">
                    {[
                      ["Likes", p.likes],
                      ["Comments", p.comments],
                      ["Reposts", p.shares],
                      ["Impressions", p.impressions],
                    ].map(([label, value]) => (
                      <span key={String(label)}>
                        <b>
                          {typeof value === "number"
                            ? value.toLocaleString()
                            : "—"}
                        </b>{" "}
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="feed-card-actions">
                    <button
                      disabled={
                        !page?.canEngage ||
                        pending ||
                        page.status === "reconnect_required"
                      }
                      title={
                        pending
                          ? "Check the pending reaction on LinkedIn first"
                          : "Confirm a reaction using the selected brand"
                      }
                      onClick={() =>
                        setModal({
                          kind: reaction?.kind === "like" ? "unlike" : "like",
                          post: p,
                          page,
                        })
                      }
                    >
                      <Icon name="like" />
                      {reaction?.kind === "like" ? "Remove like" : "Like"}
                    </button>
                    <button
                      disabled={
                        !page?.canEngage || page.status === "reconnect_required"
                      }
                      onClick={() =>
                        setModal({ kind: "comment", post: p, page })
                      }
                    >
                      <Icon name="comment" />
                      Comment
                    </button>
                    <button
                      disabled={!page}
                      onClick={() =>
                        setModal({ kind: "repost", post: p, page })
                      }
                    >
                      <Icon name="repost" />
                      Repost draft
                    </button>
                    <button
                      onClick={() => setModal({ kind: "note", post: p, page })}
                    >
                      Internal note
                    </button>
                  </div>
                  <footer>
                    <small>
                      {p.synced_at
                        ? "Metrics checked " +
                          new Date(p.synced_at).toLocaleString()
                        : "Metrics have not been retrieved yet"}
                    </small>
                    <a
                      href={
                        "https://www.linkedin.com/feed/update/" +
                        p.provider_post_id
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on LinkedIn ↗
                    </a>
                  </footer>
                  {data.notes.filter((n) => n.post_id === p.id).length > 0 && (
                    <details className="feed-notes">
                      <summary>
                        {data.notes.filter((n) => n.post_id === p.id).length}{" "}
                        internal team notes
                      </summary>
                      {data.notes
                        .filter((n) => n.post_id === p.id)
                        .map((n) => (
                          <div key={n.id}>
                            <b>{n.author_name}</b>
                            <small>
                              {new Date(n.created_at).toLocaleString()}
                            </small>
                            <p>{n.body}</p>
                          </div>
                        ))}
                    </details>
                  )}
                  {history.length > 0 && (
                    <details className="feed-history">
                      <summary>Interaction history</summary>
                      {history.map((a) => (
                        <div key={a.id}>
                          <b>
                            {a.brand_name} · {a.page_name}
                          </b>
                          <span>
                            {a.kind} · {a.status}
                          </span>
                          {a.body && <p>{a.body}</p>}
                          {a.error_message && <p>{a.error_message}</p>}
                          {a.status === "uncertain" && data.canResolve && (
                            <button onClick={() => setResolving(a)}>
                              Verify outcome
                            </button>
                          )}
                          <small>
                            {new Date(a.updated_at).toLocaleString()}
                          </small>
                        </div>
                      ))}
                    </details>
                  )}
                </article>
              );
            })
          )}
        </main>
        <aside className="feed-guide">
          <h2>A clear distinction.</h2>
          <p>
            <b>Source brand</b>
            <br />
            The brand whose post you are reading.
          </p>
          <p>
            <b>Acting page</b>
            <br />
            The page that will like, comment or repost. Check the identity
            before every public action.
          </p>
          <p>
            <b>Internal notes</b>
            <br />
            Shared with teammates who can access the source brand. These never
            appear on social media.
          </p>
          <hr />
          <small>
            Feed coverage: the latest 200 published hub posts from your selected
            LinkedIn pages. External page history and other platforms will be
            added through their integrations.
          </small>
        </aside>
      </div>
      {resolving && (
        <ResolveInteraction
          action={resolving}
          close={() => setResolving(null)}
          done={async () => {
            await load();
            setResolving(null);
            setNotice("Verified outcome recorded. No public action was sent.");
          }}
        />
      )}
      {modal && (
        <FeedActionModal
          key={modal.post.id + modal.kind + (modal.page?.id || "")}
          {...modal}
          brands={brands}
          close={() => setModal(null)}
          refresh={load}
          done={async (message) => {
            await load();
            setModal(null);
            setNotice(message);
          }}
        />
      )}
    </section>
  );
}
function FeedActionModal({
  kind,
  post,
  page,
  brands,
  close,
  done,
  refresh,
}: {
  kind: string;
  post: Post;
  page: Page | null;
  brands: Brand[];
  close: () => void;
  done: (message: string) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [keys] = useState(() => new Map<string, string>());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const f = new FormData(e.currentTarget),
        text = String(f.get("text") || "");
      let key = keys.get(text);
      if (!key) {
        key = crypto.randomUUID();
        keys.set(text, key);
      }
      if (kind === "repost") {
        if (!page) throw new Error("Choose an acting page.");
        await request("/api/publishing", {
          brandId: page.brand_id,
          pageId: page.id,
          text,
          action: "draft",
          resharePostId: post.id,
          clientKey: key,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        await done(
          "Repost draft saved for " +
            page.brand_name +
            ". Continue in Publishing to edit, request approval or schedule it.",
        );
      } else {
        const result = await request<{ status?: string; message?: string }>(
          "/api/feed",
          {
            action: kind,
            postId: post.id,
            pageId: page?.id,
            text,
            clientKey: key,
          },
        );
        if (result.status && result.status !== "completed")
          throw new Error(
            result.message ||
              (result.status === "uncertain"
                ? "The result needs checking on LinkedIn. Automatic repetition is blocked."
                : "This interaction is still being processed."),
          );
        await done(
          kind === "note"
            ? "Internal note saved."
            : kind === "comment"
              ? "Comment confirmed as " + page?.name
              : kind === "like"
                ? "Like confirmed as " + page?.name
                : "Like removal confirmed as " + page?.name,
        );
      }
    } catch (e) {
      setError((e as Error).message);
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        kind === "note"
          ? "Add an internal note"
          : kind === "repost"
            ? "Prepare a native repost"
            : kind === "comment"
              ? "Comment as your brand"
              : kind === "like"
                ? "Like as your brand"
                : "Remove your brand’s like"
      }
      close={() => {
        if (!busy) close();
      }}
    >
      <form className="feed-action-form" onSubmit={submit}>
        <div className="feed-action-source">
          <small>ORIGINAL POST · {post.brand_name}</small>
          <p>{post.text.slice(0, 500)}</p>
        </div>
        {kind !== "note" && (
          <div className="feed-action-identity">
            <b>
              {page?.brand_name} · {page?.name}
            </b>
            <p>
              {kind === "repost"
                ? "This saves a native LinkedIn repost draft. Your commentary will appear above the original post when published."
                : "This action will be public on LinkedIn using this page’s identity."}
            </p>
          </div>
        )}
        {["comment", "note", "repost"].includes(kind) && (
          <label>
            {kind === "note"
              ? "Internal team note"
              : kind === "repost"
                ? "Repost commentary"
                : "Public comment"}
            <textarea
              name="text"
              autoFocus
              required
              maxLength={
                kind === "note" ? 2000 : kind === "comment" ? 1250 : 3000
              }
              placeholder={
                kind === "repost"
                  ? "Add your brand’s perspective…"
                  : kind === "note"
                    ? "Add context for the team…"
                    : "Write your comment…"
              }
            />
          </label>
        )}
        {kind === "note" && (
          <p className="ed-muted">
            Visible to teammates with access to{" "}
            {brands.find((b) => b.id === post.brand_id)?.name ||
              post.brand_name}
            . It will not be posted publicly.
          </p>
        )}
        {error && (
          <p className="access-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy
            ? "Working…"
            : kind === "repost"
              ? "Save repost draft"
              : kind === "note"
                ? "Save internal note"
                : kind === "comment"
                  ? "Post comment"
                  : kind === "like"
                    ? "Confirm like"
                    : "Confirm removal"}
        </button>
      </form>
    </Modal>
  );
}

function ResolveInteraction({
  action,
  close,
  done,
}: {
  action: Action;
  close: () => void;
  done: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await request("/api/feed", {
        action: "resolve",
        id: action.id,
        applied: f.get("outcome") === "applied",
        note: f.get("note"),
      });
      await done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Verify the LinkedIn outcome"
      close={() => {
        if (!busy) close();
      }}
    >
      <form className="feed-action-form" onSubmit={submit}>
        <p className="ed-muted">
          Check the original LinkedIn post as {action.page_name} before
          recording an outcome. This updates the hub’s record and does not send
          an interaction.
        </p>
        <label>
          Verified outcome
          <select name="outcome" required defaultValue="">
            <option value="" disabled>
              Select after checking LinkedIn
            </option>
            <option value="applied">The action is present on LinkedIn</option>
            <option value="absent">The action did not happen</option>
          </select>
        </label>
        <label>
          Verification note
          <textarea
            name="note"
            minLength={10}
            maxLength={500}
            required
            placeholder="Record what you checked and found…"
          />
        </label>
        <p className="ed-muted">
          Marking an action as absent permits a teammate to retry it. Only
          confirm absence after checking to avoid duplicates.
        </p>
        {error && (
          <p className="access-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Recording…" : "Record verified outcome"}
        </button>
      </form>
    </Modal>
  );
}

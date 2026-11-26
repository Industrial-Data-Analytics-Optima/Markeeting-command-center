import { uploadMedia } from "./upload-media";
import { useEffect, useState, useRef, FormEvent } from "react";
import { AssetPreview } from "./asset-preview";
import { Modal } from "./ui";
export type Asset = {
  id: string;
  brand_id: string;
  brand_name: string;
  name: string;
  folder: string;
  alt_text: string;
  archived: number;
  version: number;
  mime: string;
  duration: number | null;
  bytes: number;
  width: number;
  height: number;
};
export function MediaWorkspace({
  brands,
  onSelect,
  onBusy,
}: {
  brands: { id: string; name: string }[];
  onSelect?: (a: Asset) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [capabilities, setCapabilities] = useState({
    videoUploadsAvailable: false,
    imageMaxMB: 4,
  });
  const [assets, setAssets] = useState<Asset[]>([]),
    [loaded, setLoaded] = useState(false),
    [brand, setBrand] = useState(onSelect ? brands[0]?.id || "" : ""),
    [folder, setFolder] = useState(""),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState(""),
    [archived, setArchived] = useState(false),
    [editing, setEditing] = useState<Asset | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [percent, setPercent] = useState(0),
    [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function load() {
    const r = await fetch("/api/library", { cache: "no-store" }),
      d = (await r.json()) as {
        assets: Asset[];
        message?: string;
        videoUploadsAvailable: boolean;
        imageMaxMB: number;
      };
    if (!r.ok) throw new Error(d.message);
    setAssets(d.assets);
    setCapabilities({
      videoUploadsAvailable: d.videoUploadsAvailable,
      imageMaxMB: d.imageMaxMB,
    });
    setLoaded(true);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function upload(file?: File) {
    if (!file || !brand) return;
    if (file.type === "video/mp4" && !capabilities.videoUploadsAvailable) {
      setError("Video upload is unavailable on this host.");
      return;
    }
    if (
      file.type !== "video/mp4" &&
      file.size > capabilities.imageMaxMB * 1024 * 1024
    ) {
      setError(
        `Images can be up to ${capabilities.imageMaxMB} MB on this host.`,
      );
      return;
    }
    setBusy(true);
    onBusy?.(true);
    setPercent(0);
    setError("");
    controller.current = new AbortController();
    try {
      const d = await uploadMedia(
        file,
        brand,
        (p, m) => {
          if (p >= 0) setPercent(p);
          setMessage(m);
        },
        controller.current.signal,
      );
      const r = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: d.id,
          version: 1,
          name: file.name.slice(0, 180),
          folder,
          altText: "",
          archived: false,
        }),
      });
      if (!r.ok)
        throw new Error(
          "File uploaded. Refresh the library to edit its details.",
        );
      await load();
    } catch (e) {
      setError(
        controller.current?.signal.aborted
          ? "Upload cancelled."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
      onBusy?.(false);
      setMessage("");
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const d = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    try {
      const r = await fetch("/api/library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...d,
            id: editing.id,
            version: editing.version,
            archived: d.archived === "on",
          }),
        }),
        result = (await r.json()) as { message?: string };
      if (!r.ok) throw new Error(result.message);
      await load();
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const scoped = assets.filter((a) => !brand || a.brand_id === brand),
    folders = [...new Set(scoped.map((a) => a.folder).filter(Boolean))].sort(),
    rows = scoped.filter(
      (a) =>
        Boolean(a.archived) === archived &&
        (!kind ||
          (kind === "video"
            ? a.mime === "video/mp4"
            : a.mime !== "video/mp4")) &&
        (!folder || a.folder === folder) &&
        [a.name, a.folder, a.alt_text]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  return (
    <section className="media-workspace">
      <header className="leads-heading">
        <div>
          <p className="ed-muted">YOUR BRAND, READY TO SHARE</p>
          <h1>{onSelect ? "Choose media" : "The media library."}</h1>
          <p>
            Keep brand media close to the work. Images up to{" "}
            {capabilities.imageMaxMB} MB.{" "}
            {capabilities.videoUploadsAvailable
              ? "H.264 MP4 videos up to 500 MB · 3 seconds–30 minutes."
              : "Video uploads await hosted storage approval."}
          </p>
        </div>
        <label className="media-upload">
          {busy ? "Working…" : "+ Upload media"}
          <input
            type="file"
            accept={
              capabilities.videoUploadsAvailable
                ? "image/jpeg,image/png,video/mp4"
                : "image/jpeg,image/png"
            }
            disabled={!brand || busy}
            onChange={(e) => {
              upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </header>
      {message && (
        <div className="media-progress" role="status">
          <div>
            <b>{message}</b>
            <span>{percent}%</span>
          </div>
          <progress max={100} value={percent} />
          <button
            disabled={percent >= 96}
            onClick={() => controller.current?.abort()}
          >
            Cancel upload
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="secure-error">
          {error}
        </div>
      )}
      <div className="lp-toolbar">
        <input
          aria-label="Search assets"
          placeholder="Search media, folders or descriptions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Brand"
          value={brand}
          onChange={(e) => {
            setBrand(e.target.value);
            setFolder("");
          }}
        >
          {!onSelect && <option value="">All brands</option>}
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Media type"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">All media</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
        </select>
        <select
          aria-label="Folder"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
        >
          <option value="">All folders</option>
          {folders.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        {!onSelect && (
          <label>
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />{" "}
            Archived
          </label>
        )}
        <button onClick={() => load().catch((e) => setError(e.message))}>
          Refresh
        </button>
      </div>
      {!brand && !onSelect && (
        <p className="ed-muted">
          Choose a brand to upload media into its library.
        </p>
      )}
      <p className="ed-muted">
        {rows.length} assets · Up to 1,000 most recent uploads
      </p>
      <div className="media-grid">
        {rows.map((a) => (
          <article key={a.id}>
            <button
              className="media-preview"
              onClick={() => (onSelect ? onSelect(a) : setEditing(a))}
              aria-label={(onSelect ? "Select " : "Edit ") + a.name}
            >
              <AssetPreview
                id={a.id}
                alt={a.alt_text || a.name}
                controls={false}
              />
            </button>
            <div>
              <b>{a.name}</b>
              <small>
                {a.brand_name}
                {a.folder ? " / " + a.folder : ""}
              </small>
              <small>
                {a.mime === "video/mp4" ? "VIDEO · " : ""}
                {a.width} × {a.height}
                {a.duration ? " · " + Math.round(a.duration) + "s" : ""} ·{" "}
                {a.bytes >= 1024 * 1024
                  ? (a.bytes / 1024 / 1024).toFixed(1) + " MB"
                  : (a.bytes / 1024).toFixed(0) + " KB"}
              </small>
              <button onClick={() => (onSelect ? onSelect(a) : setEditing(a))}>
                {onSelect ? "Use media" : "Edit details"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!rows.length && (
        <div className="leads-empty">
          <h2>
            {loaded ? "A place for your next story." : "Loading your library…"}
          </h2>
          <p>
            {loaded
              ? "Upload a brand image, or adjust your filters to find existing assets."
              : ""}
          </p>
        </div>
      )}
      {editing && (
        <Modal
          title="Media details"
          close={() => {
            if (!busy) setEditing(null);
          }}
        >
          <form className="leads-form" onSubmit={save}>
            {error && <p role="alert">{error}</p>}
            <AssetPreview
              className="media-detail"
              id={editing.id}
              alt={editing.alt_text || editing.name}
            />
            <div className="leads-fields">
              <label>
                Name
                <input
                  required
                  name="name"
                  maxLength={180}
                  defaultValue={editing.name}
                />
              </label>
              <label>
                Folder
                <input
                  name="folder"
                  maxLength={80}
                  defaultValue={editing.folder}
                  placeholder="e.g. Product launches"
                />
              </label>
              <label>
                Media description
                <textarea
                  name="altText"
                  maxLength={1000}
                  defaultValue={editing.alt_text}
                />
              </label>
              <label>
                <span>
                  <input
                    type="checkbox"
                    name="archived"
                    defaultChecked={!!editing.archived}
                  />{" "}
                  Archive asset
                </span>
                <small>
                  Hides it from the picker. Existing posts retain this asset.
                </small>
              </label>
            </div>
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save details"}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}

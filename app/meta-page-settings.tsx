import { useEffect, useState } from "react";
import { Platform } from "./ui";
type Asset = {
  id: string;
  connection_id: string;
  kind: "facebook" | "instagram";
  name: string;
  username: string | null;
  brand_id: string | null;
  enabled: number;
  available: number;
  account_name: string;
  connection_status: string;
};
type Connection = {
  id: string;
  label: string;
  status: string;
  access_expires_at: number | null;
  meta_checked_at: number | null;
  instagramPermission: boolean;
};
type Data = { assets: Asset[]; connections: Connection[] };
export function MetaPageSettings({
  brands,
  changed,
}: {
  brands: { id: string; name: string }[];
  changed: () => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState("");
  async function load() {
    const r = await fetch("/api/meta/assets", { cache: "no-store" }),
      d = (await r.json()) as Data & { message?: string };
    if (!r.ok) throw new Error(d.message || "Could not load Meta accounts.");
    setData(d);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function act(id: string, brandId?: string) {
    setBusy(id);
    setError("");
    try {
      const r = await fetch("/api/meta/assets", {
          method: brandId === undefined ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            brandId === undefined ? { connectionId: id } : { id, brandId },
          ),
        }),
        d = (await r.json()) as { message?: string };
      if (!r.ok) throw new Error(d.message || "Could not update this account.");
      await load();
      changed();
      setNotice(
        brandId === undefined
          ? "Available accounts refreshed. New accounts remain private."
          : brandId
            ? "This account is shared with the selected brand."
            : "This account is private and hidden from admins.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (data && !data.connections.length) return null;
  return (
    <section className="secure-section meta-accounts">
      <div className="secure-section-title">
        <h2>Your Facebook & Instagram accounts</h2>
      </div>
      <p className="ed-muted">
        Choose each account you want to share and its brand. Newly discovered
        accounts stay private until selected. Refreshing or reconnecting
        preserves your existing choices.
      </p>
      {error && (
        <p className="access-error" role="alert">
          {error}
          <button onClick={() => load().catch((e) => setError(e.message))}>
            Retry
          </button>
        </p>
      )}
      {notice && (
        <p className="secure-notice" role="status">
          {notice}
        </p>
      )}
      {!data ? (
        <p>Loading Meta accounts…</p>
      ) : (
        data.connections.map((c) => (
          <div className="meta-account-group" key={c.id}>
            <header>
              <div>
                <b>{c.label}</b>
                <small>
                  {c.meta_checked_at
                    ? "Last checked " +
                      new Date(c.meta_checked_at).toLocaleString()
                    : "Awaiting first account check"}
                  {c.access_expires_at
                    ? " · Authorization renews by " +
                      new Date(c.access_expires_at).toLocaleDateString()
                    : ""}
                </small>
              </div>
              <button
                disabled={!!busy || c.status === "reconnect_required"}
                onClick={() => act(c.id)}
              >
                {busy === c.id ? "Refreshing…" : "Refresh accounts"}
              </button>
            </header>
            {!c.instagramPermission && (
              <p className="ed-muted">
                Instagram access was not granted. Reconnect after adding
                instagram_basic to the Meta Login configuration. A professional
                Instagram account must be linked to a Facebook Page.
              </p>
            )}
            {c.status === "reconnect_required" && (
              <p className="access-error">
                This authorization needs attention. Use Reconnect on the
                Facebook & Instagram card above. Existing selections have been
                retained.
              </p>
            )}
            <div className="meta-asset-list">
              {data.assets
                .filter((a) => a.connection_id === c.id)
                .map((a) => (
                  <article key={a.id}>
                    <Platform
                      name={a.kind === "facebook" ? "Facebook" : "Instagram"}
                      iconOnly
                    />
                    <div>
                      <b>{a.name}</b>
                      <small>
                        {a.kind === "facebook"
                          ? "Facebook Page"
                          : "Instagram professional account"}
                        {a.username ? " · @" + a.username : ""}
                      </small>
                      <small>
                        {!a.available
                          ? "Access no longer available"
                          : a.enabled
                            ? "Shared with " +
                              (brands.find((b) => b.id === a.brand_id)?.name ||
                                "brand")
                            : "Private · hidden from admins"}
                      </small>
                    </div>
                    <label>
                      <span className="visually-hidden">
                        Brand for {a.name}
                      </span>
                      <select
                        value={a.enabled && a.available ? a.brand_id || "" : ""}
                        disabled={
                          !!busy ||
                          !a.available ||
                          c.status === "reconnect_required"
                        }
                        onChange={(e) => act(a.id, e.target.value)}
                      >
                        <option value="">Private · not shared</option>
                        {brands.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </article>
                ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}

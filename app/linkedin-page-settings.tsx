import { useEffect, useState } from "react";
type Page = {
  id: string;
  name: string;
  organization_urn: string;
  brand_id: string | null;
  enabled: number;
};
export function LinkedInPageSettings({
  brands,
  changed,
}: {
  brands: { id: string; name: string }[];
  changed?: () => void;
}) {
  const [pages, setPages] = useState<Page[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState("");
  const onlyBrand = brands.length === 1 ? brands[0] : null;
  async function load() {
    try {
      const r = await fetch("/api/linkedin/pages", { cache: "no-store" }),
        d = (await r.json()) as { pages: Page[]; message?: string };
      if (!r.ok) throw new Error(d.message);
      setPages(d.pages);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function assign(page: Page, brandId: string) {
    setBusy(page.id);
    setError("");
    try {
      const r = await fetch("/api/linkedin/pages", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: page.id, brandId }),
        }),
        d = (await r.json()) as { message?: string };
      if (!r.ok) throw new Error(d.message);
      await load();
      changed?.();
      setNotice(
        brandId
          ? "This page is on for the team."
          : "This page is off for everyone.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function assignUnassigned(brandId: string) {
    setBusy("all");
    setError("");
    try {
      const r = await fetch("/api/linkedin/pages", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ all: true, brandId }),
        }),
        d = (await r.json()) as { message?: string };
      if (!r.ok) throw new Error(d.message);
      await load();
      changed?.();
      setNotice("New pages are on. Pages you turned off stay off.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (pages !== null && !pages.length) return null;
  const leftover = pages?.some((p) => !p.brand_id && !p.enabled);
  return (
    <section className="secure-section">
      <div className="secure-section-title">
        <h2>Your LinkedIn pages</h2>
        {leftover && brands[0] && (
          <button
            className="primary"
            disabled={busy === "all"}
            onClick={() => assignUnassigned(onlyBrand?.id || brands[0].id)}
          >
            Turn on leftover pages
          </button>
        )}
      </div>
      <p className="ed-muted">
        Only pages you turn on appear for your team and can be posted to. Off
        pages stay private.
      </p>
      {error && (
        <p role="alert" className="access-error">
          {error}
          <button onClick={load}>Retry</button>
        </p>
      )}
      {notice && (
        <p role="status" className="secure-notice">
          {notice}
        </p>
      )}
      {pages === null ? (
        <p>Loading pages…</p>
      ) : (
        <div className="li-page-list">
          {pages.map((p) => (
            <article key={p.id}>
              <span className="li-platform">in</span>
              <div>
                <b>{p.name}</b>
                <small>
                  {p.enabled
                    ? "On · team can post"
                    : "Off · hidden from admins"}
                </small>
              </div>
              {onlyBrand ? (
                <button
                  disabled={!!busy}
                  onClick={() => assign(p, p.enabled ? "" : onlyBrand.id)}
                >
                  {p.enabled ? "Turn off" : "Turn on"}
                </button>
              ) : (
                <label>
                  <span className="visually-hidden">Brand for {p.name}</span>
                  <select
                    aria-label={"Brand for " + p.name}
                    disabled={!!busy}
                    value={p.enabled && p.brand_id ? p.brand_id : ""}
                    onChange={(e) => assign(p, e.target.value)}
                  >
                    <option value="">Off</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

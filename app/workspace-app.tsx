"use client";
import Link from "next/link";
import { allowWorkspaceNavigation } from "./use-unsaved-changes";
import { AdsWorkspace } from "./ads-workspace";
import { AnalyticsWorkspace } from "./growth-analytics";
import { BrandFeed } from "./brand-feed";
import { EmailWorkspace, EmailIntent } from "./email-workspace";
import { PasswordInput } from "./password-input";
import { MediaWorkspace } from "./media-workspace";
import { LeadsWorkspace } from "./leads-workspace";
import { CampaignWorkspace } from "./campaign-workspace";
import { EditorialWorkspace } from "./editorial-workspace";
import { useEffect, useState, useRef, FormEvent } from "react";
import { Avatar, Icon, Modal, Platform, SiteMark } from "./ui";
import { brandLogos } from "./workspace-model";
import { PublishingWorkspace } from "./publishing-workspace";
import { LinkedInPageSettings } from "./linkedin-page-settings";
import { TeamSpace } from "./team-space";
import type { TeamIntent } from "./team-space";
import { MetaPageSettings } from "./meta-page-settings";
import { connectionProviders, ProviderSetup } from "./connections";
import type { ProviderSetupState } from "./connections";
type User = {
  id: string;
  name: string;
  email: string;
  role: "super_admin" | "admin";
  workspaceName: string;
};
type Brand = { id: string; name: string };
type Member = {
  id: string;
  name: string;
  email: string;
  role: "super_admin" | "admin";
  active: number;
};
type Team = {
  members: Member[];
  access: { user_id: string; brand_id: string }[];
  invites: { id: string; email: string; role: string; expires_at: number }[];
};
type Connections = {
  accounts: {
    id: string;
    provider: string;
    label: string;
    status: string;
    last_checked_at: number | null;
    access_expires_at: number | null;
  }[];
  assignments: { connection_id: string; brand_id: string }[];
  providers: ProviderSetupState[];
};
const ALL_VIEWS = [
  "Overview",
  "Publishing",
  "Calendar",
  "Approvals",
  "Team space",
  "Campaigns",
  "Ads Manager",
  "Leads",
  "Media library",
  "Email",
  "Brand feed",
  "Analytics",
  "Brands",
  "Team",
  "Connections",
] as const;

async function api<T = { url?: string }>(
  path: string,
  method = "GET",
  data?: unknown,
) {
  const r = await fetch(path, {
    method,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const result = (await r.json()) as T & { message?: string };
  if (!r.ok) {
    const e = new Error(
      result.message || "Something went wrong. Please try again.",
    ) as Error & { status: number };
    e.status = r.status;
    throw e;
  }
  return result;
}
export default function Workspace() {
  const [user, setUser] = useState<User | null>(null),
    [brands, setBrands] = useState<Brand[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [invite, setInvite] = useState(""),
    [view, setView] = useState("Overview"),
    [team, setTeam] = useState<Team | null>(null),
    [connections, setConnections] = useState<Connections | null>(null),
    [dialog, setDialog] = useState(""),
    [editing, setEditing] = useState<Member | null>(null),
    [inviteUrl, setInviteUrl] = useState(""),
    [inviteEmail, setInviteEmail] = useState(""),
    [notice, setNotice] = useState(""),
    [selectedBrand, setSelectedBrand] = useState("");
  const [teamIntent, setTeamIntent] = useState<TeamIntent | null>(null);
  const [emailIntent, setEmailIntent] = useState<EmailIntent | null>(null);
  const [providerSetup, setProviderSetup] = useState<ProviderSetupState | null>(
    null,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const accountMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        accountMenu.current?.open &&
        !accountMenu.current.contains(event.target as Node)
      )
        accountMenu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (accountMenu.current?.open) {
        accountMenu.current.open = false;
        accountMenu.current.querySelector<HTMLElement>("summary")?.focus();
        event.preventDefault();
      }
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const [palette, setPalette] = useState("");
  const [pulse, setPulse] = useState<{
    drafts: number;
    scheduled: number;
    pages: number;
  } | null>(null);
  async function refreshConnectionSetup() {
    setConnections(await api<Connections>("/api/connections"));
  }
  useEffect(() => {
    if (user?.role !== "super_admin" || view !== "Connections") return;
    let active = true;
    const refresh = () => {
      api<Connections>("/api/connections")
        .then((d) => {
          if (active) setConnections(d);
        })
        .catch(() => {});
    };
    const timer = setInterval(refresh, 20000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [user?.role, view]);
  async function refresh() {
    const result = await api<{ user: User | null; brands?: Brand[] }>(
      "/api/session",
    );
    setUser(result.user);
    setBrands(result.brands || []);
    return result.user as User | null;
  }
  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get("invite");
    if (token) {
      setInvite(token);
      history.replaceState(null, "", location.pathname);
    }
    const requested = new URLSearchParams(location.search).get("view");
    if (
      requested &&
      ALL_VIEWS.includes(requested as (typeof ALL_VIEWS)[number])
    )
      setView(requested);
    const status = new URLSearchParams(location.search).get("connection");
    if (status) setView("Connections");
    if (status)
      setNotice(
        status === "connected"
          ? "Account authorized. Choose which pages or accounts to share with brands below. Unselected accounts stay private."
          : "The account was not connected. Check provider permissions and try again.",
      );
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!user) return;
    if (user.role === "admin" && ["Connections", "Team"].includes(view)) {
      setView("Publishing");
      return;
    }
    setError("");
    if (view === "Team")
      api<Team>("/api/team").then(setTeam).catch(handleError);
    if (
      user.role === "super_admin" &&
      (view === "Connections" || view === "Overview")
    )
      api<Connections>("/api/connections")
        .then(setConnections)
        .catch(() => setConnections(null));
    if (view === "Overview")
      api<{ posts: { status: string }[]; pages: unknown[] }>("/api/publishing")
        .then((d) =>
          setPulse({
            drafts: d.posts.filter((p) => p.status === "draft").length,
            scheduled: d.posts.filter((p) => p.status === "scheduled").length,
            pages: d.pages.length,
          }),
        )
        .catch(() => setPulse({ drafts: 0, scheduled: 0, pages: 0 }));
  }, [user, view]);
  useEffect(() => {
    if (user) {
      const current = new URLSearchParams(location.search).get("view"),
        target = location.pathname + "?view=" + encodeURIComponent(view);
      if (!current) history.replaceState(null, "", target);
      else if (current !== view) history.pushState(null, "", target);
    }
  }, [view, user]);
  useEffect(() => {
    const back = () => {
      const requested =
        new URLSearchParams(location.search).get("view") || "Overview";
      if ((ALL_VIEWS as readonly string[]).includes(requested)) {
        if (requested !== view && !allowWorkspaceNavigation()) {
          history.pushState(
            null,
            "",
            location.pathname + "?view=" + encodeURIComponent(view),
          );
          return;
        }
        setView(requested);
      }
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [view]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((open) => (open ? "" : "open"));
      }
      if (e.key === "Escape") setPalette("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  function handleError(e: Error & { status?: number }) {
    setError(e.message);
    if (e.status === 401) {
      setUser(null);
      setConnections(null);
      setTeam(null);
    }
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      handleError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(async () => {
      await api("/api/session", "POST", {
        email: f.get("email"),
        password: f.get("password"),
        name: f.get("name"),
        ...(invite ? { action: "accept", token: invite } : {}),
      });
      setInvite("");
      await refresh();
    });
  }
  async function signOut() {
    if (!allowWorkspaceNavigation()) return;
    await run(async () => {
      await api("/api/session", "DELETE");
      setUser(null);
      setTeam(null);
      setConnections(null);
      setBrands([]);
      setNotice("");
    });
  }
  async function saveBrand(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(async () => {
      await api("/api/brands", "POST", { name: f.get("name") });
      await refresh();
      setDialog("");
      setNotice("Brand added. You can now assign accounts and teammates.");
    });
  }
  async function saveMember(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(async () => {
      const data = {
        email: f.get("email"),
        role: f.get("role"),
        brandIds: f.getAll("brands"),
        ...(editing
          ? { id: editing.id, active: f.get("active") === "on" }
          : {}),
      };
      const result = await api("/api/team", editing ? "PATCH" : "POST", data);
      setTeam(await api<Team>("/api/team"));
      setDialog("");
      if (result.url) {
        setInviteUrl(result.url);
        setInviteEmail(String(f.get("email") || ""));
        setDialog("invitation");
      } else
        setNotice("Access updated. Their existing sessions have been ended.");
    });
  }
  async function startConnection(provider: string, brandId: string) {
    await run(async () => {
      const result = await api(`/api/connections/${provider}/start`, "POST", {
        brandId,
      });
      if (result.url) location.assign(result.url);
    });
  }
  function beginConnect(provider: string) {
    const brandId = brands[0]?.id || "";
    if (["linkedin", "meta"].includes(provider) || brands.length <= 1) {
      void startConnection(provider, brandId);
      return;
    }
    setSelectedBrand(brandId);
    setDialog("connect:" + provider);
  }
  const owner = user?.role === "super_admin";
  if (loading)
    return (
      <div className="access-loading">
        <SiteMark size={36} />
        <p>Opening your workspace…</p>
      </div>
    );
  if (!user)
    return (
      <main className="access-login">
        <section className="access-story">
          <Link href="/" className="access-wordmark">
            <SiteMark size={36} />
            Marketing <b>Command Center</b>
          </Link>
          <div>
            <h1>Plan, publish, and manage every brand from one desk.</h1>
            <p>
              Publishing, email, ads, leads, and reporting stay in this
              workspace. Brand accounts are owned by the super admin, not by
              each teammate’s personal login.
            </p>
            <ul className="access-points">
              <li>Assign pages and mailboxes to a brand</li>
              <li>Review posts before they go out</li>
              <li>Keep provider passwords off shared spreadsheets</li>
            </ul>
          </div>
          <footer>
            <p>Workspace logout does not disconnect brand accounts.</p>
          </footer>
        </section>
        <section className="access-form">
          <div>
            <h2>{invite ? "Accept invitation" : "Sign in"}</h2>
            <p>
              {invite
                ? "Create your password to join this workspace."
                : "Use the email your super admin invited."}
            </p>
            <form onSubmit={login}>
              {invite && (
                <label>
                  Your name
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={100}
                  />
                </label>
              )}
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@company.com"
                  required
                />
              </label>
              <label>
                Password
                <PasswordInput
                  name="password"

                  autoComplete={invite ? "new-password" : "current-password"}
                  minLength={invite ? 12 : undefined}
                  maxLength={128}
                  required
                />
              </label>
              {invite && (
                <small>
                  Use at least 12 characters. A long, unique passphrase works
                  well.
                </small>
              )}
              {error && (
                <p className="access-error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary" disabled={busy}>
                {busy ? "Please wait…" : invite ? "Create account" : "Sign in"}
              </button>
            </form>
            <p className="access-help">
              {invite
                ? "This invitation is personal and can only be used once."
                : "Access is by invitation. Ask your super admin for an invitation or help recovering access."}
            </p>
          </div>
          <footer>
            Workspace login never disconnects your brand accounts.
          </footer>
        </section>
      </main>
    );
  return (
    <div className={"secure-workspace" + (menuOpen ? " menu-open" : "")}>
      <button
        className="secure-menu-toggle"
        aria-expanded={menuOpen}
        aria-controls="workspace-nav"
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? "Close menu" : "Menu"}
      </button>
      {menuOpen && (
        <button
          className="secure-nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className="secure-sidebar" id="workspace-nav">
        <a className="access-wordmark" href="/workspace">
          <SiteMark size={36} />
          <span>
            Marketing
            <br />
            <b>Command Center</b>
          </span>
        </a>
        <div className="secure-workspace-name">
          <b title={user.workspaceName}>{user.workspaceName}</b>
        </div>
        <nav aria-label="Workspace navigation">
          {(owner
            ? [
                ["", ["Overview"]],
                [
                  "Workspace",
                  [
                    "Publishing",
                    "Calendar",
                    "Approvals",
                    "Team space",
                    "Media library",
                    "Email",
                    "Brand feed",
                  ],
                ],
                [
                  "Marketing",
                  ["Campaigns", "Ads Manager", "Leads", "Analytics"],
                ],
                ["Manage", ["Connections", "Team", "Brands"]],
              ]
            : [
                ["", ["Overview"]],
                [
                  "Workspace",
                  [
                    "Publishing",
                    "Calendar",
                    "Approvals",
                    "Team space",
                    "Media library",
                    "Email",
                    "Brand feed",
                  ],
                ],
                [
                  "Marketing",
                  ["Campaigns", "Ads Manager", "Leads", "Analytics"],
                ],
                ["Manage", ["Brands"]],
              ]
          ).map(([group, items]) => (
            <div key={String(group)} className="secure-nav-group">
              {group && <p>{group}</p>}
              {(items as string[]).map((item) => (
                <button
                  key={item}
                  aria-current={view === item ? "page" : undefined}
                  className={view === item ? "active" : ""}
                  onClick={() => {
                    if (!allowWorkspaceNavigation()) return;
                    setView(item);
                    setMenuOpen(false);
                    setNotice("");
                    setError("");
                  }}
                >
                  <Icon
                    name={
                      item === "Ads Manager"
                        ? "Campaigns"
                        : item === "Calendar"
                          ? "Calendar"
                          : item === "Team"
                            ? "Leads"
                            : item === "Brands"
                              ? "Brand settings"
                              : item
                    }
                  />
                  <span className="secure-nav-label">
                    {(
                      {
                        Publishing: "Publish",
                        Approvals: "Reviews",
                        "Media library": "Media",
                        "Brand feed": "Feed",
                        "Ads Manager": "Ads",
                      } as Record<string, string>
                    )[item] || item}
                  </span>
                  {item === "Brands" && (
                    <span className="secure-nav-count">{brands.length}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <main className="secure-main">
        <header className="secure-topbar">
          <span className="secure-breadcrumb">
            Workspace / <b>{view === "Approvals" ? "Team review" : view}</b>
          </span>
          <div className="secure-topbar-tools">
            <button
              className="secure-search-launch"
              aria-label="Search workspace sections"
              onClick={() => {
                setMenuOpen(false);
                setPalette("open");
              }}
            >
              <Icon name="search" />
              <span>Search</span>
              <kbd>Ctrl K</kbd>
            </button>
            <details className="secure-account-menu" ref={accountMenu}>
              <summary aria-label="Your account">
                <Avatar name={user.name} />
                <span>{user.name.split(" ")[0]}</span>
                <Icon name="chevron" />
              </summary>
              <div className="secure-account-popover">
                <div className="secure-account-identity">
                  <b>{user.name}</b>
                  <span>{user.email}</span>
                  <small>
                    {owner ? "Super admin" : "Admin · assigned brands"}
                  </small>
                </div>
                <button
                  onClick={() => {
                    if (accountMenu.current) accountMenu.current.open = false;
                    setDialog("password");
                    setError("");
                  }}
                >
                  <Icon name="lock" />
                  Password & security
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (accountMenu.current) accountMenu.current.open = false;
                    signOut();
                  }}
                >
                  <Icon name="signout" />
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </header>
        <div className="secure-content">
          {view === "Overview" && (
            <section className="home-desk">
              <div className="secure-heading">
                <div>
                  <h1>Today</h1>
                  <p>
                    {user.workspaceName}. {brands.length} brand
                    {brands.length === 1 ? "" : "s"} you can work in.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    if (allowWorkspaceNavigation()) setView("Publishing");
                  }}
                >
                  New post
                </button>
              </div>
              <div className="secure-overview">
                <div>
                  <strong>{pulse?.drafts ?? "—"}</strong>
                  <span>Open drafts</span>
                </div>
                <div>
                  <strong>{pulse?.scheduled ?? "—"}</strong>
                  <span>Scheduled</span>
                </div>
                <div>
                  <strong>{pulse?.pages ?? "—"}</strong>
                  <span>LinkedIn pages assigned</span>
                </div>
                <p>
                  {owner
                    ? (connections?.accounts.filter(
                        (a) => a.status !== "healthy",
                      ).length || 0) + " connection(s) need attention."
                    : "You see brands your super admin assigned."}
                </p>
              </div>
              <div className="home-shortcuts">
                {[
                  ["Publishing", "Write and send posts"],
                  ["Calendar", "See the week"],
                  ["Email", "Mailbox"],
                  ["Analytics", "Results"],
                ].map(([name, hint]) => (
                  <button
                    key={name}
                    onClick={() => {
                      if (allowWorkspaceNavigation()) setView(name);
                    }}
                  >
                    <b>{name}</b>
                    <span>{hint}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {![
            "Overview",
            "Publishing",
            "Analytics",
            "Calendar",
            "Approvals",
            "Team space",
            "Campaigns",
            "Ads Manager",
            "Leads",
            "Media library",
            "Email",
            "Brand feed",
          ].includes(view) && (
            <div className="secure-heading">
              <div>
                <h1>
                  {view === "Connections"
                    ? "Connected accounts"
                    : view === "Team"
                      ? "Team"
                      : "Brands"}
                </h1>
                <p>
                  {view === "Connections"
                    ? "Click Connect. Approve on the provider. That’s the whole job."
                    : view === "Team"
                      ? "Choose their role and brands, then share a secure invitation link."
                      : "Brands are the folders your pages, mailboxes, and campaigns sit in."}
                </p>
              </div>
              {owner && view !== "Connections" && (
                <button
                  className="primary"
                  onClick={() => {
                    setEditing(null);
                    setDialog(view === "Team" ? "member" : "brand");
                    setError("");
                  }}
                >
                  <Icon name="plus" />
                  {view === "Team" ? "Invite teammate" : "Add brand"}
                </button>
              )}
            </div>
          )}
          {notice && (
            <div className="secure-notice" role="status">
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </div>
          )}
          {error && (
            <div className="access-error" role="alert">
              {error}
              <button
                onClick={() => {
                  setError("");
                  refresh()
                    .then(() => {
                      if (view === "Team")
                        return api<Team>("/api/team").then(setTeam);
                      if (view === "Connections")
                        return api<Connections>("/api/connections").then(
                          setConnections,
                        );
                    })
                    .catch(handleError);
                }}
              >
                Retry
              </button>
            </div>
          )}
          {view === "Team space" && (
            <TeamSpace
              brands={brands}
              intent={teamIntent}
              onIntentUsed={() => setTeamIntent(null)}
            />
          )}
          {view === "Campaigns" && <CampaignWorkspace brands={brands} />}
          {view === "Ads Manager" && (
            <AdsWorkspace
              brands={brands}
              discuss={(item) => {
                if (allowWorkspaceNavigation()) {
                  setTeamIntent(item);
                  setView("Team space");
                }
              }}
            />
          )}
          {view === "Leads" && (
            <LeadsWorkspace
              brands={brands}
              emailLead={(lead) => {
                setEmailIntent({
                  brandId: lead.brand_id,
                  leadId: lead.id,
                  to: lead.email,
                });
                setView("Email");
              }}
            />
          )}
          {view === "Media library" && <MediaWorkspace brands={brands} />}
          {view === "Email" && (
            <EmailWorkspace
              brands={brands}
              intent={emailIntent}
              onIntentUsed={() => setEmailIntent(null)}
            />
          )}
          {view === "Analytics" && (
            <AnalyticsWorkspace
              brands={brands}
              openLeads={() => setView("Leads")}
            />
          )}
          {view === "Brand feed" && (
            <BrandFeed
              brands={brands}
              openPublishing={() => setView("Publishing")}
            />
          )}
          {["Calendar", "Approvals"].includes(view) && (
            <EditorialWorkspace
              key={view}
              brands={brands}
              reviews={view === "Approvals"}
            />
          )}
          {view === "Publishing" && (
            <PublishingWorkspace
              key={view}
              brands={brands}
              analytics={false}
              openReviews={() => {
                if (allowWorkspaceNavigation()) setView("Approvals");
              }}
            />
          )}
          {view === "Connections" && owner && (
            <>
              <section className="secure-section">
                {!connections ? (
                  <p className="secure-loading">Loading…</p>
                ) : (
                  <div className="secure-providers">
                    {connectionProviders.map((p) => {
                      const state = connections.providers.find(
                        (s) => s.id === p.id,
                      );
                      const linked = connections.accounts.filter(
                        (a) => a.provider === p.id,
                      );
                      return (
                        <article key={p.id}>
                          <div className="secure-provider-icon">
                            <Platform
                              name={p.id === "meta" ? "Facebook" : p.name}
                              iconOnly
                            />
                          </div>
                          <div>
                            <h3>{p.name}</h3>
                            <p>
                              {linked.length
                                ? linked.map((a) => a.label).join(" · ")
                                : p.name === "Gmail"
                                  ? "Work mailbox"
                                  : p.name === "Outlook"
                                    ? "Work mailbox"
                                    : "Company pages"}
                            </p>
                            {!state?.ready && (
                              <small className="provider-setup-reason">
                                {state?.reason || "Checking provider setup…"}
                              </small>
                            )}
                          </div>
                          <div className="secure-provider-actions">
                            <span className="provider-readiness">
                              {state?.ready
                                ? "App configured"
                                : "Setup required"}
                            </span>
                            <button
                              className="primary"
                              disabled={
                                busy ||
                                !state?.ready ||
                                (!["linkedin", "meta"].includes(p.id) &&
                                  !brands.length)
                              }
                              title={
                                state?.ready
                                  ? "Authorize your account"
                                  : "Complete the one-time setup to activate this Connect button"
                              }
                              onClick={() => beginConnect(p.id)}
                            >
                              {linked.length ? "Reconnect" : "Connect"}
                            </button>
                            <button
                              className="provider-setup-link"
                              disabled={!state}
                              onClick={() => state && setProviderSetup(state)}
                            >
                              {state?.ready ? "Setup guide" : "View setup"}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
                {!brands.length && (
                  <p className="secure-inline-note">
                    Add a brand first, then come back and click Connect.{" "}
                    <button onClick={() => setView("Brands")}>Brands</button>
                  </p>
                )}
              </section>
            </>
          )}
          {view === "Connections" && owner && (
            <LinkedInPageSettings
              brands={brands}
              changed={() => {
                api<Connections>("/api/connections")
                  .then(setConnections)
                  .catch(handleError);
              }}
            />
          )}
          {view === "Connections" && owner && (
            <MetaPageSettings
              brands={brands}
              changed={() => {
                void refreshConnectionSetup().catch(handleError);
              }}
            />
          )}
          {view === "Connections" && owner && providerSetup && (
            <ProviderSetup
              state={
                connections?.providers.find((p) => p.id === providerSetup.id) ||
                providerSetup
              }
              close={() => setProviderSetup(null)}
              refresh={refreshConnectionSetup}
              connect={() => {
                const id = providerSetup.id;
                setProviderSetup(null);
                beginConnect(id);
              }}
            />
          )}
          {view === "Brands" && (
            <>
              {brands.length ? (
                <div className="secure-brands">
                  {brands.map((b, i) => (
                    <article key={b.id}>
                      {brandLogos[b.name] ? (
                        <span className="secure-brand-logo">
                          <img src={brandLogos[b.name]} alt="" />
                        </span>
                      ) : (
                        <span
                          className={"secure-brand-monogram tone-" + (i % 3)}
                        >
                          {b.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className="secure-status">
                        {owner ? "Managed by you" : "Access granted"}
                      </span>
                      <h2>{b.name}</h2>
                      <p>
                        {owner
                          ? "Manage this brand’s accounts and team assignments."
                          : "Your super admin has assigned you access to this brand."}
                      </p>
                      <footer>
                        {owner ? (
                          <>
                            <button onClick={() => setView("Connections")}>
                              Accounts →
                            </button>
                            <button onClick={() => setView("Team")}>
                              Team access →
                            </button>
                          </>
                        ) : (
                          <span>
                            Publishing and reporting integration is being
                            connected.
                          </span>
                        )}
                      </footer>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="secure-empty">
                  <h2>
                    {owner
                      ? "Start with your first brand."
                      : "No brands assigned yet."}
                  </h2>
                  <p>
                    {owner
                      ? "Add a brand, then connect its accounts and invite the team."
                      : "Your super admin can assign you a brand from Team access."}
                  </p>
                  {owner && (
                    <button
                      className="primary"
                      onClick={() => setDialog("brand")}
                    >
                      Add a brand
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {view === "Team" && owner && (
            <>
              <div className="secure-role-guide">
                <div>
                  <Icon name="lock" />
                  <b>Super admin</b>
                  <p>
                    Manage connections, brands and team permissions across the
                    workspace.
                  </p>
                </div>
                <div>
                  <Icon name="Approvals" />
                  <b>Admin</b>
                  <p>
                    Work with assigned brands. Cannot connect accounts or change
                    team access.
                  </p>
                </div>
              </div>
              <section className="secure-section">
                <div className="secure-section-title">
                  <h2>Workspace members</h2>
                  <span>{team?.members.length ?? "—"} people</span>
                </div>
                {!team ? (
                  <p>Loading teammates…</p>
                ) : (
                  <div className="secure-team-list">
                    {team.members.map((m) => (
                      <article key={m.id}>
                        <Avatar name={m.name} />
                        <div>
                          <b>
                            {m.name} {m.id === user.id && <small>(you)</small>}
                          </b>
                          <small>{m.email}</small>
                        </div>
                        <span>
                          {m.role === "super_admin" ? "Super admin" : "Admin"}
                        </span>
                        <div className="secure-member-brands">
                          {m.role === "super_admin"
                            ? "All brands"
                            : team.access
                                .filter((a) => a.user_id === m.id)
                                .map(
                                  (a) =>
                                    brands.find((b) => b.id === a.brand_id)
                                      ?.name,
                                )
                                .filter(Boolean)
                                .join(", ") || "No brands assigned"}
                        </div>
                        <span className="secure-status">
                          {m.active ? "Active" : "Access removed"}
                        </span>
                        <button
                          disabled={m.id === user.id}
                          onClick={() => {
                            setEditing(m);
                            setDialog("member");
                          }}
                        >
                          Edit access
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </section>
              {!!team?.invites.length && (
                <section className="secure-section">
                  <div className="secure-section-title">
                    <h2>Pending invitations</h2>
                    <span>Links expire after 48 hours</span>
                  </div>
                  {team.invites.map((i) => (
                    <div className="secure-invite-row" key={i.id}>
                      <b>{i.email}</b>
                      <span>
                        {i.role === "super_admin" ? "Super admin" : "Admin"}
                      </span>
                      <small>
                        Expires {new Date(i.expires_at).toLocaleDateString()}
                      </small>
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await api("/api/team", "DELETE", { id: i.id });
                            setTeam(await api<Team>("/api/team"));
                            setNotice("Invitation revoked.");
                          })
                        }
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      </main>
      {dialog === "password" && (
        <Modal title="Password & security" close={() => !busy && setDialog("")}>
          <form
            className="secure-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                if (f.get("password") !== f.get("confirm"))
                  throw new Error("The new passwords do not match.");
                await api("/api/session", "PATCH", {
                  current: f.get("current"),
                  password: f.get("password"),
                });
                setDialog("");
                setNotice(
                  "Password updated. Other sessions have been signed out. Brand connections are unchanged.",
                );
              });
            }}
          >
            <p>
              Choose a unique passphrase. Updating your password signs out other
              workspace sessions.
            </p>
            <label>
              Current password
              <PasswordInput
                name="current"
                revealLabel="current password"

                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <label>
              New password
              <PasswordInput
                name="password"

                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
              />
            </label>
            <label>
              Confirm new password
              <PasswordInput
                name="confirm"
                revealLabel="confirmation password"

                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
              />
            </label>
            {error && (
              <p className="access-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        </Modal>
      )}
      {dialog === "brand" && (
        <Modal title="Add a brand" close={() => !busy && setDialog("")}>
          <form className="secure-form" onSubmit={saveBrand}>
            <p>
              Give this brand a home in your workspace. Accounts and teammates
              can be assigned next.
            </p>
            <label>
              Brand name
              <input
                name="name"
                required
                maxLength={80}
                placeholder="e.g. IDAO"
                autoFocus
              />
            </label>
            {error && (
              <p role="alert" className="access-error">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Add brand"}
            </button>
          </form>
        </Modal>
      )}
      {dialog === "member" && (
        <Modal
          title={editing ? "Edit team access" : "Invite a teammate"}
          close={() => !busy && setDialog("")}
        >
          <form className="secure-form" onSubmit={saveMember}>
            <p>
              {editing
                ? `Update ${editing.name}’s permissions. Saving ends their current sessions so the new access applies immediately.`
                : "Choose their role and brands. Invitations are shared by link; the hub does not send an email automatically."}
            </p>
            {!editing && (
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="teammate@company.com"
                />
              </label>
            )}
            <label>
              Workspace role
              <select name="role" defaultValue={editing?.role || "admin"}>
                <option value="admin">Admin · assigned brands</option>
                <option value="super_admin">
                  Super admin · all brands and settings
                </option>
              </select>
            </label>
            <fieldset>
              <legend>Brand access for admins</legend>
              {brands.length ? (
                brands.map((b) => (
                  <label className="secure-checkbox" key={b.id}>
                    <input
                      type="checkbox"
                      name="brands"
                      value={b.id}
                      defaultChecked={
                        !!team?.access.some(
                          (a) =>
                            a.user_id === editing?.id && a.brand_id === b.id,
                        )
                      }
                    />
                    <span>{b.name}</span>
                  </label>
                ))
              ) : (
                <p>Add brands before assigning access.</p>
              )}
              <small>
                Super admins automatically have access to every brand.
              </small>
            </fieldset>
            {editing && (
              <label className="secure-checkbox">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={!!editing.active}
                />
                <span>Allow this person to sign in</span>
              </label>
            )}
            {error && (
              <p role="alert" className="access-error">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save access" : "Create invitation"}
            </button>
          </form>
        </Modal>
      )}
      {dialog === "invitation" && (
        <Modal title="Their invitation is ready" close={() => setDialog("")}>
          <div className="secure-form">
            <p>
              Share this link privately by email or your usual team messenger.
              They open it, enter their invited email and choose their own
              password. It expires in 48 hours and only works for their invited
              email address. No email has been sent.
            </p>
            <label>
              Personal invitation link
              <input
                value={inviteUrl}
                readOnly
                onFocus={(e) => e.target.select()}
              />
            </label>
            <button
              className="primary"
              onClick={() =>
                navigator.clipboard
                  .writeText(inviteUrl)
                  .then(() => setNotice("Invitation link copied."))
                  .catch(() => setError("Select and copy the link manually."))
              }
            >
              Copy invitation link
            </button>
            <a
              className="ts-invite-email"
              href={
                "mailto:" +
                encodeURIComponent(inviteEmail) +
                "?subject=" +
                encodeURIComponent("Join " + user.workspaceName) +
                "&body=" +
                encodeURIComponent(
                  "You’re invited to " +
                    user.workspaceName +
                    ".\n\nOpen this private link and sign up using " +
                    inviteEmail +
                    ". Choose your own password; no social media passwords are needed.\n\n" +
                    inviteUrl +
                    "\n\nThis invitation expires in 48 hours.",
                )
              }
            >
              Prepare invitation email
            </a>
            <small>
              Opens a draft in your email app. You review and send it yourself.
            </small>
            {error && <p className="access-error">{error}</p>}
          </div>
        </Modal>
      )}
      {dialog.startsWith("connect:") && (
        <Modal
          title={
            "Connect " +
            connectionProviders.find((p) => p.id === dialog.slice(8))?.name
          }
          close={() => !busy && setDialog("")}
        >
          <div className="secure-form">
            <p>Which brand should this mailbox belong to?</p>
            <label>
              Brand
              <select
                value={selectedBrand}
                onChange={(e) => setSelectedBrand(e.target.value)}
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <p role="alert" className="access-error">
                {error}
              </p>
            )}
            <button
              className="primary"
              disabled={busy || !selectedBrand}
              onClick={() => startConnection(dialog.slice(8), selectedBrand)}
            >
              {busy ? "Opening…" : "Connect"}
            </button>
          </div>
        </Modal>
      )}
      {palette && (
        <div
          className="command-palette"
          role="dialog"
          aria-label="Jump to a section"
        >
          <button className="command-scrim" onClick={() => setPalette("")} />
          <div className="command-panel">
            <input
              autoFocus
              placeholder="Go to publishing, email, connections…"
              value={palette === "open" ? "" : palette}
              onChange={(e) => setPalette(e.target.value)}
            />
            <ul>
              {ALL_VIEWS.filter(
                (item) =>
                  (owner || !["Connections", "Team"].includes(item)) &&
                  item
                    .toLowerCase()
                    .includes(
                      (palette === "open" ? "" : palette).toLowerCase(),
                    ),
              ).map((item) => (
                <li key={item}>
                  <button
                    onClick={() => {
                      if (!allowWorkspaceNavigation()) return;
                      setView(item);
                      setPalette("");
                    }}
                  >
                    {item === "Approvals" ? "Team review" : item}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

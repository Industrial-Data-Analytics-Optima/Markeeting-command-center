import { validAppOrigin } from "../security/request.ts";
import {
  AccessError,
  actorFor,
  requireOwner,
  requireBrand,
  digest,
} from "../auth/core.ts";
import { createTokenVault } from "../connections/vault.ts";
import { linkedinClient } from "./linkedin.ts";
export type LinkedInEnvironment = {
  TOKEN_VAULT_KEY?: string;
  APP_ORIGIN?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  LINKEDIN_API_VERSION?: string;
  LINKEDIN_FEED_PERMISSIONS?: string;
};
export function linkedinSettings(e: LinkedInEnvironment) {
  if (
    !e.TOKEN_VAULT_KEY ||
    !e.APP_ORIGIN ||
    !e.LINKEDIN_CLIENT_ID ||
    !e.LINKEDIN_CLIENT_SECRET
  )
    return null;
  const origin = validAppOrigin(e.APP_ORIGIN);
  if (
    origin.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(origin.hostname)
  )
    return null;
  return {
    authorize: "https://www.linkedin.com/oauth/v2/authorization",
    exchange: "https://www.linkedin.com/oauth/v2/accessToken",
    scope:
      "rw_organization_admin w_organization_social r_organization_social" +
      (e.LINKEDIN_FEED_PERMISSIONS === "true"
        ? " w_organization_social_feed r_organization_social_feed"
        : ""),
    clientId: e.LINKEDIN_CLIENT_ID,
    secret: e.LINKEDIN_CLIENT_SECRET,
    redirect: origin.origin + "/api/connections/linkedin/callback",
    profile: "",
  };
}
export async function finishLinkedIn(
  db: D1Database,
  request: Request,
  e: LinkedInEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const a = await actorFor(db, request);
  requireOwner(a);
  const url = new URL(request.url),
    state = url.searchParams.get("state"),
    config = linkedinSettings(e);
  if (!state || !config)
    throw new AccessError(400, "Authorization expired. Start again.");
  const claimed = await db
    .prepare(
      "DELETE FROM hub_oauth_states WHERE token_hash=? AND session_hash=? AND workspace_id=? AND provider=? AND expires_at>? RETURNING brand_id",
    )
    .bind(digest(state), a.sessionHash, a.workspaceId, "linkedin", Date.now())
    .first<{ brand_id: string }>();
  if (!claimed || url.searchParams.has("error"))
    throw new AccessError(400, "LinkedIn access was not approved.");
  if (claimed.brand_id) await requireBrand(db, a, claimed.brand_id);
  const code = url.searchParams.get("code");
  if (!code) throw new AccessError(400, "Missing authorization code.");
  const r = await fetcher(config.exchange, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.secret,
      redirect_uri: config.redirect,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new AccessError(502, "LinkedIn authorization failed.");
  const t = (await r.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    scope?: string;
  };
  if (!t.access_token || !Number.isFinite(t.expires_in) || t.expires_in <= 0)
    throw new AccessError(502, "Invalid LinkedIn credentials.");
  const granted = new Set((t.scope || "").split(/[ ,]+/));
  if (
    ![
      "w_organization_social",
      "r_organization_social",
      "rw_organization_admin",
    ].every((s) => granted.has(s))
  )
    throw new AccessError(
      403,
      "LinkedIn did not grant the required page permissions.",
    );
  const pages = await linkedinClient(
    t.access_token,
    e.LINKEDIN_API_VERSION,
    fetcher,
  ).discover();
  if (!pages.length)
    throw new AccessError(403, "No managed LinkedIn pages were found.");
  const label = pages[0].person;
  if (!/^urn:li:person:[\w-]+$/.test(label))
    throw new AccessError(502, "LinkedIn did not identify the account owner.");
  const existing = await db
    .prepare(
      "SELECT id FROM social_connections WHERE workspace_id=? AND provider=? AND label=?",
    )
    .bind(a.workspaceId, "linkedin", label)
    .first<{ id: string }>();
  const id = existing?.id || crypto.randomUUID(),
    now = Date.now(),
    vault = await createTokenVault(e.TOKEN_VAULT_KEY!),
    expires = now + t.expires_in * 1000,
    refreshExpires = t.refresh_token_expires_in
      ? now + t.refresh_token_expires_in * 1000
      : null,
    sealed = await vault.seal(
      {
        accessToken: t.access_token,
        accessExpiresAt: expires,
        ...(t.refresh_token
          ? { refreshToken: t.refresh_token, refreshExpiresAt: refreshExpires }
          : {}),
      },
      a.workspaceId,
      id,
    );
  await db.batch([
    db
      .prepare(
        "INSERT INTO social_connections(id,workspace_id,provider,label,sealed_tokens,access_expires_at,refresh_expires_at,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sealed_tokens=excluded.sealed_tokens,version=version+1,access_expires_at=excluded.access_expires_at,refresh_expires_at=excluded.refresh_expires_at,status='healthy',retry_at=NULL,failures=0,lease_owner=NULL,lease_until=NULL",
      )
      .bind(
        id,
        a.workspaceId,
        "linkedin",
        label,
        sealed,
        expires,
        refreshExpires,
        now,
      ),
    db
      .prepare(
        "UPDATE hub_linkedin_pages SET enabled=0 WHERE connection_id=? AND organization_urn NOT IN (" +
          pages.map(() => "?").join(",") +
          ")",
      )
      .bind(id, ...pages.map((p) => p.urn)),
    db
      .prepare(
        "UPDATE social_connections SET granted_scopes=? WHERE id=? AND workspace_id=?",
      )
      .bind(JSON.stringify([...granted]), id, a.workspaceId),
    ...pages.map((p) =>
      db
        .prepare(
          "INSERT INTO hub_linkedin_pages(id,workspace_id,connection_id,organization_urn,name,discovered_at) VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id,organization_urn) DO UPDATE SET connection_id=excluded.connection_id,name=excluded.name,discovered_at=excluded.discovered_at",
        )
        .bind(crypto.randomUUID(), a.workspaceId, id, p.urn, p.name, now),
    ),
    db
      .prepare(
        "DELETE FROM connection_alerts WHERE connection_id=? AND workspace_id=?",
      )
      .bind(id, a.workspaceId),
  ]);
  return id;
}

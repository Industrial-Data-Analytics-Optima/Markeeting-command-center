import { validAppOrigin } from "../security/request.ts";
import {
  linkedinSettings,
  finishLinkedIn,
} from "../publishing/linkedin-oauth.ts";
import {
  actorFor,
  requireOwner,
  sameOrigin,
  AccessError,
  requireBrand,
  token,
  digest,
} from "../auth/core.ts";
import { createTokenVault } from "./vault.ts";
import { metaSettings } from "./meta-client.ts";
import { finishMeta } from "./meta.ts";
export type OAuthEnvironment = {
  TOKEN_VAULT_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  APP_ORIGIN?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  LINKEDIN_API_VERSION?: string;
  LINKEDIN_FEED_PERMISSIONS?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_LOGIN_CONFIG_ID?: string;
  META_GRAPH_VERSION?: string;
};
const configs = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    exchange: "https://oauth2.googleapis.com/token",
    scope:
      "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
    profile: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
  },
  microsoft: {
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    exchange: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "offline_access User.Read Mail.ReadWrite Mail.Send",
    profile:
      "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName",
  },
};
export function settings(provider: string, e: OAuthEnvironment) {
  if (provider === "linkedin") return linkedinSettings(e);
  if (provider === "meta") return metaSettings(e);
  if (provider !== "google" && provider !== "microsoft") return null;
  const clientId =
      provider === "google" ? e.GOOGLE_CLIENT_ID : e.MICROSOFT_CLIENT_ID,
    secret =
      provider === "google"
        ? e.GOOGLE_CLIENT_SECRET
        : e.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !secret || !e.TOKEN_VAULT_KEY || !e.APP_ORIGIN) return null;
  const origin = validAppOrigin(e.APP_ORIGIN);
  if (
    origin.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(origin.hostname)
  )
    return null;
  return {
    ...configs[provider],
    clientId,
    secret,
    redirect: origin.origin + `/api/connections/${provider}/callback`,
  };
}
export async function beginOAuth(
  db: D1Database,
  request: Request,
  provider: string,
  brandId: string,
  e: OAuthEnvironment,
) {
  sameOrigin(request);
  const a = await actorFor(db, request);
  requireOwner(a);
  if (!["linkedin", "meta"].includes(provider))
    await requireBrand(db, a, brandId);
  if (["linkedin", "meta"].includes(provider)) brandId = "";
  const config = settings(provider, e);
  if (!config)
    throw new AccessError(
      503,
      "This provider needs one-time setup before accounts can be connected.",
    );
  if (new URL(request.url).origin !== new URL(config.redirect).origin)
    throw new AccessError(
      403,
      "Use your configured workspace address to connect.",
    );
  const state = token(),
    verifier = token();
  await db
    .prepare(
      "INSERT INTO hub_oauth_states(token_hash,session_hash,workspace_id,provider,brand_id,verifier,expires_at) VALUES(?,?,?,?,?,?,?)",
    )
    .bind(
      digest(state),
      a.sessionHash,
      a.workspaceId,
      provider,
      brandId,
      verifier,
      Date.now() + 10 * 60000,
    )
    .run();
  const url = new URL(config.authorize);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirect,
    response_type: "code",
    ...(provider === "meta"
      ? {
          config_id: (config as ReturnType<typeof metaSettings>)!.configId,
          override_default_response_type: "true",
        }
      : { scope: config.scope }),
    state,
    ...(["linkedin", "meta"].includes(provider)
      ? {}
      : {
          code_challenge: Buffer.from(digest(verifier), "hex").toString(
            "base64url",
          ),
          code_challenge_method: "S256",
        }),
    ...(provider === "google"
      ? { access_type: "offline", prompt: "consent" }
      : provider === "microsoft"
        ? { prompt: "select_account" }
        : {}),
  }).toString();
  return url.toString();
}
export async function finishOAuth(
  db: D1Database,
  request: Request,
  provider: string,
  e: OAuthEnvironment,
  fetcher: typeof fetch = fetch,
) {
  if (provider === "linkedin") return finishLinkedIn(db, request, e, fetcher);
  if (provider === "meta") return finishMeta(db, request, e, fetcher);
  const a = await actorFor(db, request);
  requireOwner(a);
  const url = new URL(request.url),
    state = url.searchParams.get("state");
  if (!state)
    throw new AccessError(400, "Authorization expired. Please start again.");
  const claimed = await db
    .prepare(
      "DELETE FROM hub_oauth_states WHERE token_hash=? AND session_hash=? AND workspace_id=? AND provider=? AND expires_at>? RETURNING brand_id,verifier",
    )
    .bind(digest(state), a.sessionHash, a.workspaceId, provider, Date.now())
    .first<{ brand_id: string; verifier: string }>();
  if (!claimed)
    throw new AccessError(400, "Authorization expired. Please start again.");
  await requireBrand(db, a, claimed.brand_id);
  if (url.searchParams.has("error"))
    throw new AccessError(400, "Account access was not approved.");
  const code = url.searchParams.get("code"),
    config = settings(provider, e);
  if (!code || !config)
    throw new AccessError(400, "Authorization could not be completed.");
  const response = await fetcher(config.exchange, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.secret,
      redirect_uri: config.redirect,
      code_verifier: claimed.verifier,
    }),
  });
  if (!response.ok)
    throw new AccessError(
      502,
      "The provider could not authorize this account.",
    );
  const result = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (
    !result.access_token ||
    !result.refresh_token ||
    !Number.isFinite(result.expires_in)
  )
    throw new AccessError(400, "Ongoing access was not granted.");
  const granted = new Set((result.scope || "").split(" "));
  if (
    granted.has("Mail.ReadWrite") ||
    granted.has("https://graph.microsoft.com/Mail.ReadWrite")
  )
    granted.add("Mail.Read");
  const required =
    provider === "google"
      ? [
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.send",
        ]
      : ["Mail.Read", "Mail.Send"];
  if (
    !required.every(
      (s) => granted.has(s) || granted.has("https://graph.microsoft.com/" + s),
    )
  )
    throw new AccessError(
      400,
      "Please approve reading and sending permissions.",
    );
  const profileResponse = await fetcher(config.profile, {
    headers: { Authorization: "Bearer " + result.access_token },
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!profileResponse.ok)
    throw new AccessError(502, "We could not verify the mailbox.");
  const profile = (await profileResponse.json()) as {
    emailAddress?: string;
    mail?: string;
    userPrincipalName?: string;
  };
  const label =
    profile.emailAddress || profile.mail || profile.userPrincipalName;
  if (!label)
    throw new AccessError(
      502,
      "The provider did not return a mailbox identity.",
    );
  const existing = await db
    .prepare(
      "SELECT id FROM social_connections WHERE workspace_id=? AND provider=? AND label=?",
    )
    .bind(a.workspaceId, provider, label)
    .first<{ id: string }>();
  const id = existing?.id || crypto.randomUUID(),
    vault = await createTokenVault(e.TOKEN_VAULT_KEY!),
    expiresAt = Date.now() + Number(result.expires_in) * 1000;
  const sealed = await vault.seal(
    {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      accessExpiresAt: expiresAt,
    },
    a.workspaceId,
    id,
  );
  await db.batch([
    db
      .prepare(
        `INSERT INTO social_connections(id,workspace_id,provider,label,sealed_tokens,access_expires_at,created_at,granted_scopes) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET granted_scopes=excluded.granted_scopes,sealed_tokens=excluded.sealed_tokens,access_expires_at=excluded.access_expires_at,version=version+1,status='healthy',failures=0,retry_at=NULL,lease_owner=NULL,lease_until=NULL`,
      )
      .bind(
        id,
        a.workspaceId,
        provider,
        label,
        sealed,
        expiresAt,
        Date.now(),
        JSON.stringify([...granted]),
      ),
    db
      .prepare(
        "INSERT OR IGNORE INTO hub_connection_brands(connection_id,brand_id) VALUES(?,?)",
      )
      .bind(id, claimed.brand_id),
    db
      .prepare(
        "DELETE FROM connection_alerts WHERE connection_id=? AND workspace_id=?",
      )
      .bind(id, a.workspaceId),
  ]);
  return id;
}

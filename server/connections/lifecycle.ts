import type { Tokens } from "./vault";
export type Provider = "google" | "microsoft" | "linkedin" | "meta";
export type Connection = {
  id: string;
  workspaceId: string;
  provider: Provider;
  sealedTokens: string;
  version: number;
  status: "healthy" | "retrying" | "reconnect_soon" | "reconnect_required";
  retryAt: number | null;
  failures: number;
};
export type Renewal = {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  refreshExpiresIn?: number;
};
export class RenewalError extends Error {
  kind: "reauthorize" | "temporary";
  retryAfterMs?: number;
  constructor(kind: "reauthorize" | "temporary", retryAfterMs?: number) {
    super(
      kind === "reauthorize"
        ? "Provider authorization required"
        : "Provider temporarily unavailable",
    );
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}
export interface ConnectionStore {
  get(id: string, workspaceId: string): Promise<Connection | null>;
  claim(
    id: string,
    workspaceId: string,
    version: number,
    lease: string,
    now: number,
  ): Promise<boolean>;
  commit(
    connection: Connection,
    lease: string,
    sealedTokens: string,
    now: number,
    expiresAt: number | null,
    refreshExpiresAt: number | null,
  ): Promise<boolean>;
  fail(
    connection: Connection,
    lease: string,
    status: Connection["status"],
    retryAt: number | null,
    now: number,
  ): Promise<void>;
  release(id: string, workspaceId: string, lease: string): Promise<void>;
}
export interface Vault {
  seal(t: Tokens, w: string, id: string): Promise<string>;
  open(s: string, w: string, id: string): Promise<Tokens>;
}
export function renewalBackoff(failures: number) {
  return Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.min(failures, 7));
}
export function credentialHealth(t: Tokens, now: number) {
  const expired = t.accessExpiresAt !== null && t.accessExpiresAt <= now;
  const canRenew =
    !!t.refreshToken &&
    (t.refreshExpiresAt == null || t.refreshExpiresAt > now);
  if (expired && !canRenew) return "reconnect_required";
  if (t.refreshExpiresAt != null && t.refreshExpiresAt - now < 7 * 86400000)
    return "reconnect_soon";
  if (
    t.accessExpiresAt !== null &&
    t.accessExpiresAt - now < 7 * 86400000 &&
    !canRenew
  )
    return "reconnect_soon";
  return "healthy";
}
/** Server-only. The caller must first authorize workspace membership and the intended action.
 * Workspace-scoped storage and refresh leases prevent cross-account access and token races.
 * Tokens deliberately have no relationship to an interactive login session or its logout.
 */
export function connectionService(
  store: ConnectionStore,
  vault: Vault,
  refresh: (p: Provider, t: Tokens) => Promise<Renewal>,
  clock = () => Date.now(),
) {
  return {
    async accessToken(workspaceId: string, id: string): Promise<string> {
      const now = clock(),
        connection = await store.get(id, workspaceId);
      if (!connection || connection.workspaceId !== workspaceId)
        throw new Error("Connection not available");
      if (connection.status === "reconnect_required")
        throw new RenewalError("reauthorize");
      const tokens = await vault.open(connection.sealedTokens, workspaceId, id);
      const valid =
        tokens.accessExpiresAt === null || tokens.accessExpiresAt > now;
      const due =
        tokens.accessExpiresAt !== null &&
        tokens.accessExpiresAt <= now + 5 * 60_000;
      if (!due) return tokens.accessToken;
      if (connection.retryAt && connection.retryAt > now) {
        if (valid) return tokens.accessToken;
        throw new RenewalError("temporary", connection.retryAt - now);
      }
      const lease = crypto.randomUUID();
      if (
        !(await store.claim(id, workspaceId, connection.version, lease, now))
      ) {
        if (valid) return tokens.accessToken;
        throw new RenewalError("temporary", 1000);
      }
      try {
        if (
          !tokens.refreshToken ||
          (tokens.refreshExpiresAt != null && tokens.refreshExpiresAt <= now)
        )
          throw new RenewalError("reauthorize");
        const renewed = await refresh(connection.provider, tokens);
        if (
          !renewed.accessToken ||
          !Number.isFinite(renewed.expiresIn) ||
          renewed.expiresIn <= 0
        )
          throw new RenewalError("temporary");
        const updated: Tokens = {
          ...tokens,
          accessToken: renewed.accessToken,
          accessExpiresAt: now + renewed.expiresIn * 1000,
          refreshToken: renewed.refreshToken || tokens.refreshToken,
          refreshExpiresAt:
            renewed.refreshExpiresIn !== undefined
              ? now + renewed.refreshExpiresIn * 1000
              : tokens.refreshExpiresAt,
        };
        // Provider rotation is committed atomically before the new access token is used.
        const sealed = await vault.seal(updated, workspaceId, id);
        if (
          !(await store.commit(
            connection,
            lease,
            sealed,
            now,
            updated.accessExpiresAt,
            updated.refreshExpiresAt ?? null,
          ))
        )
          throw new RenewalError("temporary");
        return updated.accessToken;
      } catch (error) {
        const failure =
          error instanceof RenewalError ? error : new RenewalError("temporary");
        const retryAt =
          failure.kind === "reauthorize"
            ? null
            : now +
              Math.max(
                renewalBackoff(connection.failures),
                failure.retryAfterMs || 0,
              );
        await store.fail(
          connection,
          lease,
          failure.kind === "reauthorize"
            ? valid
              ? "reconnect_soon"
              : "reconnect_required"
            : "retrying",
          retryAt,
          now,
        );
        if (valid) return tokens.accessToken;
        throw failure;
      } finally {
        await store.release(id, workspaceId, lease);
      }
    },
  };
}

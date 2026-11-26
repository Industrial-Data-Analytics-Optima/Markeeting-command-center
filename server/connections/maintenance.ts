import { connectionService, credentialHealth } from "./lifecycle.ts";
import type { Vault, Provider, Renewal } from "./lifecycle";
import type { Tokens } from "./vault";
import { d1ConnectionStore } from "./d1-store.ts";
/** Call from an authenticated scheduler/Worker scheduled handler, never a browser route.
 * Deployment must bind the database, vault and provider secrets. This is not yet scheduled.
 */
export async function maintainConnections(
  db: D1Database,
  vault: Vault,
  refresh: (p: Provider, t: Tokens) => Promise<Renewal>,
  now = Date.now(),
) {
  const store = d1ConnectionStore(db),
    service = connectionService(store, vault, refresh, () => now);
  const due = await db
    .prepare(
      "SELECT id,workspace_id AS workspaceId FROM social_connections WHERE status<>'reconnect_required' AND (retry_at IS NULL OR retry_at<=?) AND (last_checked_at IS NULL OR last_checked_at<? OR access_expires_at<?) ORDER BY COALESCE(last_checked_at,0) LIMIT 25",
    )
    .bind(now, now - 86400000, now + 5 * 60_000)
    .all<{ id: string; workspaceId: string }>();
  const results: { id: string; status: string }[] = [];
  for (const candidate of due.results) {
    try {
      await service.accessToken(candidate.workspaceId, candidate.id);
      const current = await store.get(candidate.id, candidate.workspaceId);
      if (!current) continue;
      const tokens = await vault.open(
        current.sealedTokens,
        current.workspaceId,
        current.id,
      );
      const health = credentialHealth(tokens, now);
      // Warn before fixed refresh lifetimes end, even while the access token works.
      if (health === "reconnect_soon")
        await db.batch([
          db
            .prepare(
              "UPDATE social_connections SET status='reconnect_soon' WHERE id=? AND workspace_id=? AND version=? AND status='healthy'",
            )
            .bind(current.id, current.workspaceId, current.version),
          db
            .prepare(
              "INSERT INTO connection_alerts(connection_id,workspace_id,kind,created_at) SELECT id,workspace_id,'reconnect_soon',? FROM social_connections WHERE id=? AND workspace_id=? AND version=? ON CONFLICT(connection_id,kind) DO NOTHING",
            )
            .bind(now, current.id, current.workspaceId, current.version),
        ]);
      results.push({ id: current.id, status: health });
    } catch {
      // One failing provider must not prevent other accounts from renewing.
      results.push({ id: candidate.id, status: "attention" });
    }
    await db
      .prepare(
        "UPDATE social_connections SET last_checked_at=? WHERE id=? AND workspace_id=?",
      )
      .bind(now, candidate.id, candidate.workspaceId)
      .run();
  }
  return results;
}

import type { Connection, ConnectionStore } from "./lifecycle";
/** Durable repository. Bind the production D1 database before enabling OAuth. */
export function d1ConnectionStore(db: D1Database): ConnectionStore {
  return {
    async get(id, workspaceId) {
      return await db
        .prepare(
          "SELECT id, workspace_id AS workspaceId, provider, sealed_tokens AS sealedTokens, version, status, retry_at AS retryAt, failures FROM social_connections WHERE id=? AND workspace_id=?",
        )
        .bind(id, workspaceId)
        .first<Connection>();
    },
    async claim(id, workspaceId, version, lease, now) {
      const result = await db
        .prepare(
          "UPDATE social_connections SET lease_owner=?, lease_until=? WHERE id=? AND workspace_id=? AND version=? AND (lease_until IS NULL OR lease_until<=?)",
        )
        .bind(lease, now + 60_000, id, workspaceId, version, now)
        .run();
      return result.meta.changes === 1;
    },
    async commit(c, lease, sealed, now, expiresAt, refreshExpiresAt) {
      const results = await db.batch([
        db
          .prepare(
            "UPDATE social_connections SET sealed_tokens=?, access_expires_at=?, refresh_expires_at=?, version=version+1, status='healthy', failures=0, retry_at=NULL, last_renewed_at=? WHERE id=? AND workspace_id=? AND version=? AND lease_owner=?",
          )
          .bind(
            sealed,
            expiresAt,
            refreshExpiresAt,
            now,
            c.id,
            c.workspaceId,
            c.version,
            lease,
          ),
        db
          .prepare(
            "DELETE FROM connection_alerts WHERE connection_id=? AND workspace_id=? AND EXISTS (SELECT 1 FROM social_connections WHERE id=? AND workspace_id=? AND version=? AND lease_owner=?)",
          )
          .bind(c.id, c.workspaceId, c.id, c.workspaceId, c.version + 1, lease),
      ]);
      return results[0].meta.changes === 1;
    },
    async fail(c, lease, status, retryAt, now) {
      // Updating a failure never overwrites token material or deletes queued work.
      await db.batch([
        db
          .prepare(
            "UPDATE social_connections SET status=?, failures=failures+1, retry_at=?, last_checked_at=? WHERE id=? AND workspace_id=? AND version=? AND lease_owner=?",
          )
          .bind(status, retryAt, now, c.id, c.workspaceId, c.version, lease),
        db
          .prepare(
            "INSERT INTO connection_alerts (connection_id,workspace_id,kind,created_at) SELECT id,workspace_id,?,? FROM social_connections WHERE id=? AND workspace_id=? AND lease_owner=? AND status IN ('reconnect_soon','reconnect_required') ON CONFLICT(connection_id,kind) DO UPDATE SET created_at=excluded.created_at",
          )
          .bind(status, now, c.id, c.workspaceId, lease),
      ]);
    },
    async release(id, workspaceId, lease) {
      await db
        .prepare(
          "UPDATE social_connections SET lease_owner=NULL,lease_until=NULL WHERE id=? AND workspace_id=? AND lease_owner=?",
        )
        .bind(id, workspaceId, lease)
        .run();
    },
  };
}

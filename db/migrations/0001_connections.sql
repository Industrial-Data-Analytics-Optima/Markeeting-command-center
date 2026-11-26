-- Apply only to the selected production workspace database during deployment.
-- Provider credentials are encrypted; application sessions are stored separately.
CREATE TABLE IF NOT EXISTS social_connections (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft','linkedin','meta')),
 label TEXT NOT NULL,
 sealed_tokens TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'healthy' CHECK(status IN ('healthy','retrying','reconnect_soon','reconnect_required')),
 access_expires_at INTEGER,
 refresh_expires_at INTEGER,
 retry_at INTEGER,
 failures INTEGER NOT NULL DEFAULT 0,
 lease_owner TEXT,
 lease_until INTEGER,
 last_renewed_at INTEGER,
 last_checked_at INTEGER,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS social_connections_workspace ON social_connections(workspace_id);
CREATE INDEX IF NOT EXISTS social_connections_due ON social_connections(access_expires_at,retry_at);
CREATE TABLE IF NOT EXISTS connection_alerts (
 connection_id TEXT NOT NULL REFERENCES social_connections(id),
 workspace_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('reconnect_soon','reconnect_required')),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(connection_id,kind)
);

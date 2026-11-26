ALTER TABLE social_connections ADD COLUMN provider_account_id TEXT;
ALTER TABLE social_connections ADD COLUMN meta_checked_at INTEGER;
CREATE UNIQUE INDEX hub_connection_provider_identity ON social_connections(workspace_id,provider,provider_account_id);
CREATE TABLE hub_meta_assets(
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL,
 connection_id TEXT NOT NULL REFERENCES social_connections(id),
 kind TEXT NOT NULL CHECK(kind IN ('facebook','instagram')),
 provider_id TEXT NOT NULL,
 parent_page_id TEXT NOT NULL,
 name TEXT NOT NULL,
 username TEXT,
 tasks TEXT NOT NULL DEFAULT '[]',
 sealed_tokens TEXT NOT NULL,
 brand_id TEXT REFERENCES hub_brands(id),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 available INTEGER NOT NULL DEFAULT 1 CHECK(available IN (0,1)),
 discovered_at INTEGER NOT NULL,
 UNIQUE(workspace_id,kind,provider_id)
);
CREATE INDEX hub_meta_brand_assets ON hub_meta_assets(workspace_id,brand_id,enabled,available);
CREATE TABLE hub_meta_deletions(code TEXT PRIMARY KEY,request_hash TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL);

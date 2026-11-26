ALTER TABLE hub_posts ADD COLUMN review_decision TEXT CHECK(review_decision IN ('approved','changes_requested','rejected'));
CREATE TABLE hub_team_entries(
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES hub_workspaces(id),brand_id TEXT NOT NULL REFERENCES hub_brands(id),
 kind TEXT NOT NULL CHECK(kind IN ('discussion','report')),category TEXT NOT NULL CHECK(category IN ('question','request','observation','update')),
 title TEXT NOT NULL,body TEXT NOT NULL,next_steps TEXT NOT NULL DEFAULT '',observations TEXT NOT NULL DEFAULT '',requests TEXT NOT NULL DEFAULT '',
 week_start TEXT,reference_kind TEXT CHECK(reference_kind IN ('post','ad')),reference_id TEXT,
 status TEXT NOT NULL CHECK(status IN ('open','resolved','draft','published')),created_by TEXT NOT NULL REFERENCES hub_users(id),
 version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 CHECK((kind='report' AND status IN ('draft','published') AND week_start IS NOT NULL) OR (kind='discussion' AND status IN ('open','resolved')))
);
CREATE INDEX hub_team_brand ON hub_team_entries(workspace_id,brand_id,updated_at DESC);
CREATE UNIQUE INDEX hub_team_week ON hub_team_entries(workspace_id,brand_id,created_by,week_start) WHERE kind='report';
CREATE TABLE hub_team_replies(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL REFERENCES hub_team_entries(id),author_id TEXT NOT NULL REFERENCES hub_users(id),body TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX hub_team_reply_entry ON hub_team_replies(entry_id,created_at);
CREATE TABLE hub_team_reads(entry_id TEXT NOT NULL REFERENCES hub_team_entries(id),user_id TEXT NOT NULL REFERENCES hub_users(id),seen_at INTEGER NOT NULL,PRIMARY KEY(entry_id,user_id));
CREATE TABLE hub_team_versions(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL REFERENCES hub_team_entries(id),version INTEGER NOT NULL,snapshot TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(entry_id,version));

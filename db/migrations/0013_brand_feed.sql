ALTER TABLE social_connections ADD COLUMN granted_scopes TEXT NOT NULL DEFAULT '[]';
ALTER TABLE hub_posts ADD COLUMN reshare_post_id TEXT REFERENCES hub_posts(id);
CREATE TABLE hub_feed_saved(workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,post_id TEXT NOT NULL REFERENCES hub_posts(id),PRIMARY KEY(workspace_id,user_id,post_id));
CREATE TABLE hub_feed_notes(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,post_id TEXT NOT NULL REFERENCES hub_posts(id),author_id TEXT NOT NULL REFERENCES hub_users(id),body TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE hub_feed_actions(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,post_id TEXT NOT NULL REFERENCES hub_posts(id),acting_page_id TEXT NOT NULL REFERENCES hub_linkedin_pages(id),kind TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT,error_message TEXT,created_by TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,client_key TEXT NOT NULL,UNIQUE(workspace_id,client_key));
CREATE UNIQUE INDEX hub_feed_comment_dedupe ON hub_feed_actions(workspace_id,post_id,acting_page_id,fingerprint) WHERE kind='comment';
CREATE UNIQUE INDEX hub_feed_reaction_lock ON hub_feed_actions(workspace_id,post_id,acting_page_id) WHERE kind IN ('like','unlike') AND status IN ('processing','uncertain');

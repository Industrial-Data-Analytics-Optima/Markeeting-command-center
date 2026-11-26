ALTER TABLE hub_email_messages ADD COLUMN internet_message_id TEXT;
ALTER TABLE hub_email_messages ADD COLUMN reply_to TEXT NOT NULL DEFAULT '[]';
CREATE TABLE hub_email_message_brands(message_id TEXT NOT NULL REFERENCES hub_email_messages(id),brand_id TEXT NOT NULL REFERENCES hub_brands(id),PRIMARY KEY(message_id,brand_id));
INSERT INTO hub_email_message_brands SELECT id,brand_id FROM hub_email_messages;
CREATE TABLE hub_email_delivery(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,brand_id TEXT NOT NULL,draft_id TEXT NOT NULL REFERENCES hub_email_drafts(id),draft_version INTEGER NOT NULL,mailbox_id TEXT NOT NULL REFERENCES social_connections(id),payload TEXT NOT NULL,message_id TEXT NOT NULL,status TEXT NOT NULL,error_message TEXT,provider_id TEXT,created_by TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,lease_id TEXT,lease_until INTEGER,attempts INTEGER NOT NULL DEFAULT 0,UNIQUE(draft_id,draft_version));
CREATE TABLE hub_email_sync(mailbox_id TEXT PRIMARY KEY REFERENCES social_connections(id),workspace_id TEXT NOT NULL,checked_at INTEGER NOT NULL DEFAULT 0,synced_at INTEGER,cursor TEXT,error_message TEXT,lease_until INTEGER NOT NULL DEFAULT 0,lease_id TEXT);
CREATE UNIQUE INDEX hub_email_one_active_send ON hub_email_delivery(draft_id) WHERE status IN ('queued','preparing','submitting','accepted','sent','uncertain');

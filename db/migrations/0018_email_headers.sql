ALTER TABLE hub_email_messages ADD COLUMN cc TEXT NOT NULL DEFAULT '[]';
ALTER TABLE hub_email_messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';

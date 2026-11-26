ALTER TABLE hub_posts ADD COLUMN review_mode TEXT NOT NULL DEFAULT 'feedback' CHECK(review_mode IN ('feedback','approval'));
-- Preserve holds deliberately created before feedback and sign-off were separated.
UPDATE hub_posts SET review_mode='approval' WHERE editorial_status<>'none';

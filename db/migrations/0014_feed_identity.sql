ALTER TABLE hub_feed_actions ADD COLUMN acting_brand_id TEXT REFERENCES hub_brands(id);
UPDATE hub_feed_actions SET acting_brand_id=(SELECT brand_id FROM hub_linkedin_pages WHERE id=acting_page_id);

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
export function identityFixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  for (const name of [
    "0001_connections.sql",
    "0002_identity.sql",
    "0003_owner_continuity.sql",
    "0004_publishing.sql",
    "0005_editorial.sql",
    "0006_campaign_plans.sql",
    "0007_leads.sql",
    "0008_media_library.sql",
    "0009_video.sql",
    "0010_multipart_media.sql",
    "0011_email.sql",
    "0012_email_files.sql",
    "0013_brand_feed.sql",
    "0014_feed_identity.sql",
    "0015_growth_profiles.sql",
    "0016_ads_builder.sql",
    "0017_email_delivery.sql",
    "0018_email_headers.sql",
    "0019_outlook_uploads.sql",
    "0020_optional_reviews.sql",
    "0021_meta_connections.sql",
    "0022_team_space.sql",
  ])
    sql.exec(
      readFileSync(
        new URL("../db/migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
  const db = {
    prepare(query) {
      let values = [];
      return {
        bind(...args) {
          values = args;
          return this;
        },
        async first() {
          return sql.prepare(query).get(...values) || null;
        },
        async all() {
          return { results: sql.prepare(query).all(...values) };
        },
        async run() {
          return {
            meta: { changes: sql.prepare(query).run(...values).changes },
          };
        },
      };
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        sql.exec("COMMIT");
        return out;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { db, sql };
}

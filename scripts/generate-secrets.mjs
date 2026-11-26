import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";

mkdirSync(".local", { recursive: true });
const file = ".local/production.env";
const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
function keepOrMake(name, make) {
  const match = existing.match(new RegExp("^" + name + "=(.*)$", "m"));
  if (match && match[1].trim()) return match[1].trim();
  return make();
}
const vault = keepOrMake("TOKEN_VAULT_KEY", () =>
  randomBytes(32).toString("base64"),
);
const cron = keepOrMake("CRON_SECRET", () =>
  randomBytes(32).toString("base64url"),
);
const body = `# Generated ${new Date().toISOString()}. Do not commit.
# Paste these into Vercel → Settings → Environment Variables (Production). Use separate credentials for Preview.

DATABASE_URL=
TURSO_AUTH_TOKEN=
BLOB_READ_WRITE_TOKEN=

APP_ORIGIN=https://REPLACE.vercel.app
TOKEN_VAULT_KEY=${vault}
CRON_SECRET=${cron}
SCHEDULER_SECRET=${cron}

LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_API_VERSION=202609
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
EMAIL_DELIVERY_ENABLED=false
EMAIL_SYNC_ENABLED=false
`;
writeFileSync(file, body);
console.log("Wrote .local/production.env");
console.log(
  "TOKEN_VAULT_KEY and CRON_SECRET are filled. Remaining values come from Turso, Blob, and OAuth apps.",
);

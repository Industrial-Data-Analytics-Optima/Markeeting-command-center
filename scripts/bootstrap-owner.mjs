import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdirSync } from "node:fs";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 1) continue;
    const key = trimmed.slice(0, i);
    const value = trimmed.slice(i + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(".env.local");

process.env.DATABASE_URL ||= process.env.TURSO_DATABASE_URL;
const url =
  process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("file:")
    ? process.env.DATABASE_URL
    : pathToFileURL(join(process.cwd(), ".data", "hub.db")).href;
if (url.startsWith("file:"))
  mkdirSync(join(process.cwd(), ".data"), { recursive: true });

const client = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

await client.execute(
  "CREATE TABLE IF NOT EXISTS hub_schema_migrations(id TEXT PRIMARY KEY)",
);
const dir = join(dirname(fileURLToPath(import.meta.url)), "../db/migrations");
for (const file of readdirSync(dir)
  .filter((n) => n.endsWith(".sql"))
  .sort()) {
  const done = await client.execute({
    sql: "SELECT id FROM hub_schema_migrations WHERE id=?",
    args: [file],
  });
  if (done.rows.length) continue;
  await client.executeMultiple(readFileSync(join(dir, file), "utf8"));
  await client.execute({
    sql: "INSERT OR IGNORE INTO hub_schema_migrations VALUES(?)",
    args: [file],
  });
}

const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
const expires = Date.now() + 86400000;
await client.executeMultiple(`
INSERT OR IGNORE INTO hub_workspaces(id,name) VALUES('primary','Marketing Command Center');
INSERT OR IGNORE INTO hub_brands(id,workspace_id,name) VALUES('primary-idao','primary','IDAO'),('primary-optimaviz','primary','Optimaviz'),('primary-ai-jsa','primary','AI JSA'),('primary-nestwise','primary','Nestwise'),('primary-taskgo','primary','TaskGo');
DELETE FROM hub_invites WHERE workspace_id='primary' AND email IS NULL AND used_at IS NULL AND NOT EXISTS(SELECT 1 FROM hub_members WHERE workspace_id='primary');
INSERT INTO hub_invites(token_hash,workspace_id,role,expires_at) SELECT '${hash}','primary','super_admin',${expires} WHERE NOT EXISTS(SELECT 1 FROM hub_members WHERE workspace_id='primary');
`);
mkdirSync(".local", { recursive: true });
const origin = (process.env.APP_ORIGIN || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const invite = origin + "/workspace#invite=" + token;
const members = await client.execute(
  "SELECT user_id FROM hub_members WHERE workspace_id='primary'",
);
if (members.rows.length) {
  console.log("A super admin already exists. No new invitation was created.");
} else {
  writeFileSync(".local/owner-setup.url", invite);
  console.log("Owner invitation saved to .local/owner-setup.url");
  console.log("Valid 24 hours. Open it on the same origin as APP_ORIGIN.");
}

client.close();

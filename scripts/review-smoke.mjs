import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// A separate seed process releases native SQLite file handles before the server starts.
if (process.argv.includes("--seed")) {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if (!input.databaseUrl.startsWith("file:"))
    throw new Error("Remote smoke database refused.");
  const { createClient } = await import("@libsql/client");
  const { createDatabase } = await import("../server/platform/sqlite.ts");
  const client = createClient({ url: input.databaseUrl }),
    db = createDatabase(client);
  await db.prepare("SELECT 1").first();
  await client.batch(
    [
      {
        sql: "INSERT INTO hub_workspaces VALUES(?,?)",
        args: [input.id, "Isolated product review"],
      },
      {
        sql: "INSERT INTO hub_brands VALUES(?,?,?)",
        args: [input.id, input.id, "Review brand"],
      },
      {
        sql: "INSERT INTO hub_invites(token_hash,workspace_id,email,role,brand_ids,expires_at) VALUES(?,?,?,?,?,?)",
        args: [
          createHash("sha256").update(input.invite).digest("hex"),
          input.id,
          input.email,
          "super_admin",
          "[]",
          Date.now() + 600000,
        ],
      },
    ],
    "write",
  );
  client.close();
  process.exit(0);
}

// This script deliberately refuses remote databases and creates its own test identity.
mkdirSync(".local", { recursive: true });
const databasePath = join(
    resolve(".local"),
    "review-http-" + randomUUID() + ".db",
  ),
  databaseUrl = pathToFileURL(databasePath).href;
const portServer = createServer();
await new Promise((r) => portServer.listen(0, "127.0.0.1", r));
const port = portServer.address().port;
await new Promise((r) => portServer.close(r));
const origin = "http://localhost:" + port,
  id = "review-http",
  email = "reviewer@example.test",
  password = randomBytes(24).toString("base64url"),
  invite = randomBytes(32).toString("base64url");
const seeded = spawnSync(
  process.execPath,
  ["--experimental-strip-types", fileURLToPath(import.meta.url), "--seed"],
  {
    input: JSON.stringify({ databaseUrl, id, email, invite }),
    encoding: "utf8",
    windowsHide: true,
  },
);
if (seeded.status !== 0)
  throw new Error("Could not seed the isolated smoke database.");
const cleanEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  TURSO_DATABASE_URL: "",
  TURSO_AUTH_TOKEN: "",
  APP_ORIGIN: origin,
  VERCEL: "",
  BLOB_READ_WRITE_TOKEN: "",
  TOKEN_VAULT_KEY: randomBytes(32).toString("base64"),
  SCHEDULER_SECRET: "",
  CRON_SECRET: "",
  EMAIL_SYNC_ENABLED: "false",
  EMAIL_DELIVERY_ENABLED: "false",
};
for (const key of [
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_LOGIN_CONFIG_ID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
])
  cleanEnv[key] = "";
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { env: cleanEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
// Never forward server output: it can contain environment-specific paths or diagnostics.
let serverLog = "";
child.stdout.on("data", (v) => {
  serverLog = (serverLog + v).slice(-4000);
});
child.stderr.on("data", (v) => {
  serverLog = (serverLog + v).slice(-4000);
});
async function call(
  path,
  method = "GET",
  data,
  cookie = "",
  requestOrigin = origin,
) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Origin: requestOrigin,
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Expected JSON: " + path);
  }
  return {
    status: response.status,
    data: result,
    cookie: response.headers.get("set-cookie")?.split(";")[0] || "",
  };
}
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      ready = (await fetch(origin + "/api/health")).ok;
    } catch {}
    if (ready) break;
    if (child.exitCode !== null)
      throw new Error(
        "Production server exited during startup: " + serverLog.slice(-1800),
      );
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, "Production server starts");
  const page = await fetch(origin + "/workspace"),
    html = await page.text(),
    policy = page.headers.get("content-security-policy");
  assert.equal(page.status, 200);
  assert.ok(policy?.includes("frame-ancestors 'none'"));
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.match(page.headers.get("cache-control") || "", /no-store/);
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)];
  assert.ok(scripts.length);
  for (const script of scripts)
    assert.ok(
      script[1].includes('nonce="' + nonce + '"'),
      "Hydration scripts carry the response nonce",
    );
  const nextPage = await fetch(origin + "/workspace");
  assert.notEqual(
    nextPage.headers.get("content-security-policy"),
    policy,
    "A fresh request uses a fresh nonce",
  );
  assert.equal((await call("/api/team-space")).status, 401);
  assert.equal((await call("/api/internal/tick")).status, 401);
  assert.equal(
    (
      await call(
        "/api/session",
        "POST",
        { email, password },
        "",
        "https://untrusted.test",
      )
    ).status,
    403,
  );
  assert.equal((await call("/api/session", "POST", null)).status, 400);
  const oversized = await fetch(origin + "/api/session", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ body: "é".repeat(10000) }),
  });
  assert.equal(oversized.status, 413);
  const accepted = await call("/api/session", "POST", {
    action: "accept",
    token: invite,
    email,
    password,
    name: "Product reviewer",
  });
  assert.equal(accepted.status, 200);
  assert.ok(accepted.cookie);
  const session = await call("/api/session", "GET", undefined, accepted.cookie);
  assert.equal(session.data.user.role, "super_admin");
  const thread = await call(
    "/api/team-space",
    "POST",
    {
      action: "create",
      clientKey: randomUUID(),
      kind: "discussion",
      brandId: id,
      title: "Review question",
      body: "Is this retained with the work?",
    },
    accepted.cookie,
  );
  assert.equal(thread.status, 200);
  const report = await call(
    "/api/team-space",
    "POST",
    {
      action: "create",
      clientKey: randomUUID(),
      kind: "report",
      brandId: id,
      weekStart: "2026-11-22",
      title: "Review report",
      body: "Work completed.",
    },
    accepted.cookie,
  );
  assert.equal(report.status, 200);
  assert.equal(
    (
      await call(
        "/api/team-space?id=" + report.data.id,
        "GET",
        undefined,
        accepted.cookie,
      )
    ).data.entry.status,
    "draft",
  );
  assert.equal(
    (await call("/api/session", "DELETE", undefined, accepted.cookie)).status,
    200,
  );
  assert.equal(
    (await call("/api/team-space", "GET", undefined, accepted.cookie)).status,
    401,
  );
  console.log(
    "PASS: isolated production server, nonce CSP/hydration markup, fresh nonces, no-store/nosniff, unauthenticated denial, scheduler denial, cross-origin denial, JSON validation/byte limits, invitation acceptance, session, team discussion, private report draft and sign-out.",
  );
} finally {
  child.kill();
  if (child.exitCode === null)
    await new Promise((r) => {
      child.once("exit", r);
      setTimeout(r, 5000);
    });
  assert.ok(
    relative(resolve(".local"), databasePath).startsWith("review-http-"),
  );
  for (const suffix of ["", "-wal", "-shm"])
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        rmSync(databasePath + suffix, { force: true });
        break;
      } catch (e) {
        if (!["EPERM", "EBUSY"].includes(e.code) || attempt === 29) throw e;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  console.log("Isolated smoke database removed.");
}

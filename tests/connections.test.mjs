import test from "node:test";
import assert from "node:assert/strict";
import { createTokenVault } from "../server/connections/vault.ts";
import {
  connectionService,
  credentialHealth,
  RenewalError,
  renewalBackoff,
} from "../server/connections/lifecycle.ts";
import { tokenRefresher } from "../server/connections/providers.ts";
const now = 1_800_000_000_000;
const key = Buffer.alloc(32, 7).toString("base64");
async function setup(tokens, refresh) {
  const vault = await createTokenVault(key);
  let row = {
    id: "connection-a",
    workspaceId: "workspace-a",
    provider: "google",
    sealedTokens: await vault.seal(tokens, "workspace-a", "connection-a"),
    version: 1,
    status: "healthy",
    retryAt: null,
    failures: 0,
  };
  let owner = null;
  const alerts = [];
  const store = {
    async get(id, w) {
      return row.id === id && row.workspaceId === w ? { ...row } : null;
    },
    async claim(id, w, v, lease) {
      if (owner || row.version !== v) return false;
      owner = lease;
      return true;
    },
    async commit(c, lease, sealed) {
      if (owner !== lease || row.version !== c.version) return false;
      row = {
        ...row,
        sealedTokens: sealed,
        version: row.version + 1,
        status: "healthy",
        failures: 0,
        retryAt: null,
      };
      return true;
    },
    async fail(c, lease, status, retryAt) {
      if (owner !== lease) return;
      row = { ...row, status, retryAt, failures: row.failures + 1 };
      alerts.push(status);
    },
    async release(id, w, lease) {
      if (owner === lease) owner = null;
    },
  };
  return {
    service: connectionService(store, vault, refresh, () => now),
    row: () => row,
    tokens: () => vault.open(row.sealedTokens, row.workspaceId, row.id),
    alerts,
  };
}
test("vault encrypts at rest and binds ciphertext to both workspace and connection", async () => {
  const vault = await createTokenVault(key),
    token = {
      accessToken: "secret-access",
      refreshToken: "secret-refresh",
      accessExpiresAt: now + 10000,
    };
  const sealed = await vault.seal(token, "workspace-a", "connection-a");
  assert.ok(!sealed.includes("secret-access"));
  assert.deepEqual(
    await vault.open(sealed, "workspace-a", "connection-a"),
    token,
  );
  await assert.rejects(vault.open(sealed, "workspace-b", "connection-a"));
  await assert.rejects(vault.open(sealed, "workspace-a", "connection-b"));
});
test("a refresh response without refresh_token preserves the existing durable credential and fixed expiry", async () => {
  const s = await setup(
    {
      accessToken: "old",
      refreshToken: "keep-me",
      accessExpiresAt: now - 1,
      refreshExpiresAt: now + 1000000,
    },
    async () => ({ accessToken: "new", expiresIn: 3600 }),
  );
  assert.equal(
    await s.service.accessToken("workspace-a", "connection-a"),
    "new",
  );
  assert.equal((await s.tokens()).refreshToken, "keep-me");
  assert.equal((await s.tokens()).refreshExpiresAt, now + 1000000);
});
test("rotated refresh token is persisted atomically before use", async () => {
  const s = await setup(
    {
      accessToken: "old",
      refreshToken: "old-refresh",
      accessExpiresAt: now - 1,
    },
    async () => ({
      accessToken: "new",
      refreshToken: "rotated",
      expiresIn: 3600,
    }),
  );
  await s.service.accessToken("workspace-a", "connection-a");
  assert.equal((await s.tokens()).refreshToken, "rotated");
  assert.equal(s.row().version, 2);
});
test("temporary outage retains tokens and schedules retry, without labeling the account disconnected", async () => {
  const s = await setup(
    {
      accessToken: "still-valid",
      refreshToken: "keep-me",
      accessExpiresAt: now + 60000,
    },
    async () => {
      throw new RenewalError("temporary");
    },
  );
  assert.equal(
    await s.service.accessToken("workspace-a", "connection-a"),
    "still-valid",
  );
  assert.equal(s.row().status, "retrying");
  assert.ok(s.row().retryAt > now);
  assert.equal((await s.tokens()).refreshToken, "keep-me");
});
test("revoked and expired grants request reconnection but retain saved credentials for audit and recovery", async () => {
  const s = await setup(
    {
      accessToken: "old",
      refreshToken: "old-refresh",
      accessExpiresAt: now - 1,
    },
    async () => {
      throw new RenewalError("reauthorize");
    },
  );
  await assert.rejects(
    s.service.accessToken("workspace-a", "connection-a"),
    /authorization/,
  );
  assert.equal(s.row().status, "reconnect_required");
  assert.ok(s.row().sealedTokens);
  assert.deepEqual(s.alerts, ["reconnect_required"]);
});
test("cross-workspace access is rejected before a provider is contacted", async () => {
  let calls = 0;
  const s = await setup(
    { accessToken: "old", refreshToken: "r", accessExpiresAt: now - 1 },
    async () => {
      calls++;
      return { accessToken: "new", expiresIn: 3600 };
    },
  );
  await assert.rejects(
    s.service.accessToken("workspace-b", "connection-a"),
    /not available/,
  );
  assert.equal(calls, 0);
});
test("concurrent expired-token requests produce only one refresh", async () => {
  let release;
  const hold = new Promise((resolve) => (release = resolve));
  let calls = 0;
  const s = await setup(
    { accessToken: "old", refreshToken: "r", accessExpiresAt: now - 1 },
    async () => {
      calls++;
      await hold;
      return { accessToken: "new", expiresIn: 3600 };
    },
  );
  const first = s.service.accessToken("workspace-a", "connection-a");
  await new Promise((resolve) => setTimeout(resolve, 10));
  await assert.rejects(
    s.service.accessToken("workspace-a", "connection-a"),
    /temporarily/,
  );
  release();
  await first;
  assert.equal(calls, 1);
});
test("near-term authorization expiry produces a warning without resetting token lifetime", () => {
  assert.equal(
    credentialHealth(
      {
        accessToken: "a",
        refreshToken: "r",
        accessExpiresAt: now + 10000,
        refreshExpiresAt: now + 86400000,
      },
      now,
    ),
    "reconnect_soon",
  );
  assert.equal(renewalBackoff(100), 3600000);
});
test("provider refresh does not expose errors or accept HTTP redirects with credentials", async () => {
  const refresh = tokenRefresher(
    { google: { clientId: "client", clientSecret: "private" } },
    async (url, options) => {
      assert.equal(url, "https://oauth2.googleapis.com/token");
      assert.equal(options.redirect, "error");
      assert.equal(new URLSearchParams(options.body).get("refresh_token"), "r");
      return new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "private detail",
        }),
        { status: 400 },
      );
    },
  );
  await assert.rejects(
    refresh("google", {
      accessToken: "a",
      refreshToken: "r",
      accessExpiresAt: now,
    }),
    (e) => e.kind === "reauthorize" && !e.message.includes("private"),
  );
});

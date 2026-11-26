import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { d1ConnectionStore } from "../server/connections/d1-store.ts";
import { createTokenVault } from "../server/connections/vault.ts";
import {
  connectionService,
  RenewalError,
} from "../server/connections/lifecycle.ts";
import { maintainConnections } from "../server/connections/maintenance.ts";
function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    readFileSync(
      new URL("../db/migrations/0001_connections.sql", import.meta.url),
      "utf8",
    ),
  );
  const d1 = {
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
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec("COMMIT");
        return results;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { sql, d1, store: d1ConnectionStore(d1) };
}
const now = 1800000000000;
test("durable storage enforces tenant, version and lease ownership; stale refresh cannot overwrite a new token", async () => {
  const { sql, store } = fixture();
  try {
    sql
      .prepare(
        "INSERT INTO social_connections(id,workspace_id,provider,label,sealed_tokens,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run("c1", "w1", "google", "Mailbox", "ciphertext", now);
    assert.equal(await store.get("c1", "w2"), null);
    assert.equal(await store.claim("c1", "w2", 1, "wrong", now), false);
    const c = await store.get("c1", "w1");
    assert.equal(await store.claim("c1", "w1", 1, "old", now), true);
    assert.equal(await store.claim("c1", "w1", 1, "other", now), false);
    assert.equal(await store.claim("c1", "w1", 1, "new", now + 60001), true);
    assert.equal(
      await store.commit(c, "old", "bad", now + 60002, now + 100000, null),
      false,
    );
    assert.equal(
      await store.commit(c, "new", "good", now + 60002, now + 100000, null),
      true,
    );
    assert.equal((await store.get("c1", "w1")).sealedTokens, "good");
  } finally {
    sql.close();
  }
});
test("a durable reconnect alert is deduplicated and cleared after successful renewal", async () => {
  const { sql, store } = fixture();
  try {
    sql
      .prepare(
        "INSERT INTO social_connections(id,workspace_id,provider,label,sealed_tokens,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run("c1", "w1", "google", "Mailbox", "ciphertext", now);
    const c = await store.get("c1", "w1");
    await store.claim("c1", "w1", 1, "lease", now);
    await store.fail(c, "lease", "reconnect_required", null, now);
    await store.fail(c, "lease", "reconnect_required", null, now + 1);
    assert.equal(
      sql.prepare("SELECT count(*) AS n FROM connection_alerts").get().n,
      1,
    );
    assert.equal((await store.get("c1", "w1")).sealedTokens, "ciphertext");
    await store.commit(
      c,
      "lease",
      "renewed",
      now + 2,
      now + 100000,
      now + 200000,
    );
    assert.equal(
      sql.prepare("SELECT count(*) AS n FROM connection_alerts").get().n,
      0,
    );
    assert.equal(
      sql.prepare("SELECT refresh_expires_at FROM social_connections").get()
        .refresh_expires_at,
      now + 200000,
    );
  } finally {
    sql.close();
  }
});
test("maintenance renews one account even when another is revoked; warnings survive in durable storage", async () => {
  const { sql, d1 } = fixture(),
    vault = await createTokenVault(Buffer.alloc(32, 5).toString("base64"));
  try {
    for (const id of ["good", "revoked", "warning"]) {
      const token = {
        accessToken: id,
        refreshToken: "r",
        accessExpiresAt: id === "warning" ? now + 3600000 : now - 1,
        refreshExpiresAt: id === "warning" ? now + 86400000 : null,
      };
      sql
        .prepare(
          "INSERT INTO social_connections(id,workspace_id,provider,label,sealed_tokens,created_at) VALUES(?,?,?,?,?,?)",
        )
        .run(id, "w1", "google", id, await vault.seal(token, "w1", id), now);
    }
    await maintainConnections(
      d1,
      vault,
      async (p, t) => {
        if (t.accessToken === "revoked") throw new RenewalError("reauthorize");
        return { accessToken: "renewed", expiresIn: 3600 };
      },
      now,
    );
    const rows = sql
      .prepare("SELECT id,status FROM social_connections ORDER BY id")
      .all();
    assert.deepEqual(
      rows.map((r) => [r.id, r.status]),
      [
        ["good", "healthy"],
        ["revoked", "reconnect_required"],
        ["warning", "reconnect_soon"],
      ],
    );
    assert.equal(
      sql.prepare("SELECT count(*) AS n FROM connection_alerts").get().n,
      2,
    );
  } finally {
    sql.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { identityFixture } from "./auth-fixture.mjs";
import { issueSession, actorFor } from "../server/auth/core.ts";
import { beginOAuth, finishOAuth } from "../server/connections/oauth.ts";
import { metaClient, MetaError } from "../server/connections/meta-client.ts";
import {
  metaAssets,
  assignMetaAsset,
  rescanMeta,
} from "../server/connections/meta.ts";
import { createTokenVault } from "../server/connections/vault.ts";
import { createHmac } from "node:crypto";
import {
  verifyMetaRequest,
  metaPrivacyCallback,
} from "../server/connections/meta-callbacks.ts";

const environment = {
  APP_ORIGIN: "http://localhost:3000",
  TOKEN_VAULT_KEY: Buffer.alloc(32, 7).toString("base64"),
  META_APP_ID: "12345",
  META_APP_SECRET: "app-secret",
  META_LOGIN_CONFIG_ID: "67890",
};
function provider() {
  const p = {
    calls: [],
    permissions: [
      "pages_show_list",
      "pages_read_engagement",
      "instagram_basic",
    ],
    pages: [
      {
        id: "100",
        name: "IDAO Facebook",
        access_token: "page-secret",
        tasks: ["CREATE_CONTENT", "ANALYZE"],
        instagram_business_account: {
          id: "200",
          username: "idao",
          name: "IDAO Instagram",
        },
      },
    ],
    fail: false,
    wrongApp: false,
    wrongType: false,
    invalid: false,
    paginate: false,
  };
  p.fetch = async (url, options) => {
    const u = new URL(url);
    p.calls.push({ url, options });
    assert.equal(u.origin, "https://graph.facebook.com");
    assert.equal(options.redirect, "error");
    assert.ok(!url.includes("app-secret"));
    if (p.fail) throw new Error("Network interruption");
    if (u.pathname.endsWith("/oauth/access_token")) {
      assert.equal(options.method, "POST");
      assert.equal(options.body.get("client_secret"), "app-secret");
      return Response.json({
        access_token: options.body.has("code") ? "short-secret" : "long-secret",
        expires_in: 5184000,
      });
    }
    assert.ok(options.headers.Authorization?.startsWith("Bearer "));
    assert.ok(u.searchParams.get("appsecret_proof"));
    if (u.pathname.endsWith("/debug_token"))
      return Response.json({
        data: {
          is_valid: !p.invalid,
          app_id: p.wrongApp ? "99999" : "12345",
          user_id: "777",
          type: p.wrongType ? "SYSTEM_USER" : "USER",
          expires_at: Math.floor(Date.now() / 1000) + 5184000,
          data_access_expires_at: Math.floor(Date.now() / 1000) + 2592000,
        },
      });
    if (u.pathname.endsWith("/me/permissions"))
      return Response.json({
        data: p.permissions.map((permission) => ({
          permission,
          status: "granted",
        })),
      });
    if (u.pathname.endsWith("/me/accounts")) {
      if (p.paginate && !u.searchParams.has("after"))
        return Response.json({
          data: p.pages,
          paging: {
            next: "https://untrusted.example/token?access_token=private",
            cursors: { after: "second" },
          },
        });
      return Response.json({ data: p.paginate ? [] : p.pages });
    }
    if (u.pathname.endsWith("/me"))
      return Response.json({ id: "777", name: "Owner Facebook" });
    throw new Error("Unexpected Meta endpoint");
  };
  return p;
}
async function fixture() {
  const f = identityFixture();
  f.sql.exec(
    "INSERT INTO hub_workspaces VALUES('w','Workspace'),('other','Other'); INSERT INTO hub_brands VALUES('b','w','Brand'),('private','w','Private'),('other-b','other','Other'); INSERT INTO hub_users VALUES('o','owner@example.test','Owner','unused'),('a','admin@example.test','Admin','unused'); INSERT INTO hub_members VALUES('w','o','super_admin',1),('w','a','admin',1); INSERT INTO hub_brand_access VALUES('w','a','b');",
  );
  const raw = await issueSession(f.db, "o", "w"),
    request = new Request("http://localhost:3000/api/connections/meta/start", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
        cookie: "hub_local_session=" + raw,
      },
    }),
    actor = await actorFor(f.db, request);
  const admin = {
    ...actor,
    id: "a",
    role: "admin",
    name: "Admin",
    email: "admin@example.test",
  };
  const authorize = async (p) => {
    const url = new URL(
      await beginOAuth(f.db, request, "meta", "", environment),
    );
    const callback = new Request(
      "http://localhost:3000/api/connections/meta/callback?state=" +
        url.searchParams.get("state") +
        "&code=code",
      { headers: { cookie: "hub_local_session=" + raw } },
    );
    return {
      id: await finishOAuth(f.db, callback, "meta", environment, p.fetch),
      callback,
      url,
    };
  };
  return { ...f, raw, request, actor, admin, authorize };
}
test("Meta authorization uses business-login configuration and consumes a session-bound state once", async () => {
  const f = await fixture(),
    p = provider();
  try {
    const { id, url, callback } = await f.authorize(p);
    assert.equal(url.origin, "https://www.facebook.com");
    assert.equal(url.searchParams.get("config_id"), "67890");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.has("scope"), false);
    assert.equal(url.searchParams.has("code_challenge"), false);
    const row = f.sql
      .prepare("SELECT * FROM social_connections WHERE id=?")
      .get(id);
    assert.equal(row.provider_account_id, "777");
    assert.equal(row.label, "Owner Facebook");
    assert.ok(row.access_expires_at < Date.now() + 31 * 86400000);
    assert.ok(!row.sealed_tokens.includes("long-secret"));
    const vault = await createTokenVault(environment.TOKEN_VAULT_KEY);
    assert.equal(
      (await vault.open(row.sealed_tokens, "w", id)).accessToken,
      "long-secret",
    );
    const assets = f.sql.prepare("SELECT * FROM hub_meta_assets").all();
    assert.equal(assets.length, 2);
    for (const asset of assets) {
      assert.equal(asset.enabled, 0);
      assert.equal(asset.brand_id, null);
      assert.ok(!asset.sealed_tokens.includes("page-secret"));
      assert.equal(
        (await vault.open(asset.sealed_tokens, "w", asset.id)).accessToken,
        "page-secret",
      );
    }
    await assert.rejects(
      finishOAuth(f.db, callback, "meta", environment, p.fetch),
      /not approved/,
    );
    assert.equal(
      f.sql.prepare("SELECT COUNT(*) n FROM social_connections").get().n,
      1,
    );
  } finally {
    f.sql.close();
  }
});
test("Meta credentials and unselected assets are never returned to ordinary admins", async () => {
  const f = await fixture();
  try {
    await f.authorize(provider());
    await assert.rejects(metaAssets(f.db, f.admin), /super admin/);
    assert.equal((await metaAssets(f.db, f.admin, true)).assets.length, 0);
    const all = await metaAssets(f.db, f.actor),
      fb = all.assets.find((a) => a.kind === "facebook"),
      ig = all.assets.find((a) => a.kind === "instagram");
    assert.ok(!JSON.stringify(all).includes("secret"));
    assert.ok(!JSON.stringify(all).includes("sealed_tokens"));
    await assert.rejects(
      assignMetaAsset(f.db, f.admin, { id: fb.id, brandId: "b" }),
      /super admin/,
    );
    await assert.rejects(
      assignMetaAsset(f.db, f.actor, { id: fb.id, brandId: "other-b" }),
      /brand/i,
    );
    await assignMetaAsset(f.db, f.actor, { id: fb.id, brandId: "b" });
    await assignMetaAsset(f.db, f.actor, { id: ig.id, brandId: "private" });
    const selected = await metaAssets(f.db, f.admin, true);
    assert.deepEqual(
      selected.assets.map((a) => a.id),
      [fb.id],
    );
    assert.equal(selected.connections.length, 0);
    await assignMetaAsset(f.db, f.actor, { id: fb.id, brandId: "" });
    assert.equal((await metaAssets(f.db, f.admin, true)).assets.length, 0);
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) n FROM hub_connection_brands WHERE brand_id='b'",
        )
        .get().n,
      0,
    );
  } finally {
    f.sql.close();
  }
});
test("reconnect retains explicit choices, keeps new accounts private and disables removed accounts", async () => {
  const f = await fixture(),
    p = provider();
  try {
    const first = await f.authorize(p),
      assets = (await metaAssets(f.db, f.actor)).assets,
      fb = assets.find((a) => a.kind === "facebook"),
      ig = assets.find((a) => a.kind === "instagram");
    await assignMetaAsset(f.db, f.actor, { id: fb.id, brandId: "b" });
    await assignMetaAsset(f.db, f.actor, { id: ig.id, brandId: "b" });
    p.pages.push({
      id: "101",
      name: "New Page",
      access_token: "new-page-secret",
      tasks: ["ANALYZE"],
    });
    const next = await f.authorize(p);
    assert.equal(first.id, next.id);
    assert.equal((await metaAssets(f.db, f.admin, true)).assets.length, 2);
    assert.equal(
      f.sql
        .prepare("SELECT enabled FROM hub_meta_assets WHERE provider_id='101'")
        .get().enabled,
      0,
    );
    delete p.pages[0].instagram_business_account;
    await rescanMeta(f.db, f.actor, first.id, environment, p.fetch);
    assert.equal((await metaAssets(f.db, f.admin, true)).assets.length, 1);
    const removed = f.sql
      .prepare(
        "SELECT available,enabled FROM hub_meta_assets WHERE kind='instagram'",
      )
      .get();
    assert.equal(removed.available, 0);
    assert.equal(removed.enabled, 0);
    await assert.rejects(
      assignMetaAsset(f.db, f.actor, { id: ig.id, brandId: "b" }),
      /Reconnect/,
    );
  } finally {
    f.sql.close();
  }
});
test("Meta pagination ignores provider-supplied navigation URLs and follows only pinned cursors", async () => {
  const p = provider();
  p.paginate = true;
  const result = await metaClient(environment, p.fetch).authorize("code");
  assert.equal(result.assets.length, 2);
  assert.ok(
    p.calls.some((c) => new URL(c.url).searchParams.get("after") === "second"),
  );
  assert.ok(
    p.calls.every((c) => new URL(c.url).hostname === "graph.facebook.com"),
  );
  const bad = provider(),
    fetcher = async (url, options) =>
      new URL(url).pathname.endsWith("/me/accounts")
        ? Response.json({
            data: bad.pages,
            paging: { next: "https://bad.example/" },
          })
        : bad.fetch(url, options);
  await assert.rejects(
    metaClient(environment, fetcher).authorize("code"),
    /could not finish/,
  );
});
test("invalid tokens, wrong app identities and unsupported Meta token types cannot create connections", async () => {
  for (const field of ["wrongApp", "wrongType", "invalid"]) {
    const f = await fixture(),
      p = provider();
    p[field] = true;
    try {
      await assert.rejects(f.authorize(p), /User access token/);
      assert.equal(
        f.sql.prepare("SELECT COUNT(*) n FROM social_connections").get().n,
        0,
      );
      assert.equal(
        f.sql.prepare("SELECT COUNT(*) n FROM hub_meta_assets").get().n,
        0,
      );
    } finally {
      f.sql.close();
    }
  }
});
test("required permissions are enforced while Facebook-only grants do not invent Instagram access", async () => {
  const bad = provider();
  bad.permissions = ["instagram_basic"];
  await assert.rejects(
    metaClient(environment, bad.fetch).authorize("code"),
    /Page listing/,
  );
  const p = provider();
  p.permissions = ["pages_show_list", "pages_read_engagement"];
  delete p.pages[0].instagram_business_account;
  const result = await metaClient(environment, p.fetch).authorize("code");
  assert.equal(result.assets.length, 1);
  assert.ok(
    !new URL(
      p.calls.find((c) => new URL(c.url).pathname.endsWith("/me/accounts")).url,
    ).searchParams
      .get("fields")
      .includes("instagram_business_account"),
  );
});
test("failed snapshot writes roll back both credentials and discovered assets", async () => {
  const f = await fixture();
  try {
    f.sql.exec(
      "CREATE TRIGGER fail_meta BEFORE INSERT ON hub_meta_assets BEGIN SELECT RAISE(ABORT,'forced'); END",
    );
    await assert.rejects(f.authorize(provider()), /forced/);
    assert.equal(
      f.sql.prepare("SELECT COUNT(*) n FROM social_connections").get().n,
      0,
    );
  } finally {
    f.sql.close();
  }
});
test("temporary Meta outages retain assigned assets and revoked permission requires explicit reconnection", async () => {
  const f = await fixture(),
    p = provider();
  try {
    const { id } = await f.authorize(p),
      fb = (await metaAssets(f.db, f.actor)).assets.find(
        (a) => a.kind === "facebook",
      );
    await assignMetaAsset(f.db, f.actor, { id: fb.id, brandId: "b" });
    p.fail = true;
    await assert.rejects(
      rescanMeta(f.db, f.actor, id, environment, p.fetch),
      /could not be reached/,
    );
    assert.equal((await metaAssets(f.db, f.admin, true)).assets.length, 1);
    assert.equal(
      f.sql.prepare("SELECT status FROM social_connections").get().status,
      "retrying",
    );
    p.fail = false;
    p.permissions = [];
    await assert.rejects(
      rescanMeta(f.db, f.actor, id, environment, p.fetch),
      /Page listing/,
    );
    assert.equal((await metaAssets(f.db, f.admin, true)).assets.length, 0);
    assert.equal(
      f.sql.prepare("SELECT status FROM social_connections").get().status,
      "reconnect_required",
    );
    assert.ok(
      f.sql.prepare("SELECT sealed_tokens FROM social_connections").get()
        .sealed_tokens,
    );
  } finally {
    f.sql.close();
  }
});
test("a connection changed during discovery cannot be overwritten by an older Meta snapshot", async () => {
  const f = await fixture(),
    p = provider();
  try {
    const { id } = await f.authorize(p);
    p.pages[0].name = "Stale name";
    let changed = false;
    const fetcher = async (url, options) => {
      const r = await p.fetch(url, options);
      if (new URL(url).pathname.endsWith("/me/accounts") && !changed) {
        changed = true;
        f.sql
          .prepare("UPDATE social_connections SET version=version+1 WHERE id=?")
          .run(id);
      }
      return r;
    };
    await assert.rejects(
      rescanMeta(f.db, f.actor, id, environment, fetcher),
      /changed during discovery/,
    );
    assert.equal(
      f.sql
        .prepare("SELECT name FROM hub_meta_assets WHERE kind='facebook'")
        .get().name,
      "IDAO Facebook",
    );
  } finally {
    f.sql.close();
  }
});

test("Meta OAuth cannot be started by an admin or completed from another session", async () => {
  const f = await fixture(),
    p = provider();
  try {
    const raw = await issueSession(f.db, "a", "w"),
      adminRequest = new Request(
        "http://localhost:3000/api/connections/meta/start",
        {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            "Content-Type": "application/json",
            cookie: "hub_local_session=" + raw,
          },
        },
      );
    await assert.rejects(
      beginOAuth(f.db, adminRequest, "meta", "", environment),
      /super admin/,
    );
    const started = new URL(
      await beginOAuth(f.db, f.request, "meta", "", environment),
    );
    const other = await issueSession(f.db, "o", "w");
    const wrong = new Request(
      "http://localhost:3000/api/connections/meta/callback?state=" +
        started.searchParams.get("state") +
        "&code=code",
      { headers: { cookie: "hub_local_session=" + other } },
    );
    await assert.rejects(
      finishOAuth(f.db, wrong, "meta", environment, p.fetch),
      /not approved/,
    );
    assert.equal(p.calls.length, 0);
  } finally {
    f.sql.close();
  }
});

test("workspace logout leaves Meta account credentials and explicit sharing assignments intact", async () => {
  const f = await fixture();
  try {
    const { id } = await f.authorize(provider()),
      fb = (await metaAssets(f.db, f.actor)).assets.find(
        (a) => a.kind === "facebook",
      );
    await assignMetaAsset(f.db, f.actor, { id: fb.id, brandId: "b" });
    f.sql.exec("DELETE FROM hub_sessions WHERE workspace_id='w'");
    assert.ok(
      f.sql
        .prepare("SELECT sealed_tokens FROM social_connections WHERE id=?")
        .get(id),
    );
    assert.equal(
      f.sql.prepare("SELECT enabled FROM hub_meta_assets WHERE id=?").get(fb.id)
        .enabled,
      1,
    );
  } finally {
    f.sql.close();
  }
});

const signed = (extra = {}) => {
  const payload = Buffer.from(
    JSON.stringify({
      algorithm: "HMAC-SHA256",
      issued_at: Math.floor(Date.now() / 1000),
      user_id: "777",
      ...extra,
    }),
  ).toString("base64url");
  return (
    createHmac("sha256", "app-secret").update(payload).digest("base64url") +
    "." +
    payload
  );
};
const callbackRequest = (value) =>
  new Request("http://localhost:3000/api/meta/deletion", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ signed_request: value }),
  });
test("Meta deletion callbacks verify signatures and remove only the requesting provider account", async () => {
  const f = await fixture();
  try {
    await f.authorize(provider());
    f.sql.exec(
      "INSERT INTO social_connections(id,workspace_id,provider,label,provider_account_id,sealed_tokens,created_at) VALUES('unrelated','other','meta','Other owner','888','opaque',1)",
    );
    const request = signed();
    await assert.rejects(
      metaPrivacyCallback(
        f.db,
        callbackRequest(request.slice(0, -1) + "X"),
        environment,
        true,
      ),
      /signature/,
    );
    assert.equal(
      f.sql.prepare("SELECT COUNT(*) n FROM hub_meta_assets").get().n,
      2,
    );
    const result = await metaPrivacyCallback(
      f.db,
      callbackRequest(request),
      environment,
      true,
    );
    assert.match(result.url, /\/meta-deletion\?code=/);
    assert.equal(result.confirmation_code.length, 32);
    assert.equal(
      f.sql.prepare("SELECT COUNT(*) n FROM hub_meta_assets").get().n,
      0,
    );
    assert.equal(
      f.sql.prepare("SELECT COUNT(*) n FROM social_connections").get().n,
      1,
    );
    assert.equal(
      f.sql.prepare("SELECT COUNT(*) n FROM hub_members").get().n,
      2,
    );
    await f.authorize(provider());
    const repeated = await metaPrivacyCallback(
      f.db,
      callbackRequest(request),
      environment,
      true,
    );
    assert.equal(repeated.confirmation_code, result.confirmation_code);
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) n FROM social_connections WHERE workspace_id='w'",
        )
        .get().n,
      1,
      "A callback replay must not revoke a fresh authorization",
    );
  } finally {
    f.sql.close();
  }
});
test("Meta deauthorization is signed and cannot remove another app or workspace login", async () => {
  const f = await fixture();
  try {
    await f.authorize(provider());
    const result = await metaPrivacyCallback(
      f.db,
      callbackRequest(signed()),
      environment,
      false,
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(
      f.sql.prepare("SELECT COUNT(*) n FROM social_connections").get().n,
      0,
    );
    assert.equal(
      f.sql.prepare("SELECT COUNT(*) n FROM hub_sessions").get().n,
      1,
    );
  } finally {
    f.sql.close();
  }
});
test("Meta callback validation rejects stale signatures, wrong algorithms and malformed requests", () => {
  assert.equal(verifyMetaRequest(signed(), "app-secret"), "777");
  assert.throws(
    () =>
      verifyMetaRequest(
        signed({ issued_at: Math.floor(Date.now() / 1000) - 90000 }),
        "app-secret",
      ),
    /expired/,
  );
  assert.throws(
    () => verifyMetaRequest(signed({ algorithm: "other" }), "app-secret"),
    /Invalid/,
  );
  assert.throws(() => verifyMetaRequest("malformed", "app-secret"), /Invalid/);
});

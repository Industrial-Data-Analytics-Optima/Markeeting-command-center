import test from "node:test";
import assert from "node:assert/strict";
import { identityFixture } from "./auth-fixture.mjs";
import {
  acceptInvite,
  authenticate,
  changePassword,
} from "../server/auth/accounts.ts";
import {
  actorFor,
  requireOwner,
  requireBrand,
  listBrands,
  issueSession,
  digest,
  sameOrigin,
  cookie,
  throttle,
} from "../server/auth/core.ts";
const password = "local-test-passphrase-only";
function seed() {
  const f = identityFixture();
  f.sql.exec(
    "INSERT INTO hub_workspaces VALUES('w1','One'),('w2','Two'); INSERT INTO hub_brands VALUES('b1','w1','IDAO'),('b2','w1','Optimaviz'),('b3','w2','Private');",
  );
  return f;
}
function invite(sql, raw, email, role = "admin", brands = ["b1"]) {
  sql
    .prepare(
      "INSERT INTO hub_invites(token_hash,workspace_id,email,role,brand_ids,expires_at) VALUES(?,?,?,?,?,?)",
    )
    .run(
      digest(raw),
      "w1",
      email,
      role,
      JSON.stringify(brands),
      Date.now() + 60000,
    );
}
const request = (raw) =>
  new Request("http://localhost:3000/api/team", {
    headers: { cookie: "hub_local_session=" + raw },
  });
test("single-use invitations bind email, role and brand access; sessions never expose tokens", async () => {
  const { db, sql } = seed();
  try {
    invite(sql, "invitation", "admin@example.test");
    await assert.rejects(
      acceptInvite(db, {
        token: "invitation",
        email: "other@example.test",
        name: "Other",
        password,
      }),
      /another email/,
    );
    const user = await acceptInvite(db, {
      token: "invitation",
      email: "admin@example.test",
      name: "Admin",
      password,
    });
    await assert.rejects(
      acceptInvite(db, {
        token: "invitation",
        email: "admin@example.test",
        name: "Admin",
        password,
      }),
      /expired/,
    );
    const raw = await issueSession(db, user.userId, user.workspaceId),
      a = await actorFor(db, request(raw));
    assert.equal(a.role, "admin");
    assert.throws(() => requireOwner(a), /super admin/);
    assert.deepEqual(
      (await listBrands(db, a)).map((b) => b.id),
      ["b1"],
    );
    await requireBrand(db, a, "b1");
    await assert.rejects(requireBrand(db, a, "b2"), /access/);
    await assert.rejects(requireBrand(db, a, "b3"), /not found/);
    assert.equal(
      sql.prepare("SELECT token_hash FROM hub_sessions").get().token_hash,
      digest(raw),
    );
    assert.equal(
      await authenticate(db, "admin@example.test", password).then(
        (x) => x.userId,
      ),
      user.userId,
    );
    await assert.rejects(
      authenticate(db, "admin@example.test", "wrong"),
      /incorrect/,
    );
  } finally {
    sql.close();
  }
});
test("disabled membership invalidates existing sessions and login", async () => {
  const { db, sql } = seed();
  try {
    invite(sql, "invite2", "a@example.test");
    const u = await acceptInvite(db, {
        token: "invite2",
        email: "a@example.test",
        name: "Admin",
        password,
      }),
      raw = await issueSession(db, u.userId, u.workspaceId);
    sql
      .prepare("UPDATE hub_members SET active=0 WHERE user_id=?")
      .run(u.userId);
    await assert.rejects(actorFor(db, request(raw)), /session ended/);
    await assert.rejects(
      authenticate(db, "a@example.test", password),
      /incorrect/,
    );
  } finally {
    sql.close();
  }
});
test("password changes require the old password and revoke all old sessions", async () => {
  const { db, sql } = seed();
  try {
    invite(sql, "invite3", "a@example.test");
    const u = await acceptInvite(db, {
        token: "invite3",
        email: "a@example.test",
        name: "Admin",
        password,
      }),
      raw = await issueSession(db, u.userId, u.workspaceId);
    await assert.rejects(
      changePassword(db, u.userId, "wrong", "a-new-long-password"),
      /incorrect/,
    );
    await changePassword(db, u.userId, password, "a-new-long-password");
    await assert.rejects(actorFor(db, request(raw)), /session ended/);
    await assert.rejects(
      authenticate(db, "a@example.test", password),
      /incorrect/,
    );
    assert.equal(
      (await authenticate(db, "a@example.test", "a-new-long-password")).userId,
      u.userId,
    );
  } finally {
    sql.close();
  }
});
test("last owner survives demotion; role comes from DB, not browser headers", async () => {
  const { db, sql } = seed();
  try {
    invite(sql, "owner", "owner@example.test", "super_admin");
    const u = await acceptInvite(db, {
      token: "owner",
      email: "owner@example.test",
      name: "Owner",
      password,
    });
    assert.throws(
      () =>
        sql
          .prepare("UPDATE hub_members SET role=? WHERE user_id=?")
          .run("admin", u.userId),
      /super admin/,
    );
    await assert.rejects(
      actorFor(
        db,
        new Request("http://localhost/api", {
          headers: {
            "oai-authenticated-user-id": u.userId,
            "x-role": "super_admin",
          },
        }),
      ),
      /Sign in/,
    );
  } finally {
    sql.close();
  }
});
test("write actions reject missing/cross-site origins; cookies are host-only and HTTP-only", () => {
  assert.throws(
    () =>
      sameOrigin(new Request("https://hub.example/api", { method: "POST" })),
    /workspace/,
  );
  assert.throws(
    () =>
      sameOrigin(
        new Request("https://hub.example/api", {
          method: "POST",
          headers: {
            origin: "https://evil.example",
            "content-type": "application/json",
          },
        }),
      ),
    /workspace/,
  );
  sameOrigin(
    new Request("https://hub.example/api", {
      method: "POST",
      headers: {
        origin: "https://hub.example",
        "content-type": "application/json",
      },
    }),
  );
  assert.match(
    cookie(new Request("https://hub.example"), "value"),
    /__Host-hub_session=value; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure/,
  );
});
test("login throttling persists and resets after its window", async () => {
  const { db, sql } = seed();
  try {
    for (let i = 0; i < 3; i++) await throttle(db, "attempt", 3);
    await assert.rejects(throttle(db, "attempt", 3), /Too many/);
    sql.exec("UPDATE hub_login_limits SET reset_at=0");
    await throttle(db, "attempt", 3);
  } finally {
    sql.close();
  }
});

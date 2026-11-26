import test from "node:test";
import assert from "node:assert/strict";
import { identityFixture } from "./auth-fixture.mjs";
import {
  beginOAuth,
  finishOAuth,
  settings,
} from "../server/connections/oauth.ts";
import { issueSession, digest } from "../server/auth/core.ts";
import { createTokenVault } from "../server/connections/vault.ts";
const environment = {
  APP_ORIGIN: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "test-client",
  GOOGLE_CLIENT_SECRET: "test-secret",
  TOKEN_VAULT_KEY: Buffer.alloc(32, 7).toString("base64"),
};
async function fixture(role = "super_admin") {
  const f = identityFixture();
  f.sql.exec(
    `INSERT INTO hub_workspaces VALUES('w','Workspace'); INSERT INTO hub_brands VALUES('b','w','Brand'); INSERT INTO hub_users VALUES('u','test@example.test','Test','unused'); INSERT INTO hub_members VALUES('w','u','${role}',1);`,
  );
  const raw = await issueSession(f.db, "u", "w");
  const req = new Request(
    "http://localhost:3000/api/connections/google/start",
    {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        cookie: "hub_local_session=" + raw,
      },
    },
  );
  return { ...f, raw, req };
}
test("OAuth start requires server-verified super admin and configured provider", async () => {
  const f = await fixture("admin");
  try {
    await assert.rejects(
      beginOAuth(f.db, f.req, "google", "b", environment),
      /super admin/,
    );
    assert.equal(settings("linkedin", environment), null);
    assert.equal(settings("google", {}), null);
  } finally {
    f.sql.close();
  }
});
test("OAuth state is session-bound, single use and PKCE protected; credentials are encrypted", async () => {
  const f = await fixture();
  try {
    const auth = new URL(
      await beginOAuth(f.db, f.req, "google", "b", environment),
    );
    assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
    assert.equal(auth.searchParams.get("access_type"), "offline");
    const state = auth.searchParams.get("state");
    assert.equal(
      f.sql.prepare("SELECT token_hash FROM hub_oauth_states").get().token_hash,
      digest(state),
    );
    const callback = () =>
      new Request(
        "http://localhost:3000/api/connections/google/callback?state=" +
          state +
          "&code=code",
        { headers: { cookie: "hub_local_session=" + f.raw } },
      );
    let calls = 0;
    const fetcher = async (url, options) => {
      calls++;
      if (calls === 1) {
        assert.equal(options.redirect, "error");
        assert.ok(options.body.get("code_verifier"));
        return Response.json({
          access_token: "access-secret",
          refresh_token: "refresh-secret",
          expires_in: 3600,
          scope:
            "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
        });
      }
      return Response.json({ emailAddress: "mailbox@example.test" });
    };
    const id = await finishOAuth(
      f.db,
      callback(),
      "google",
      environment,
      fetcher,
    );
    const saved = f.sql
      .prepare("SELECT * FROM social_connections WHERE id=?")
      .get(id);
    assert.ok(!saved.sealed_tokens.includes("access-secret"));
    const vault = await createTokenVault(environment.TOKEN_VAULT_KEY);
    assert.equal(
      (await vault.open(saved.sealed_tokens, "w", id)).refreshToken,
      "refresh-secret",
    );
    assert.equal(
      f.sql.prepare("SELECT brand_id FROM hub_connection_brands").get()
        .brand_id,
      "b",
    );
    await assert.rejects(
      finishOAuth(f.db, callback(), "google", environment, fetcher),
      /expired/,
    );
    assert.equal(calls, 2);
  } finally {
    f.sql.close();
  }
});
test("another session cannot claim the authorization state", async () => {
  const f = await fixture();
  try {
    const auth = new URL(
        await beginOAuth(f.db, f.req, "google", "b", environment),
      ),
      other = await issueSession(f.db, "u", "w");
    await assert.rejects(
      finishOAuth(
        f.db,
        new Request(
          "http://localhost:3000/api/connections/google/callback?state=" +
            auth.searchParams.get("state") +
            "&code=code",
          { headers: { cookie: "hub_local_session=" + other } },
        ),
        "google",
        environment,
        async () => {
          throw new Error("Must not contact provider");
        },
      ),
      /expired/,
    );
    assert.equal(
      f.sql.prepare("SELECT COUNT(*) AS n FROM hub_oauth_states").get().n,
      1,
    );
  } finally {
    f.sql.close();
  }
});

test("Outlook authorization requests upload permission and retains the actual granted scopes on reauthorization", async () => {
  const f = await fixture(),
    env = {
      ...environment,
      MICROSOFT_CLIENT_ID: "client",
      MICROSOFT_CLIENT_SECRET: "secret",
    };
  try {
    let savedId;
    for (const scope of [
      "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send",
      "Mail.Read Mail.Send",
    ]) {
      const auth = new URL(
        await beginOAuth(f.db, f.req, "microsoft", "b", env),
      );
      assert.ok(auth.searchParams.get("scope").includes("Mail.ReadWrite"));
      const callback = new Request(
        "http://localhost:3000/api/connections/microsoft/callback?state=" +
          auth.searchParams.get("state") +
          "&code=code",
        { headers: { cookie: "hub_local_session=" + f.raw } },
      );
      let calls = 0;
      const id = await finishOAuth(
        f.db,
        callback,
        "microsoft",
        env,
        async () =>
          ++calls === 1
            ? Response.json({
                access_token: "access",
                refresh_token: "refresh",
                expires_in: 3600,
                scope,
              })
            : Response.json({ mail: "outlook@example.test" }),
      );
      if (savedId) assert.equal(id, savedId);
      savedId = id;
      const grants = JSON.parse(
        f.sql
          .prepare("SELECT granted_scopes FROM social_connections WHERE id=?")
          .get(id).granted_scopes,
      );
      assert.ok(grants.includes(scope.split(" ")[0]));
      if (scope === "Mail.Read Mail.Send")
        assert.ok(!grants.includes("Mail.ReadWrite"));
    }
  } finally {
    f.sql.close();
  }
});

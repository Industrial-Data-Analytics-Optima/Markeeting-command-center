import test from "node:test";
import assert from "node:assert/strict";
import { identityFixture } from "./auth-fixture.mjs";
import { issueSession } from "../server/auth/core.ts";
import { beginOAuth } from "../server/connections/oauth.ts";
import { finishLinkedIn } from "../server/publishing/linkedin-oauth.ts";
import { linkedinClient } from "../server/publishing/linkedin.ts";
const environment = {
  APP_ORIGIN: "http://localhost:3000",
  LINKEDIN_CLIENT_ID: "test-client",
  LINKEDIN_CLIENT_SECRET: "test-secret",
  TOKEN_VAULT_KEY: Buffer.alloc(32, 8).toString("base64"),
};
test("LinkedIn authorization discovers pages without auto-assigning them and accepts finite tokens without refresh grants", async () => {
  const { db, sql } = identityFixture();
  try {
    sql.exec(
      "INSERT INTO hub_workspaces VALUES('w','Workspace'); INSERT INTO hub_users VALUES('u','owner@example.test','Owner','unused'); INSERT INTO hub_members VALUES('w','u','super_admin',1); INSERT INTO hub_brands VALUES('b','w','Brand');",
    );
    const raw = await issueSession(db, "u", "w"),
      headers = {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        cookie: "hub_local_session=" + raw,
      };
    const auth = new URL(
      await beginOAuth(
        db,
        new Request("http://localhost:3000/api/connections/linkedin/start", {
          method: "POST",
          headers,
        }),
        "linkedin",
        "",
        environment,
      ),
    );
    assert.equal(auth.origin, "https://www.linkedin.com");
    assert.equal(auth.searchParams.has("code_challenge"), false);
    const cb = new Request(
      "http://localhost:3000/api/connections/linkedin/callback?state=" +
        auth.searchParams.get("state") +
        "&code=test",
      { headers },
    );
    const fetcher = async (url, options) => {
      if (url.includes("/accessToken")) {
        assert.equal(options.body.get("client_secret"), "test-secret");
        return Response.json({
          access_token: "temporary-token",
          expires_in: 3600,
          scope:
            "rw_organization_admin w_organization_social r_organization_social",
        });
      }
      if (url.includes("/organizationAcls"))
        return Response.json({
          elements: [
            {
              organization: "urn:li:organization:123",
              roleAssignee: "urn:li:person:abc",
              role: "ADMINISTRATOR",
              state: "APPROVED",
            },
            {
              organization: "urn:li:organization:456",
              roleAssignee: "urn:li:person:abc",
              role: "ANALYST",
              state: "APPROVED",
            },
          ],
        });
      return Response.json({ localizedName: "Test page" });
    };
    await finishLinkedIn(db, cb, environment, fetcher);
    const page = sql.prepare("SELECT * FROM hub_linkedin_pages").get();
    assert.equal(page.name, "Test page");
    assert.equal(page.brand_id, null);
    assert.equal(page.enabled, 0);
    assert.equal(
      sql.prepare("SELECT COUNT(*) AS n FROM hub_linkedin_pages").get().n,
      1,
    );
    assert.ok(
      !sql
        .prepare("SELECT sealed_tokens FROM social_connections")
        .get()
        .sealed_tokens.includes("temporary-token"),
    );
    await assert.rejects(
      finishLinkedIn(db, cb, environment, fetcher),
      /not approved/,
    );
  } finally {
    sql.close();
  }
});
test("LinkedIn image upload initialization rejects an external upload host", async () => {
  const client = linkedinClient("test", "202609", async () =>
    Response.json({
      value: {
        image: "urn:li:image:test",
        uploadUrl: "https://attacker.example/upload",
      },
    }),
  );
  await assert.rejects(
    client.initializeImage("urn:li:organization:123"),
    (e) => e.code === "UPLOAD_HOST",
  );
});
test("organic metrics request isolates the organization and exact post", async () => {
  const client = linkedinClient("test", "202609", async (url) => {
    const u = new URL(url);
    assert.equal(
      u.searchParams.get("organizationalEntity"),
      "urn:li:organization:123",
    );
    assert.equal(u.searchParams.get("ugcPosts[0]"), "urn:li:ugcPost:456");
    return Response.json({
      elements: [
        { totalShareStatistics: { impressionCount: 10, likeCount: 2 } },
      ],
    });
  });
  assert.deepEqual(
    await client.metrics("urn:li:organization:123", "urn:li:ugcPost:456"),
    { impressionCount: 10, likeCount: 2 },
  );
});

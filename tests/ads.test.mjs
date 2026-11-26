import test from "node:test";
import assert from "node:assert/strict";
import { identityFixture } from "./auth-fixture.mjs";
import { saveAdBuild } from "../server/publishing/ads.ts";
const actor = { id: "u", workspaceId: "w", role: "admin" };
function fixture() {
  const f = identityFixture();
  f.sql.exec(
    "INSERT INTO hub_workspaces VALUES('w','Workspace'); INSERT INTO hub_users VALUES('u','u@example.test','Admin','unused'); INSERT INTO hub_members VALUES('w','u','admin',1); INSERT INTO hub_brands VALUES('b','w','Brand'),('p','w','Private'); INSERT INTO hub_brand_access VALUES('w','u','b'); INSERT INTO hub_media(id,workspace_id,brand_id,object_key,mime,bytes,width,height,created_by,created_at) VALUES('m','w','b','key','image/png',100,1,1,'u',1);",
  );
  return f;
}
const input = () => ({
  brandId: "b",
  name: "Launch",
  platform: "LinkedIn",
  currency: "ZAR",
  objective: "Traffic",
  status: "ready",
  clientKey: crypto.randomUUID(),
  groups: [
    {
      name: "Operators",
      audience: "Operations managers",
      exclusions: "Existing customers",
      countries: ["ZA"],
      basis: "daily",
      budget: "1250.25",
      start: "2026-12-01",
      end: "2026-12-31",
      ads: [
        {
          name: "Variant A",
          headline: "Make work simpler",
          text: "A clear message",
          destination: "https://example.test",
          mediaId: "m",
          cta: "Learn more",
        },
      ],
    },
  ],
});
test("ad builds persist complete hierarchies and exact planned currency budgets without launching ads", async () => {
  const { db, sql } = fixture();
  try {
    const p = input(),
      first = await saveAdBuild(db, actor, p);
    assert.equal((await saveAdBuild(db, actor, p)).id, first.id);
    const row = sql.prepare("SELECT * FROM hub_ad_builds").get();
    assert.equal(row.currency, "ZAR");
    assert.equal(JSON.parse(row.payload).groups[0].budget, "1250.25");
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM hub_posts").get().n, 0);
    await saveAdBuild(db, actor, {
      ...p,
      id: first.id,
      version: 1,
      status: "archived",
    });
    await assert.rejects(
      saveAdBuild(db, actor, { ...p, id: first.id, version: 1 }),
      /changed elsewhere/,
    );
    assert.equal(
      sql.prepare("SELECT status FROM hub_ad_builds").get().status,
      "archived",
    );
  } finally {
    sql.close();
  }
});
test("readiness and brand boundaries reject incomplete targeting, wrong assets and invalid allocations", async () => {
  const { db, sql } = fixture();
  try {
    const p = input();
    await assert.rejects(
      saveAdBuild(db, actor, { ...p, brandId: "p" }),
      /access/,
    );
    const incomplete = structuredClone(p);
    incomplete.groups[0].audience = "";
    await assert.rejects(
      saveAdBuild(db, actor, incomplete),
      /Complete targeting/,
    );
    incomplete.status = "draft";
    await saveAdBuild(db, actor, incomplete);
    const wrong = structuredClone(p);
    wrong.groups[0].ads[0].mediaId = "unknown";
    await assert.rejects(saveAdBuild(db, actor, wrong), /active creative/);
    const invalid = structuredClone(p);
    invalid.groups[0].budget = "1.001";
    await assert.rejects(saveAdBuild(db, actor, invalid));
    const destination = structuredClone(p);
    destination.groups[0].ads[0].destination = "javascript:alert(1)";
    await assert.rejects(saveAdBuild(db, actor, destination), /HTTPS/);
  } finally {
    sql.close();
  }
});

test("failed history writes roll back the campaign save atomically", async () => {
  const { db, sql } = fixture();
  try {
    sql.exec(
      "CREATE TRIGGER fail_history BEFORE INSERT ON hub_ad_build_events BEGIN SELECT RAISE(ABORT,'simulated history failure'); END;",
    );
    await assert.rejects(saveAdBuild(db, actor, input()), /simulated/);
    assert.equal(
      sql.prepare("SELECT COUNT(*) n FROM hub_ad_builds").get().n,
      0,
    );
    sql.exec("DROP TRIGGER fail_history");
    const payload = input(),
      saved = await saveAdBuild(db, actor, payload);
    sql.exec(
      "CREATE TRIGGER fail_history BEFORE INSERT ON hub_ad_build_events BEGIN SELECT RAISE(ABORT,'simulated history failure'); END;",
    );
    await assert.rejects(
      saveAdBuild(db, actor, {
        ...payload,
        id: saved.id,
        version: 1,
        name: "Changed",
      }),
      /simulated/,
    );
    assert.equal(
      sql.prepare("SELECT name FROM hub_ad_builds").get().name,
      "Launch",
    );
    assert.equal(
      sql.prepare("SELECT version FROM hub_ad_builds").get().version,
      1,
    );
  } finally {
    sql.close();
  }
});

test("archiving permits retired own-brand assets but never cross-brand attachments", async () => {
  const { db, sql } = fixture();
  try {
    sql.exec(
      "UPDATE hub_media SET archived=1 WHERE id='m'; INSERT INTO hub_media(id,workspace_id,brand_id,object_key,mime,bytes,width,height,created_by,created_at) VALUES('private-media','w','p','private-key','image/png',100,1,1,'u',1);",
    );
    const payload = input();
    payload.status = "archived";
    await saveAdBuild(db, actor, payload);
    payload.clientKey = crypto.randomUUID();
    payload.groups[0].ads[0].mediaId = "private-media";
    await assert.rejects(saveAdBuild(db, actor, payload), /from this brand/);
  } finally {
    sql.close();
  }
});

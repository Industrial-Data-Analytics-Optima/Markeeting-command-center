import test from "node:test";
import assert from "node:assert/strict";
import { identityFixture } from "./auth-fixture.mjs";
import {
  saveCampaign,
  validateCampaign,
} from "../server/publishing/campaigns.ts";
import { savePost } from "../server/publishing/posts.ts";
import { parseBudget, budgetGroups } from "../app/campaign-model.ts";
const actor = {
  id: "u",
  name: "Admin",
  email: "u@example.test",
  workspaceId: "w",
  workspaceName: "Workspace",
  role: "admin",
  sessionHash: "",
};
function fixture() {
  const f = identityFixture();
  f.sql.exec(
    "INSERT INTO hub_workspaces VALUES('w','Workspace'); INSERT INTO hub_users VALUES('u','u@example.test','Admin','unused'); INSERT INTO hub_members VALUES('w','u','admin',1); INSERT INTO hub_brands VALUES('b','w','Brand'),('private','w','Private'); INSERT INTO hub_brand_access VALUES('w','u','b');",
  );
  return f;
}
const input = (extra = {}) => ({
  brandId: "b",
  name: "Campaign",
  platform: "LinkedIn",
  objective: "Leads",
  budget: "1250.25",
  currency: "ZAR",
  budgetBasis: "total",
  status: "draft",
  clientKey: crypto.randomUUID(),
  ...extra,
});
test("planned budgets preserve decimal minor units and reject unsupported input", () => {
  assert.equal(parseBudget("1250.25"), 125025);
  assert.equal(parseBudget("0.01"), 1);
  assert.equal(parseBudget(""), null);
  for (const value of ["0", "-1", "1.001", "1e5", "NaN", "1,000"])
    assert.throws(() => parseBudget(value));
  assert.throws(() => validateCampaign(input({ currency: "" })), /currency/);
});
test("budget summaries never mix currencies, budget bases or archived plans", () => {
  const groups = budgetGroups([
    {
      currency: "ZAR",
      budget_minor: 10000,
      budget_basis: "total",
      status: "draft",
    },
    {
      currency: "ZAR",
      budget_minor: 20000,
      budget_basis: "daily",
      status: "ready",
    },
    {
      currency: "USD",
      budget_minor: 30000,
      budget_basis: "total",
      status: "draft",
    },
    {
      currency: "USD",
      budget_minor: 90000,
      budget_basis: "total",
      status: "archived",
    },
  ]);
  assert.equal(groups.length, 3);
  assert.equal(groups.find((g) => g.currency === "USD").minor, 30000);
  assert.equal(
    groups.find((g) => g.currency === "ZAR" && g.basis === "daily").minor,
    20000,
  );
});
test("ready plans need complete briefs and valid dates, countries and destinations", () => {
  assert.throws(
    () => validateCampaign(input({ status: "ready" })),
    /Ready plans/,
  );
  assert.throws(
    () => validateCampaign(input({ startDate: "2026-02-30" })),
    /valid campaign date/,
  );
  assert.throws(
    () =>
      validateCampaign(
        input({ startDate: "2026-12-10", endDate: "2026-12-01" }),
      ),
    /End date/,
  );
  assert.throws(
    () => validateCampaign(input({ countries: ["ALL", "ZA"] })),
    /Worldwide/,
  );
  assert.throws(
    () => validateCampaign(input({ destination: "javascript:alert(1)" })),
    /HTTPS/,
  );
  const plan = validateCampaign(
    input({
      status: "ready",
      startDate: "2026-12-01",
      endDate: "2026-12-31",
      countries: ["ZA"],
      audience: "Operations leaders",
    }),
  );
  assert.equal(plan.status, "ready");
  assert.equal(plan.budget, 125025);
});
test("campaign plans persist without providers and save idempotently", async () => {
  const { db, sql } = fixture();
  try {
    const payload = input(),
      first = await saveCampaign(db, actor, payload);
    assert.equal((await saveCampaign(db, actor, payload)).id, first.id);
    const saved = sql.prepare("SELECT * FROM hub_campaign_plans").get();
    assert.equal(saved.budget_minor, 125025);
    assert.equal(saved.currency, "ZAR");
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM hub_posts").get().n, 0);
    await assert.rejects(
      saveCampaign(db, actor, { ...payload, name: "Different intent" }),
      /earlier save/,
    );
  } finally {
    sql.close();
  }
});
test("brand permissions and same-brand content links are enforced server-side", async () => {
  const { db, sql } = fixture();
  try {
    await assert.rejects(
      saveCampaign(db, actor, input({ brandId: "private" })),
      /access/,
    );
    await assert.rejects(
      saveCampaign(db, actor, input({ postIds: ["unknown"] })),
      /belong to this brand/,
    );
    const post = await savePost(
      db,
      actor,
      {
        brandId: "b",
        text: "Campaign content",
        action: "draft",
        clientKey: crypto.randomUUID(),
      },
      false,
    );
    const campaign = await saveCampaign(
      db,
      actor,
      input({ postIds: [post.id] }),
    );
    assert.equal(
      sql
        .prepare("SELECT post_id FROM hub_campaign_posts WHERE campaign_id=?")
        .get(campaign.id).post_id,
      post.id,
    );
    assert.equal(
      sql.prepare("SELECT status FROM hub_posts WHERE id=?").get(post.id)
        .status,
      "draft",
    );
  } finally {
    sql.close();
  }
});
test("optimistic edits preserve existing content links on stale saves and archive without publishing", async () => {
  const { db, sql } = fixture();
  try {
    const post = await savePost(
        db,
        actor,
        {
          brandId: "b",
          text: "Content",
          action: "draft",
          clientKey: crypto.randomUUID(),
        },
        false,
      ),
      payload = input({ postIds: [post.id] }),
      campaign = await saveCampaign(db, actor, payload);
    await saveCampaign(db, actor, {
      ...payload,
      id: campaign.id,
      version: 1,
      status: "archived",
    });
    await assert.rejects(
      saveCampaign(db, actor, {
        ...payload,
        id: campaign.id,
        version: 1,
        postIds: [],
      }),
      /changed elsewhere/,
    );
    assert.equal(
      sql.prepare("SELECT COUNT(*) AS n FROM hub_campaign_posts").get().n,
      1,
    );
    assert.equal(
      sql.prepare("SELECT status FROM hub_campaign_plans").get().status,
      "archived",
    );
    assert.equal(
      sql.prepare("SELECT COUNT(*) AS n FROM hub_campaign_edit_guards").get().n,
      0,
    );
    assert.equal(
      sql.prepare("SELECT status FROM hub_posts").get().status,
      "draft",
    );
  } finally {
    sql.close();
  }
});

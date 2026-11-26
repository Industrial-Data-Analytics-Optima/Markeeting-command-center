import test from "node:test";
import assert from "node:assert/strict";
import { identityFixture } from "./auth-fixture.mjs";
import { growthSummary, leadProfileGroups } from "../app/growth-model.ts";
import {
  followerFacets,
  followerDaily,
  recordGrowth,
} from "../server/publishing/growth.ts";
import { linkedinClient } from "../server/publishing/linkedin.ts";
import { saveLead } from "../server/publishing/leads.ts";
test("new followers, observed net change and reporting coverage remain separate; missing values are not zero-filled", () => {
  const s = growthSummary(
    [
      { day: "2026-11-01", total: 100, captured_at: 1 },
      { day: "2026-11-05", total: 108, captured_at: 2 },
    ],
    [
      { day: "2026-11-02", organic: 7, paid: 3 },
      { day: "2026-11-03", organic: 2, paid: null },
    ],
    "2026-11-01",
    "2026-11-07",
  );
  assert.equal(s.netChange, 8);
  assert.equal(s.newFollowers, 10);
  assert.equal(s.reportedDays, 1);
  assert.equal(s.organic, 7);
  assert.equal(s.paid, 3);
  assert.equal(s.growthRate, 8);
  assert.equal(
    growthSummary([], [], "2026-11-01", "2026-11-07").newFollowers,
    null,
  );
  assert.equal(
    growthSummary(
      [
        { day: "2026-11-01", total: 0, captured_at: 1 },
        { day: "2026-11-02", total: 5, captured_at: 2 },
      ],
      [],
      "2026-11-01",
      "2026-11-07",
    ).growthRate,
    null,
  );
});
test("audience facets use the provider aggregate count without adding paid followers twice", () => {
  const result = followerFacets({
    followerCountsByIndustry: [
      {
        industry: "urn:li:industry:4",
        followerCounts: { organicFollowerCount: 100, paidFollowerCount: 25 },
      },
    ],
    followerCountsByStaffCountRange: [
      {
        staffCountRange: "SIZE_11_TO_50",
        followerCounts: { organicFollowerCount: 12, paidFollowerCount: 3 },
      },
    ],
  });
  assert.equal(result[0].followers, 100);
  assert.equal(result[1].label, "11–50");
  assert.deepEqual(
    followerFacets({
      followerCountsByIndustry: [
        { industry: "x", followerCounts: { paidFollowerCount: 3 } },
      ],
    }),
    [],
  );
});
test("daily gains isolate the organization and exact UTC days and preserve unknown components", () => {
  const start = Date.parse("2026-11-01"),
    end = start + 3 * 86400000,
    row = {
      organizationalEntity: "urn:li:organization:1",
      timeRange: { start, end: start + 86400000 },
      followerGains: { organicFollowerGain: 0 },
    };
  const result = followerDaily(
    [
      row,
      { ...row, organizationalEntity: "urn:li:organization:2" },
      { ...row, timeRange: { start: start + 1, end: end + 1 } },
    ],
    "urn:li:organization:1",
    start,
    end,
  );
  assert.deepEqual(result, [{ day: "2026-11-01", organic: 0, paid: null }]);
});
test("growth snapshots are durable and a failed refresh retains the last successful counts and audience", async () => {
  const { db, sql } = identityFixture();
  try {
    sql.exec(
      "INSERT INTO hub_workspaces VALUES('w','Workspace'); INSERT INTO hub_brands VALUES('b','w','Brand'); INSERT INTO social_connections(id,workspace_id,provider,label,sealed_tokens,created_at) VALUES('c','w','linkedin','Account','unused',1); INSERT INTO hub_linkedin_pages VALUES('p','w','c','urn:li:organization:1','Page','b',1,1);",
    );
    const p = { id: "p", workspace_id: "w", brand_id: "b" },
      now = Date.parse("2026-11-01T10:00:00Z");
    await recordGrowth(
      db,
      p,
      {
        total: 100,
        gains: [{ day: "2026-10-30", organic: 5, paid: 2 }],
        audience: [
          {
            dimension: "industry",
            key: "industry:4",
            label: "Technology",
            followers: 60,
          },
        ],
      },
      now,
    );
    await recordGrowth(db, p, { error: "Temporary outage" }, now + 86400000);
    assert.equal(
      sql.prepare("SELECT total FROM hub_page_follower_snapshots").get().total,
      100,
    );
    assert.equal(
      sql.prepare("SELECT followers FROM hub_page_audience").get().followers,
      60,
    );
    assert.equal(
      sql.prepare("SELECT total_synced_at FROM hub_page_growth_status").get()
        .total_synced_at,
      now,
    );
    assert.equal(
      sql.prepare("SELECT error_message FROM hub_page_growth_status").get()
        .error_message,
      "Temporary outage",
    );
  } finally {
    sql.close();
  }
});
test("lead profiles persist through unrelated edits and manual corrections retain honest provenance", async () => {
  const { db, sql } = identityFixture();
  try {
    sql.exec(
      "INSERT INTO hub_workspaces VALUES('w','Workspace'); INSERT INTO hub_users VALUES('u','u@example.test','Admin','unused'); INSERT INTO hub_members VALUES('w','u','admin',1); INSERT INTO hub_brands VALUES('b','w','Brand'); INSERT INTO hub_brand_access VALUES('w','u','b');",
    );
    const a = { id: "u", workspaceId: "w", role: "admin" },
      { id } = await saveLead(db, a, {
        brandId: "b",
        name: "Contact",
        industry: "Technology",
        job_title: "Operations Director",
        country: "South Africa",
        company_size: "11–50",
        interests: "Analytics services",
      });
    sql
      .prepare("UPDATE hub_leads SET profile_source='lead_form' WHERE id=?")
      .run(id);
    await saveLead(db, a, {
      brandId: "b",
      id,
      version: 1,
      name: "Contact",
      stage: "Qualified",
    });
    assert.equal(
      sql.prepare("SELECT industry FROM hub_leads").get().industry,
      "Technology",
    );
    assert.equal(
      sql.prepare("SELECT profile_source FROM hub_leads").get().profile_source,
      "lead_form",
    );
    await saveLead(db, a, {
      brandId: "b",
      id,
      version: 2,
      name: "Contact",
      industry: "Manufacturing",
    });
    assert.equal(
      sql.prepare("SELECT profile_source FROM hub_leads").get().profile_source,
      "manual",
    );
  } finally {
    sql.close();
  }
});
test("lead profile counts include unknown values explicitly and do not infer industries from company names", () => {
  const result = leadProfileGroups(
    [
      { company: "Technology Corp", industry: "" },
      { industry: "Finance" },
      { industry: "finance" },
    ],
    "industry",
  );
  assert.equal(result.missing, 1);
  assert.deepEqual(result.rows, [{ label: "Finance", count: 2 }]);
});
test("LinkedIn follower reporting requests the correct organization, date window and network-size endpoint", async () => {
  const urls = [],
    client = linkedinClient("token", "202609", async (url) => {
      urls.push(url);
      if (url.includes("/networkSizes/"))
        return Response.json({ firstDegreeSize: 123 });
      if (url.includes("/industries/"))
        return Response.json({ name: { localized: { en_US: "Technology" } } });
      return Response.json({
        elements: [{ organizationalEntity: "urn:li:organization:1" }],
      });
    });
  assert.equal(await client.followerTotal("urn:li:organization:1"), 123);
  assert.ok(urls[0].includes("/v2/networkSizes/"));
  await client.followerGains("urn:li:organization:1", 1, 10);
  const q = new URL(urls[1]).searchParams;
  assert.equal(q.get("organizationalEntity"), "urn:li:organization:1");
  assert.equal(q.get("timeIntervals.timeRange.start"), "1");
  assert.equal(q.get("timeIntervals.timeRange.end"), "10");
  assert.equal(await client.audienceLabel("urn:li:industry:4"), "Technology");
});

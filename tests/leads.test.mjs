import test from "node:test";
import assert from "node:assert/strict";
import { identityFixture } from "./auth-fixture.mjs";
import { saveLead } from "../server/publishing/leads.ts";
const a = { id: "u", workspaceId: "w", role: "admin" };
function fixture() {
  const f = identityFixture();
  f.sql.exec(
    "INSERT INTO hub_workspaces VALUES('w','Workspace'); INSERT INTO hub_users VALUES('u','u@example.test','Admin','unused'),('x','x@example.test','Other','unused'); INSERT INTO hub_members VALUES('w','u','admin',1),('w','x','admin',1); INSERT INTO hub_brands VALUES('b','w','Brand'),('p','w','Private'); INSERT INTO hub_brand_access VALUES('w','u','b');",
  );
  return f;
}
test("lead records and notes persist; stale updates cannot overwrite follow-up", async () => {
  const { db, sql } = fixture();
  try {
    const { id } = await saveLead(db, a, {
      brandId: "b",
      name: "A customer",
      email: "a@example.test",
    });
    await saveLead(db, a, {
      id,
      brandId: "b",
      version: 1,
      name: "A customer",
      stage: "Qualified",
      followUp: "2026-12-10",
      assigneeId: "u",
    });
    await assert.rejects(
      saveLead(db, a, { id, brandId: "b", version: 1, name: "Stale" }),
      /changed elsewhere/,
    );
    await saveLead(db, a, {
      id,
      brandId: "b",
      action: "note",
      note: "Requested a proposal",
    });
    assert.equal(
      sql.prepare("SELECT stage FROM hub_leads WHERE id=?").get(id).stage,
      "Qualified",
    );
    assert.equal(
      sql.prepare("SELECT body FROM hub_lead_notes").get().body,
      "Requested a proposal",
    );
  } finally {
    sql.close();
  }
});
test("lead access, assignment and campaign attribution enforce brand boundaries", async () => {
  const { db, sql } = fixture();
  try {
    await assert.rejects(
      saveLead(db, a, { brandId: "p", name: "Private" }),
      /access/,
    );
    await assert.rejects(
      saveLead(db, a, { brandId: "b", name: "Contact", assigneeId: "x" }),
      /active teammate/,
    );
    await assert.rejects(
      saveLead(db, a, { brandId: "b", name: "Contact", campaignId: "unknown" }),
      /campaign belonging/,
    );
    await assert.rejects(
      saveLead(db, a, {
        brandId: "b",
        name: "Contact",
        followUp: "2026-02-30",
      }),
      /valid follow-up/,
    );
    await assert.rejects(
      saveLead(db, a, { brandId: "b", name: "Contact", email: "invalid" }),
      /email/,
    );
  } finally {
    sql.close();
  }
});

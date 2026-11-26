import test from "node:test";
import assert from "node:assert/strict";
import { identityFixture } from "./auth-fixture.mjs";
import {
  teamAction,
  teamList,
  teamDetail,
  teamReferences,
  weekStart,
} from "../server/team/space.ts";
import { savePost } from "../server/publishing/posts.ts";
const actor = (id, role = "admin") => ({
  id,
  name: id,
  email: id + "@example.test",
  workspaceId: "w",
  workspaceName: "Workspace",
  role,
  sessionHash: "",
});
const author = actor("author"),
  peer = actor("peer"),
  owner = actor("owner", "super_admin"),
  outsider = actor("outsider");
function fixture() {
  const f = identityFixture();
  f.sql.exec(
    "INSERT INTO hub_workspaces VALUES('w','Workspace');INSERT INTO hub_workspaces VALUES('other','Other');INSERT INTO hub_brands VALUES('b','w','Brand');INSERT INTO hub_brands VALUES('private','w','Private');INSERT INTO hub_brands VALUES('foreign','other','Foreign');",
  );
  for (const a of [author, peer, owner, outsider]) {
    f.sql
      .prepare("INSERT INTO hub_users VALUES(?,?,?,?)")
      .run(a.id, a.email, a.name, "unused");
    f.sql
      .prepare("INSERT INTO hub_members VALUES(?,?,?,1)")
      .run("w", a.id, a.role);
  }
  for (const a of [author, peer])
    f.sql
      .prepare("INSERT INTO hub_brand_access VALUES(?,?,?)")
      .run("w", a.id, "b");
  return f;
}
const create = (overrides = {}) => ({
  action: "create",
  clientKey: crypto.randomUUID(),
  kind: "discussion",
  brandId: "b",
  category: "question",
  title: "Can we clarify this launch?",
  body: "Which audience is the priority?",
  ...overrides,
});
const list = (db, a, q = "") =>
  teamList(db, a, new URL("https://hub.test/?" + q));

test("weekly dates normalize to Monday and reject invalid calendar dates", () => {
  assert.equal(weekStart("2026-11-22"), "2026-11-16");
  assert.equal(weekStart("2026-11-23"), "2026-11-23");
  for (const value of ["2026-02-30", "2026-13-01", "bad", null, "2026-1-1"])
    assert.throws(() => weekStart(value), /week/);
});

test("discussions are brand-scoped, retained for new teammates, and idempotent on retry", async () => {
  const f = fixture();
  try {
    const input = create(),
      { id } = await teamAction(f.db, author, input, 1000);
    assert.equal((await teamAction(f.db, author, input, 1001)).id, id);
    assert.equal((await list(f.db, peer)).entries.length, 1);
    assert.equal((await list(f.db, outsider)).entries.length, 0);
    await assert.rejects(teamDetail(f.db, outsider, id), /access/);
    await assert.rejects(
      teamAction(f.db, outsider, {
        action: "reply",
        id,
        body: "No",
        clientKey: crypto.randomUUID(),
      }),
      /access/,
    );
    await assert.rejects(
      teamAction(
        f.db,
        { ...author, workspaceId: "other" },
        { action: "read", id },
      ),
      /not found/,
    );
    f.sql
      .prepare("INSERT INTO hub_brand_access VALUES(?,?,?)")
      .run("w", "outsider", "b");
    assert.equal((await teamDetail(f.db, outsider, id)).entry.body, input.body);
    assert.equal(
      f.sql.prepare("SELECT count(*) n FROM hub_team_entries").get().n,
      1,
    );
  } finally {
    f.sql.close();
  }
});

test("report drafts remain private even to owners; publication preserves only shared versions", async () => {
  const f = fixture();
  try {
    const { id } = await teamAction(
      f.db,
      author,
      create({
        kind: "report",
        weekStart: "2026-11-22",
        body: "Private scratch note",
      }),
      1000,
    );
    assert.equal((await list(f.db, owner, "kind=report")).entries.length, 0);
    await assert.rejects(teamDetail(f.db, owner, id), /not found/);
    await assert.rejects(
      teamAction(f.db, author, {
        action: "reply",
        id,
        body: "test",
        clientKey: crypto.randomUUID(),
      }),
      /Share/,
    );
    await teamAction(
      f.db,
      author,
      {
        action: "save",
        id,
        version: 1,
        title: "Week one",
        body: "Shared outcomes",
        requests: "Need launch assets",
        publish: true,
      },
      2000,
    );
    const d = await teamDetail(f.db, owner, id);
    assert.equal(d.entry.status, "published");
    assert.equal(d.versions.length, 1);
    assert.equal(d.versions[0].snapshot.body, "Shared outcomes");
    assert.ok(!JSON.stringify(d).includes("Private scratch"));
    await teamAction(
      f.db,
      author,
      {
        action: "save",
        id,
        version: 2,
        title: "Week one revised",
        body: "Updated outcomes",
        publish: false,
      },
      3000,
    );
    const updated = await teamDetail(f.db, peer, id);
    assert.equal(updated.entry.status, "published");
    assert.equal(updated.versions.length, 2);
    assert.equal(updated.versions[1].snapshot.body, "Shared outcomes");
    await assert.rejects(
      teamAction(
        f.db,
        author,
        create({ kind: "report", weekStart: "2026-11-16" }),
      ),
      /already exists/,
    );
    assert.equal(
      (await list(f.db, peer, "kind=report&month=2026-11&q=outcomes")).entries
        .length,
      1,
    );
    assert.equal(
      (await list(f.db, peer, "kind=report&month=2026-10")).entries.length,
      0,
    );
  } finally {
    f.sql.close();
  }
});

test("only authors edit reports; stale writes and unauthorized resolution fail", async () => {
  const f = fixture();
  try {
    const { id } = await teamAction(f.db, author, create(), 1000);
    await assert.rejects(
      teamAction(f.db, peer, {
        action: "save",
        id,
        version: 1,
        title: "Hijack",
        body: "Changed",
      }),
      /Only the author/,
    );
    await assert.rejects(
      teamAction(f.db, peer, { action: "resolve", id, version: 1 }),
      /Only the author/,
    );
    await teamAction(f.db, owner, { action: "resolve", id, version: 1 }, 2000);
    assert.equal((await teamDetail(f.db, author, id)).entry.status, "resolved");
    await assert.rejects(
      teamAction(f.db, author, {
        action: "save",
        id,
        version: 1,
        title: "Old",
        body: "Overwrite",
      }),
      /changed/,
    );
    await teamAction(f.db, author, { action: "reopen", id, version: 2 }, 3000);
    assert.equal((await teamDetail(f.db, peer, id)).entry.status, "open");
    const report = await teamAction(
      f.db,
      author,
      create({ kind: "report", weekStart: "2026-11-22", publish: true }),
      4000,
    );
    await assert.rejects(
      teamAction(f.db, owner, {
        action: "save",
        id: report.id,
        version: 1,
        title: "Owner overwrite",
        body: "No",
      }),
      /Only the author/,
    );
  } finally {
    f.sql.close();
  }
});

test("thread replies are durable and idempotent, preserve content version and produce unread updates", async () => {
  const f = fixture();
  try {
    const { id } = await teamAction(f.db, author, create(), 1000);
    assert.equal((await list(f.db, peer, "unread=true")).entries.length, 1);
    await teamAction(f.db, peer, { action: "read", id, seenAt: 1000 }, 1100);
    assert.equal((await list(f.db, peer, "unread=true")).entries.length, 0);
    const input = {
      action: "reply",
      id,
      body: "Use the enterprise audience.",
      clientKey: crypto.randomUUID(),
    };
    await teamAction(f.db, author, input, 2000);
    await teamAction(f.db, author, input, 2001);
    let d = await teamDetail(f.db, peer, id);
    assert.equal(d.replies.length, 1);
    assert.equal(d.entry.version, 1);
    assert.equal((await list(f.db, peer, "unread=true")).entries.length, 1);
    await teamAction(f.db, peer, { action: "read", id, seenAt: 1000 }, 2100);
    assert.equal((await list(f.db, peer, "unread=true")).entries.length, 1);
    await teamAction(f.db, peer, { action: "read", id, seenAt: 2000 }, 2200);
    assert.equal((await list(f.db, peer, "unread=true")).entries.length, 0);
    d = await teamDetail(f.db, author, id);
    assert.deepEqual(
      d.readers.map((r) => r.name),
      ["peer"],
    );
    const other = await teamAction(f.db, author, create(), 3000);
    await assert.rejects(
      teamAction(f.db, author, { ...input, id: other.id }),
      /already in use/,
    );
    await assert.rejects(
      teamAction(f.db, author, {
        ...input,
        clientKey: crypto.randomUUID(),
        body: " ",
      }),
      /required/,
    );
  } finally {
    f.sql.close();
  }
});

test("post and ad references enforce same brand and workspace without modifying the work", async () => {
  const f = fixture();
  try {
    const post = await savePost(
      f.db,
      author,
      {
        brandId: "b",
        text: "Launch post",
        action: "draft",
        clientKey: crypto.randomUUID(),
        timeZone: "UTC",
      },
      false,
    );
    const other = await savePost(
      f.db,
      owner,
      {
        brandId: "private",
        text: "Secret post",
        action: "draft",
        clientKey: crypto.randomUUID(),
        timeZone: "UTC",
      },
      false,
    );
    const { id } = await teamAction(
      f.db,
      author,
      create({ referenceKind: "post", referenceId: post.id }),
    );
    assert.equal(
      (await teamDetail(f.db, peer, id)).linked.title,
      "Launch post",
    );
    await assert.rejects(
      teamAction(
        f.db,
        author,
        create({ referenceKind: "post", referenceId: other.id }),
      ),
      /not available/,
    );
    assert.equal((await teamReferences(f.db, peer, "b")).posts.length, 1);
    await assert.rejects(teamReferences(f.db, peer, "private"), /access/);
    assert.equal(
      f.sql.prepare("SELECT version FROM hub_posts WHERE id=?").get(post.id)
        .version,
      1,
    );
    f.sql
      .prepare(
        "INSERT INTO hub_ad_builds VALUES('ad','w','b',NULL,'Launch build','LinkedIn','USD','{}','draft',1,'ad-key','hash','author','author',0,0)",
      )
      .run();
    const ad = await teamAction(
      f.db,
      author,
      create({ referenceKind: "ad", referenceId: "ad" }),
    );
    assert.equal(
      (await teamDetail(f.db, peer, ad.id)).linked.title,
      "Launch build",
    );
  } finally {
    f.sql.close();
  }
});

test("filters, input bounds and pagination do not expose private drafts or unauthorized brands", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 42; i++)
      await teamAction(
        f.db,
        author,
        create({ title: "Question " + i }),
        1000 + i,
      );
    assert.equal((await list(f.db, peer)).entries.length, 40);
    assert.equal((await list(f.db, peer)).hasMore, true);
    assert.equal((await list(f.db, peer, "offset=40")).entries.length, 2);
    assert.equal((await list(f.db, peer, "mine=true")).entries.length, 0);
    await assert.rejects(list(f.db, peer, "brand=private"), /access/);
    for (const q of [
      "offset=-1",
      "offset=1.5",
      "kind=anything",
      "month=2026-13",
    ])
      await assert.rejects(list(f.db, peer, q));
    await assert.rejects(
      teamAction(f.db, author, create({ body: "x".repeat(8001) })),
      /8,000/,
    );
    await assert.rejects(teamAction(f.db, author, null), /Invalid/);
    await assert.rejects(
      teamAction(f.db, author, create({ category: "invalid" })),
      /category/,
    );
  } finally {
    f.sql.close();
  }
});

test("creation and shared history roll back if the audit write fails", async () => {
  const f = fixture();
  try {
    f.sql.exec(
      "CREATE TRIGGER fail_team_audit BEFORE INSERT ON hub_audit WHEN NEW.action='team.created' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
    );
    await assert.rejects(
      teamAction(
        f.db,
        author,
        create({ kind: "report", weekStart: "2026-11-22", publish: true }),
      ),
      /audit unavailable/,
    );
    assert.equal(
      f.sql.prepare("SELECT COUNT(*) n FROM hub_team_entries").get().n,
      0,
    );
    assert.equal(
      f.sql.prepare("SELECT COUNT(*) n FROM hub_team_versions").get().n,
      0,
    );
  } finally {
    f.sql.close();
  }
});

test("concurrent report edits cannot write a history revision without the matching content update", async () => {
  const f = fixture();
  try {
    const { id } = await teamAction(
      f.db,
      author,
      create({ kind: "report", weekStart: "2026-11-22", publish: true }),
      1000,
    );
    const db = {
      ...f.db,
      async batch(statements) {
        f.sql
          .prepare("UPDATE hub_team_entries SET version=version+1 WHERE id=?")
          .run(id);
        return f.db.batch(statements);
      },
    };
    await assert.rejects(
      teamAction(
        db,
        author,
        {
          action: "save",
          id,
          version: 1,
          title: "Stale update",
          body: "Must not replace the report",
          publish: true,
        },
        2000,
      ),
      /changed/,
    );
    assert.equal(
      (await teamDetail(f.db, peer, id)).entry.title,
      "Can we clarify this launch?",
    );
    assert.equal((await teamDetail(f.db, peer, id)).versions.length, 1);
  } finally {
    f.sql.close();
  }
});

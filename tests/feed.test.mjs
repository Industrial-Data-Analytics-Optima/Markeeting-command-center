import test from "node:test";
import assert from "node:assert/strict";
import { identityFixture } from "./auth-fixture.mjs";
import {
  feedSource,
  saveFeedItem,
  engage,
  resolveInteraction,
} from "../server/publishing/feed.ts";
import { savePost } from "../server/publishing/posts.ts";
import {
  linkedinClient,
  DeliveryError,
} from "../server/publishing/linkedin.ts";
const a = {
  id: "u",
  name: "Admin",
  email: "u@example.test",
  workspaceId: "w",
  workspaceName: "Workspace",
  role: "admin",
  sessionHash: "",
};
async function fixture() {
  const f = identityFixture();
  f.sql.exec(
    "INSERT INTO hub_workspaces VALUES('w','Workspace'); INSERT INTO hub_users VALUES('u','u@example.test','Admin','unused'); INSERT INTO hub_members VALUES('w','u','admin',1); INSERT INTO hub_brands VALUES('a','w','IDAO'),('b','w','Optimaviz'),('private','w','Restricted'); INSERT INTO hub_brand_access VALUES('w','u','a'),('w','u','b'); INSERT INTO social_connections(id,workspace_id,provider,label,sealed_tokens,created_at,granted_scopes) VALUES('c','w','linkedin','Account','unused',1,'[\"w_organization_social_feed\"]'); INSERT INTO hub_linkedin_pages VALUES('pa','w','c','urn:li:organization:1','IDAO page','a',1,1),('pb','w','c','urn:li:organization:2','Optimaviz page','b',1,1),('hidden','w','c','urn:li:organization:3','Private page',NULL,0,1),('restricted','w','c','urn:li:organization:4','Restricted page','private',1,1);",
  );
  const source = await savePost(
    f.db,
    a,
    {
      brandId: "a",
      pageId: "pa",
      text: "Original IDAO post",
      action: "draft",
      clientKey: crypto.randomUUID(),
    },
    false,
  );
  f.sql
    .prepare(
      "UPDATE hub_posts SET status='published',provider_post_id='urn:li:share:123',published_at=1 WHERE id=?",
    )
    .run(source.id);
  return { ...f, source };
}
const input = (source, extra = {}) => ({
  postId: source.id,
  pageId: "pb",
  action: "like",
  clientKey: crypto.randomUUID(),
  ...extra,
});
test("feed actions require access to source and acting brand and reject unselected pages before calling a provider", async () => {
  const { db, sql, source } = await fixture();
  try {
    let calls = 0;
    const send = async () => {
      calls++;
      return null;
    };
    await assert.rejects(
      engage(db, a, input(source, { pageId: "hidden" }), send),
      /explicitly assigned/,
    );
    await assert.rejects(
      engage(db, a, input(source, { pageId: "restricted" }), send),
      /access/,
    );
    sql.exec("UPDATE social_connections SET granted_scopes='[]'");
    await assert.rejects(
      engage(db, a, input(source), send),
      /not been granted/,
    );
    assert.equal(calls, 0);
    sql.exec("UPDATE hub_linkedin_pages SET enabled=0 WHERE id='pa'");
    await assert.rejects(feedSource(db, a, source.id), /not found/);
  } finally {
    sql.close();
  }
});
test("confirmed reactions are idempotent and an ambiguous response blocks automatic repetition", async () => {
  const { db, sql, source } = await fixture();
  try {
    let calls = 0;
    const payload = input(source),
      send = async () => {
        calls++;
        return null;
      };
    assert.equal((await engage(db, a, payload, send)).status, "completed");
    assert.equal((await engage(db, a, payload, send)).status, "completed");
    assert.equal(calls, 1);
    const remove = input(source, { action: "unlike" });
    assert.equal(
      (
        await engage(db, a, remove, async () => {
          throw new DeliveryError("uncertain", "Unknown outcome");
        })
      ).status,
      "uncertain",
    );
    await assert.rejects(
      engage(db, a, input(source), send),
      /pending or needs checking/,
    );
    assert.equal(calls, 1);
  } finally {
    sql.close();
  }
});
test("identical comments are deduplicated across browser request keys and use the acting page identity", async () => {
  const { db, sql, source } = await fixture();
  try {
    let calls = 0;
    const send = async (kind, organization, post, text) => {
      calls++;
      assert.equal(kind, "comment");
      assert.equal(organization, "urn:li:organization:2");
      assert.equal(post, "urn:li:share:123");
      assert.equal(text, "Well said");
      return "456";
    };
    assert.equal(
      (
        await engage(
          db,
          a,
          input(source, { action: "comment", text: "Well said" }),
          send,
        )
      ).status,
      "completed",
    );
    assert.equal(
      (
        await engage(
          db,
          a,
          input(source, { action: "comment", text: "Well said" }),
          send,
        )
      ).status,
      "completed",
    );
    assert.equal(calls, 1);
  } finally {
    sql.close();
  }
});
test("internal notes and personal bookmarks persist without provider access", async () => {
  const { db, sql, source } = await fixture();
  try {
    await saveFeedItem(db, a, {
      action: "bookmark",
      postId: source.id,
      saved: true,
    });
    await saveFeedItem(db, a, {
      action: "bookmark",
      postId: source.id,
      saved: true,
    });
    assert.equal(
      sql.prepare("SELECT COUNT(*) n FROM hub_feed_saved").get().n,
      1,
    );
    await saveFeedItem(db, a, {
      action: "note",
      postId: source.id,
      text: "Ask Optimaviz to repost",
    });
    assert.equal(
      sql.prepare("SELECT body FROM hub_feed_notes").get().body,
      "Ask Optimaviz to repost",
    );
    await saveFeedItem(db, a, {
      action: "bookmark",
      postId: source.id,
      saved: false,
    });
    assert.equal(
      sql.prepare("SELECT COUNT(*) n FROM hub_feed_saved").get().n,
      0,
    );
  } finally {
    sql.close();
  }
});
test("native repost drafts preserve source references through edits and invalidate approval on source changes", async () => {
  const { db, sql, source } = await fixture();
  try {
    const payload = {
        brandId: "b",
        pageId: "pb",
        text: "Optimaviz perspective",
        action: "draft",
        resharePostId: source.id,
        clientKey: crypto.randomUUID(),
      },
      draft = await savePost(db, a, payload, false);
    assert.equal(
      sql
        .prepare("SELECT reshare_post_id FROM hub_posts WHERE id=?")
        .get(draft.id).reshare_post_id,
      source.id,
    );
    await savePost(
      db,
      a,
      {
        ...payload,
        id: draft.id,
        version: 1,
        resharePostId: undefined,
        text: "Updated perspective",
      },
      false,
    );
    assert.equal(
      sql
        .prepare("SELECT reshare_post_id FROM hub_posts WHERE id=?")
        .get(draft.id).reshare_post_id,
      source.id,
    );
    sql
      .prepare("UPDATE hub_posts SET editorial_status='approved' WHERE id=?")
      .run(draft.id);
    await savePost(
      db,
      a,
      { ...payload, id: draft.id, version: 2, resharePostId: null },
      false,
    );
    assert.equal(
      sql
        .prepare("SELECT editorial_status FROM hub_posts WHERE id=?")
        .get(draft.id).editorial_status,
      "changes_requested",
    );
  } finally {
    sql.close();
  }
});
test("LinkedIn interaction and repost payloads use the organization actor and native API shapes", async () => {
  const calls = [];
  const c = linkedinClient("token", "202609", async (url, init) => {
    calls.push({ url, init });
    return new Response(null, {
      status: 201,
      headers: {
        "x-restli-id": url.endsWith("/posts") ? "urn:li:share:456" : "456",
      },
    });
  });
  await c.interact("like", "urn:li:organization:2", "urn:li:share:123");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    root: "urn:li:share:123",
    reactionType: "LIKE",
  });
  assert.ok(calls[0].url.includes("actor=urn%3Ali%3Aorganization%3A2"));
  await c.interact(
    "comment",
    "urn:li:organization:2",
    "urn:li:share:123",
    "Hello",
  );
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    actor: "urn:li:organization:2",
    object: "urn:li:share:123",
    message: { text: "Hello" },
  });
  await c.publish(
    "urn:li:organization:2",
    "Perspective",
    undefined,
    "",
    "urn:li:share:123",
  );
  assert.deepEqual(JSON.parse(calls[2].init.body).reshareContext, {
    parent: "urn:li:share:123",
  });
});

test("only a super admin can record a verified uncertain outcome; an absent result permits a safe manual retry", async () => {
  const { db, sql, source } = await fixture();
  try {
    sql.exec(
      "INSERT INTO hub_users VALUES('owner','owner@example.test','Owner','unused'); INSERT INTO hub_members VALUES('w','owner','super_admin',1);",
    );
    const payload = input(source),
      result = await engage(db, a, payload, async () => {
        throw new DeliveryError("uncertain", "Unknown outcome");
      });
    assert.equal(result.status, "uncertain");
    const resolution = {
      id: result.id,
      applied: false,
      note: "Checked the original post and no reaction is present.",
    };
    await assert.rejects(resolveInteraction(db, a, resolution), /super admin/i);
    await resolveInteraction(
      db,
      { ...a, id: "owner", role: "super_admin" },
      resolution,
    );
    assert.equal(
      sql
        .prepare("SELECT status FROM hub_feed_actions WHERE id=?")
        .get(result.id).status,
      "failed",
    );
    assert.equal(
      sql
        .prepare(
          "SELECT COUNT(*) n FROM hub_audit WHERE action='feed.outcome_verified'",
        )
        .get().n,
      1,
    );
    assert.equal(
      (await engage(db, a, payload, async () => null)).status,
      "completed",
    );
    await assert.rejects(
      resolveInteraction(
        db,
        { ...a, id: "owner", role: "super_admin" },
        resolution,
      ),
      /no longer awaiting/,
    );
  } finally {
    sql.close();
  }
});

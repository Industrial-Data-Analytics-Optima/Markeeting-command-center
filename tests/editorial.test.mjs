import test from "node:test";
import assert from "node:assert/strict";
import { identityFixture } from "./auth-fixture.mjs";
import { savePost } from "../server/publishing/posts.ts";
import {
  editorialAction,
  reviewers,
  editorialPost,
  plannedTime,
} from "../server/publishing/editorial.ts";
import { deliverDue } from "../server/publishing/queue.ts";
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
  reviewer = actor("reviewer"),
  owner = actor("owner", "super_admin"),
  outsider = actor("outsider");
async function fixture() {
  const f = identityFixture();
  f.sql.exec(
    "INSERT INTO hub_workspaces VALUES('w','Workspace'); INSERT INTO hub_brands VALUES('b','w','Brand'); INSERT INTO social_connections(id,workspace_id,provider,label,sealed_tokens,created_at) VALUES('c','w','linkedin','Owner','encrypted',0); INSERT INTO hub_linkedin_pages(id,workspace_id,connection_id,organization_urn,name,brand_id,enabled,discovered_at) VALUES('page','w','c','urn:li:organization:123','Page','b',1,0);",
  );
  for (const a of [author, reviewer, owner, outsider]) {
    f.sql
      .prepare("INSERT INTO hub_users VALUES(?,?,?,?)")
      .run(a.id, a.email, a.name, "unused");
    f.sql
      .prepare("INSERT INTO hub_members VALUES(?,?,?,1)")
      .run("w", a.id, a.role);
  }
  for (const a of [author, reviewer])
    f.sql
      .prepare("INSERT INTO hub_brand_access VALUES(?,?,?)")
      .run("w", a.id, "b");
  f.sql
    .prepare("INSERT INTO hub_scheduler VALUES('publishing',?)")
    .run(Date.now());
  const input = {
    brandId: "b",
    pageId: "page",
    text: "Draft to review",
    action: "draft",
    clientKey: crypto.randomUUID(),
    timeZone: "UTC",
  };
  const { id } = await savePost(f.db, author, input, false);
  return {
    ...f,
    id,
    input,
    get: () => f.sql.prepare("SELECT * FROM hub_posts WHERE id=?").get(id),
  };
}
test("planning a draft never queues delivery and needs no provider setup", async () => {
  const f = await fixture();
  try {
    const planned = new Date(Date.now() + 86400000).toISOString();
    await editorialAction(f.db, author, f.id, {
      action: "plan",
      version: 1,
      plannedAt: planned,
    });
    assert.equal(f.get().status, "draft");
    assert.equal(f.get().scheduled_at, null);
    assert.equal(f.get().planned_at, Date.parse(planned));
    let calls = 0;
    await deliverDue(f.db, {
      prepare: async () => null,
      publish: async () => {
        calls++;
        return "urn:li:share:1";
      },
    });
    assert.equal(calls, 0);
    assert.throws(() => plannedTime("not-a-date"), /valid planning date/);
  } finally {
    f.sql.close();
  }
});
test("reviewers are active brand teammates; self-approval and outsiders are rejected", async () => {
  const f = await fixture();
  try {
    const available = await reviewers(
      f.db,
      author,
      await editorialPost(f.db, author, f.id),
    );
    assert.deepEqual(available.map((a) => a.id).sort(), ["owner", "reviewer"]);
    await assert.rejects(
      editorialAction(f.db, author, f.id, {
        action: "submit",
        reviewMode: "approval",
        version: 1,
        reviewerId: "author",
      }),
      /other than the author/,
    );
    await assert.rejects(
      editorialAction(f.db, author, f.id, {
        action: "submit",
        reviewMode: "approval",
        version: 1,
        reviewerId: "outsider",
      }),
      /active access/,
    );
    await editorialAction(f.db, author, f.id, {
      action: "submit",
      reviewMode: "approval",
      version: 1,
      reviewerId: "reviewer",
    });
    await assert.rejects(
      editorialAction(f.db, author, f.id, { action: "approve", version: 2 }),
      /own submission/,
    );
    await assert.rejects(
      editorialAction(f.db, outsider, f.id, {
        action: "comment",
        note: "Not allowed",
      }),
      /access/,
    );
    await editorialAction(f.db, reviewer, f.id, {
      action: "approve",
      version: 2,
    });
    assert.equal(f.get().editorial_status, "approved");
    assert.equal(f.get().status, "draft");
  } finally {
    f.sql.close();
  }
});
test("changes require feedback; revised content invalidates approval and stale decisions fail", async () => {
  const f = await fixture();
  try {
    await editorialAction(f.db, author, f.id, {
      action: "submit",
      reviewMode: "approval",
      version: 1,
      reviewerId: "reviewer",
    });
    await assert.rejects(
      editorialAction(f.db, reviewer, f.id, {
        action: "request_changes",
        version: 2,
      }),
      /Explain/,
    );
    await editorialAction(f.db, reviewer, f.id, {
      action: "request_changes",
      version: 2,
      note: "Clarify the headline.",
    });
    assert.equal(f.get().review_note, "Clarify the headline.");
    await savePost(
      f.db,
      author,
      { ...f.input, id: f.id, version: 3, text: "Clearer headline" },
      false,
    );
    assert.equal(f.get().editorial_status, "changes_requested");
    await editorialAction(f.db, author, f.id, {
      action: "submit",
      reviewMode: "approval",
      version: 4,
      reviewerId: "reviewer",
    });
    await editorialAction(f.db, reviewer, f.id, {
      action: "approve",
      version: 5,
    });
    await savePost(
      f.db,
      author,
      { ...f.input, id: f.id, version: 6, text: "Another change" },
      false,
    );
    assert.equal(f.get().editorial_status, "changes_requested");
    assert.equal(f.get().reviewed_by, null);
    await assert.rejects(
      editorialAction(f.db, reviewer, f.id, { action: "approve", version: 5 }),
      /changed/,
    );
  } finally {
    f.sql.close();
  }
});
test("reviewed drafts cannot bypass approval through publish or a queue record", async () => {
  const f = await fixture();
  try {
    await editorialAction(f.db, author, f.id, {
      action: "submit",
      reviewMode: "approval",
      version: 1,
      reviewerId: "reviewer",
    });
    await assert.rejects(
      savePost(
        f.db,
        author,
        { ...f.input, id: f.id, version: 2, action: "publish" },
        true,
      ),
      /needs approval/,
    );
    f.sql
      .prepare(
        "UPDATE hub_posts SET status='scheduled',scheduled_at=?,next_attempt_at=? WHERE id=?",
      )
      .run(Date.now() - 1, Date.now() - 1, f.id);
    let calls = 0;
    await deliverDue(f.db, {
      prepare: async () => {
        calls++;
        return null;
      },
      publish: async () => {
        calls++;
        return "urn:li:share:1";
      },
    });
    assert.equal(calls, 0);
    assert.equal(f.get().error_code, "REVIEW_REQUIRED");
  } finally {
    f.sql.close();
  }
});
test("unchanged approved content can be queued; publication changes need another approval", async () => {
  const f = await fixture();
  try {
    await editorialAction(f.db, author, f.id, {
      action: "submit",
      reviewMode: "approval",
      version: 1,
      reviewerId: "reviewer",
    });
    await editorialAction(f.db, reviewer, f.id, {
      action: "approve",
      version: 2,
    });
    await assert.rejects(
      savePost(
        f.db,
        author,
        {
          ...f.input,
          id: f.id,
          version: 3,
          text: "Different copy",
          action: "publish",
        },
        true,
      ),
      /needs approval/,
    );
    await savePost(
      f.db,
      author,
      { ...f.input, id: f.id, version: 3, action: "publish" },
      true,
    );
    assert.equal(f.get().status, "scheduled");
    assert.equal(f.get().editorial_status, "approved");
  } finally {
    f.sql.close();
  }
});
test("discussion is durable, does not alter the approved content version and rejects empty comments", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      editorialAction(f.db, author, f.id, { action: "comment", note: " " }),
      /Write a comment/,
    );
    await editorialAction(f.db, reviewer, f.id, {
      action: "comment",
      note: "Helpful context.",
    });
    assert.equal(f.get().version, 1);
    assert.equal(
      f.sql.prepare("SELECT body FROM hub_editorial_comments").get().body,
      "Helpful context.",
    );
    f.sql
      .prepare("UPDATE hub_members SET active=0 WHERE user_id=?")
      .run("reviewer");
    await assert.rejects(
      editorialAction(f.db, author, f.id, {
        action: "submit",
        reviewMode: "approval",
        version: 1,
        reviewerId: "reviewer",
      }),
      /active access/,
    );
  } finally {
    f.sql.close();
  }
});

test("routine posts and teammate feedback never require super-admin sign-off or block delivery", async () => {
  for (const feedback of [false, true]) {
    const f = await fixture();
    try {
      let version = 1;
      if (feedback) {
        await editorialAction(f.db, author, f.id, {
          action: "submit",
          version,
          reviewerId: "reviewer",
          note: "Please check this launch wording.",
        });
        version++;
        assert.equal(f.get().review_mode, "feedback");
        await editorialAction(f.db, reviewer, f.id, {
          action: "request_changes",
          version,
          note: "Consider a clearer headline.",
        });
        version++;
      }
      await savePost(
        f.db,
        author,
        {
          ...f.input,
          id: f.id,
          version,
          text: "Routine content ready to share",
          action: "publish",
        },
        true,
      );
      let published = 0;
      await deliverDue(f.db, {
        prepare: async () => null,
        publish: async () => {
          published++;
          return "urn:li:share:ready";
        },
      });
      assert.equal(published, 1);
      assert.equal(f.get().status, "published");
    } finally {
      f.sql.close();
    }
  }
});

test("admins can hand an approval to another brand teammate and retain the publishing hold", async () => {
  const f = await fixture(),
    peer = actor("peer");
  try {
    f.sql.exec(
      "INSERT INTO hub_users VALUES('peer','peer@example.test','Peer','unused'); INSERT INTO hub_members VALUES('w','peer','admin',1); INSERT INTO hub_brand_access VALUES('w','peer','b');",
    );
    await editorialAction(f.db, author, f.id, {
      action: "submit",
      version: 1,
      reviewerId: "reviewer",
      reviewMode: "approval",
    });
    await assert.rejects(
      editorialAction(f.db, peer, f.id, { action: "withdraw", version: 2 }),
      /participant/,
    );
    await editorialAction(f.db, reviewer, f.id, {
      action: "reassign",
      version: 2,
      reviewerId: "peer",
    });
    assert.equal(f.get().reviewer_id, "peer");
    assert.equal(f.get().review_mode, "approval");
    assert.equal(f.get().submitted_by, "author");
    await assert.rejects(
      editorialAction(f.db, reviewer, f.id, { action: "approve", version: 3 }),
      /assigned reviewer/,
    );
    await assert.rejects(
      savePost(
        f.db,
        author,
        {
          ...f.input,
          id: f.id,
          version: 3,
          action: "publish",
          reviewMode: "feedback",
        },
        true,
      ),
      /needs approval/,
    );
    await editorialAction(f.db, peer, f.id, { action: "approve", version: 3 });
    await savePost(
      f.db,
      author,
      { ...f.input, id: f.id, version: 4, action: "publish" },
      true,
    );
    assert.equal(f.get().status, "scheduled");
  } finally {
    f.sql.close();
  }
});

test("participants can deliberately release a hold with version protection and a retained activity trail", async () => {
  const f = await fixture();
  try {
    await editorialAction(f.db, author, f.id, {
      action: "submit",
      version: 1,
      reviewerId: "reviewer",
      reviewMode: "approval",
    });
    await assert.rejects(
      editorialAction(f.db, author, f.id, { action: "withdraw", version: 1 }),
      /changed/,
    );
    await editorialAction(f.db, author, f.id, {
      action: "withdraw",
      version: 2,
      note: "This is routine content.",
    });
    assert.equal(f.get().editorial_status, "none");
    assert.equal(f.get().review_mode, "feedback");
    assert.equal(f.get().reviewer_id, null);
    assert.match(
      f.sql
        .prepare("SELECT message FROM hub_post_events WHERE message LIKE ?")
        .get("%cancelled the approval hold%").message,
      /author cancelled/,
    );
    await savePost(
      f.db,
      author,
      { ...f.input, id: f.id, version: 3, action: "publish" },
      true,
    );
    assert.equal(f.get().status, "scheduled");
  } finally {
    f.sql.close();
  }
});

test("rejection requires a reason, keeps the draft and distinguishes rejection from a small revision", async () => {
  const f = await fixture();
  try {
    await editorialAction(f.db, author, f.id, {
      action: "submit",
      version: 1,
      reviewerId: "reviewer",
      reviewMode: "approval",
    });
    await assert.rejects(
      editorialAction(f.db, reviewer, f.id, { action: "reject", version: 2 }),
      /Explain/,
    );
    await editorialAction(f.db, reviewer, f.id, {
      action: "reject",
      version: 2,
      note: "The product claim is unsupported. Replace it with verified wording.",
    });
    assert.equal(f.get().review_decision, "rejected");
    assert.equal(f.get().editorial_status, "changes_requested");
    assert.equal(f.get().status, "draft");
    assert.match(
      f.sql
        .prepare("SELECT message FROM hub_post_events WHERE message LIKE ?")
        .get("%rejected this version%").message,
      /unsupported/,
    );
    await assert.rejects(
      savePost(
        f.db,
        author,
        { ...f.input, id: f.id, version: 3, action: "publish" },
        true,
      ),
      /needs approval/,
    );
    await savePost(f.db, author, { ...f.input, id: f.id, version: 3 }, false);
    assert.equal(f.get().review_decision, "rejected");
    await savePost(
      f.db,
      author,
      { ...f.input, id: f.id, version: 4, text: "Verified wording" },
      false,
    );
    assert.equal(f.get().review_decision, null);
    await editorialAction(f.db, author, f.id, {
      action: "submit",
      version: 5,
      reviewerId: "reviewer",
    });
    assert.equal(f.get().review_decision, null);
  } finally {
    f.sql.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { identityFixture } from "./auth-fixture.mjs";
import {
  savePost,
  cancelPost,
  validatePost,
} from "../server/publishing/posts.ts";
import { deliverDue } from "../server/publishing/queue.ts";
import {
  DeliveryError,
  linkedinClient,
} from "../server/publishing/linkedin.ts";
import { inspectImage } from "../server/publishing/media.ts";
const actor = {
  id: "u",
  workspaceId: "w",
  workspaceName: "Workspace",
  name: "Admin",
  email: "admin@example.test",
  role: "admin",
  sessionHash: "",
};
function fixture() {
  const f = identityFixture();
  f.sql.exec(
    "INSERT INTO hub_workspaces VALUES('w','Workspace'),('other','Other'); INSERT INTO hub_users VALUES('u','admin@example.test','Admin','unused'); INSERT INTO hub_members VALUES('w','u','admin',1); INSERT INTO hub_brands VALUES('b','w','Brand'),('private','w','Private'),('foreign','other','Foreign'); INSERT INTO hub_brand_access VALUES('w','u','b'); INSERT INTO social_connections(id,workspace_id,provider,label,sealed_tokens,created_at) VALUES('c','w','linkedin','Owner','encrypted',0); INSERT INTO hub_linkedin_pages(id,workspace_id,connection_id,organization_urn,name,brand_id,enabled,discovered_at) VALUES('page','w','c','urn:li:organization:123','Page','b',1,0),('hidden','w','c','urn:li:organization:456','Private page','private',1,0),('unselected','w','c','urn:li:organization:789','Unselected page',NULL,0,0),('switched-off','w','c','urn:li:organization:101','Switched off','b',0,0);",
  );
  f.sql
    .prepare("INSERT INTO hub_scheduler VALUES('publishing',?)")
    .run(Date.now());
  return f;
}
const input = (extra = {}) => ({
  brandId: "b",
  pageId: "page",
  text: "A test post",
  action: "publish",
  timeZone: "Africa/Johannesburg",
  clientKey: crypto.randomUUID(),
  ...extra,
});
test("drafts persist without live setup; publishing checks brand/page/media and scheduler", async () => {
  const { db, sql } = fixture();
  try {
    await savePost(db, actor, input({ action: "draft", pageId: "" }), false);
    await assert.rejects(savePost(db, actor, input(), false), /not active/);
    await assert.rejects(
      savePost(db, actor, input({ pageId: "hidden" }), true),
      /not assigned/,
    );
    await assert.rejects(
      savePost(db, actor, input({ pageId: "unselected" }), true),
      /not assigned/,
    );
    await assert.rejects(
      savePost(db, actor, input({ pageId: "switched-off" }), true),
      /not assigned/,
    );
    await assert.rejects(
      savePost(db, actor, input({ brandId: "foreign" }), true),
      /not found/,
    );
    await assert.rejects(
      savePost(db, actor, input({ mediaId: "foreign-image" }), true),
      /media does not belong/,
    );
    sql.exec("UPDATE hub_scheduler SET heartbeat_at=0");
    await assert.rejects(savePost(db, actor, input(), true), /not active/);
  } finally {
    sql.close();
  }
});
test("idempotent create and optimistic edits prevent duplicate or stale saves", async () => {
  const { db, sql } = fixture();
  try {
    const payload = input(),
      first = await savePost(db, actor, payload, true);
    assert.equal((await savePost(db, actor, payload, true)).id, first.id);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM hub_posts").get().n, 1);
    await assert.rejects(
      savePost(db, actor, { ...payload, text: "Changed" }, true),
      /previous save/,
    );
    await savePost(
      db,
      actor,
      { ...payload, id: first.id, version: 1, text: "Updated" },
      true,
    );
    await assert.rejects(
      savePost(db, actor, { ...payload, id: first.id, version: 1 }, true),
      /changed elsewhere/,
    );
  } finally {
    sql.close();
  }
});
test("two workers can claim a post only once", async () => {
  const { db, sql } = fixture();
  try {
    await savePost(db, actor, input(), true);
    let sends = 0;
    const adapter = {
      prepare: async () => null,
      publish: async () => {
        sends++;
        return "urn:li:share:789";
      },
    };
    await Promise.all([deliverDue(db, adapter), deliverDue(db, adapter)]);
    assert.equal(sends, 1);
    assert.equal(
      sql.prepare("SELECT status FROM hub_posts").get().status,
      "published",
    );
    await deliverDue(db, adapter);
    assert.equal(sends, 1);
  } finally {
    sql.close();
  }
});
test("ambiguous submissions are never retried or editable", async () => {
  const { db, sql } = fixture();
  try {
    const p = await savePost(db, actor, input(), true);
    let sends = 0;
    const adapter = {
      prepare: async () => null,
      publish: async () => {
        sends++;
        throw new DeliveryError("uncertain", "Check LinkedIn");
      },
    };
    await deliverDue(db, adapter);
    await deliverDue(db, adapter, Date.now() + 3600000);
    assert.equal(sends, 1);
    const post = sql.prepare("SELECT * FROM hub_posts").get();
    assert.equal(post.status, "uncertain");
    await assert.rejects(
      savePost(db, actor, input({ id: p.id, version: post.version }), true),
      /cannot be edited/,
    );
  } finally {
    sql.close();
  }
});
test("preparation failures retry with delay while expired submission leases require review", async () => {
  const { db, sql } = fixture();
  try {
    const p = await savePost(db, actor, input(), true);
    await deliverDue(db, {
      prepare: async () => {
        throw new DeliveryError("retry", "Try later");
      },
      publish: async () => {
        throw new Error("must not send");
      },
    });
    let post = sql.prepare("SELECT * FROM hub_posts").get();
    assert.equal(post.status, "scheduled");
    assert.ok(post.next_attempt_at > Date.now());
    sql
      .prepare(
        "UPDATE hub_posts SET status='processing',stage='submitting',lease_until=0 WHERE id=?",
      )
      .run(p.id);
    await deliverDue(db, {
      prepare: async () => {
        throw new Error("must not prepare");
      },
      publish: async () => {
        throw new Error("must not send");
      },
    });
    assert.equal(
      sql.prepare("SELECT status FROM hub_posts").get().status,
      "uncertain",
    );
  } finally {
    sql.close();
  }
});
test("revoked author access blocks delivery; cancelled posts never publish", async () => {
  const { db, sql } = fixture();
  try {
    const cancelled = await savePost(db, actor, input(), true);
    await cancelPost(db, actor, cancelled.id, 1);
    const post = await savePost(db, actor, input(), true);
    sql.exec("DELETE FROM hub_brand_access");
    let sends = 0;
    await deliverDue(db, {
      prepare: async () => null,
      publish: async () => {
        sends++;
        return "urn:li:share:1";
      },
    });
    assert.equal(sends, 0);
    assert.equal(
      sql.prepare("SELECT status FROM hub_posts WHERE id=?").get(post.id)
        .status,
      "failed",
    );
    assert.equal(
      sql.prepare("SELECT status FROM hub_posts WHERE id=?").get(cancelled.id)
        .status,
      "cancelled",
    );
  } finally {
    sql.close();
  }
});
test("future posts wait and invalid dates/text are rejected", async () => {
  const { db, sql } = fixture();
  try {
    await savePost(
      db,
      actor,
      input({
        action: "schedule",
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      }),
      true,
    );
    let sends = 0;
    await deliverDue(db, {
      prepare: async () => null,
      publish: async () => {
        sends++;
        return "urn:li:share:1";
      },
    });
    assert.equal(sends, 0);
    assert.throws(
      () => validatePost(input({ action: "schedule", scheduledAt: "invalid" })),
      /Choose a time/,
    );
    assert.throws(
      () => validatePost(input({ text: "a".repeat(3001) })),
      /3,000/,
    );
    assert.throws(
      () => validatePost(input({ timeZone: "Imaginary/Zone" })),
      /time zone/,
    );
  } finally {
    sql.close();
  }
});
test("LinkedIn payload, headers and ambiguous network handling follow the adapter contract", async () => {
  let payload;
  const client = linkedinClient(
    "test-token",
    "202609",
    async (url, options) => {
      assert.equal(url, "https://api.linkedin.com/rest/posts");
      assert.equal(options.headers["Linkedin-Version"], "202609");
      assert.equal(options.redirect, "error");
      payload = JSON.parse(options.body);
      return new Response(null, {
        status: 201,
        headers: { "x-restli-id": "urn:li:share:123" },
      });
    },
  );
  assert.equal(
    await client.publish("urn:li:organization:123", "Hello"),
    "urn:li:share:123",
  );
  assert.equal(payload.author, "urn:li:organization:123");
  assert.equal(payload.lifecycleState, "PUBLISHED");
  const broken = linkedinClient("test-token", "202609", async () => {
    throw new Error("timeout");
  });
  await assert.rejects(
    broken.publish("urn:li:organization:123", "Hello"),
    (e) => e.kind === "uncertain",
  );
  const limited = linkedinClient(
    "test-token",
    "202609",
    async () =>
      new Response(null, { status: 429, headers: { "retry-after": "120" } }),
  );
  await assert.rejects(
    limited.publish("urn:li:organization:123", "Hello"),
    (e) => e.kind === "retry" && e.retryMs === 120000,
  );
});
test("media rejects disguised files and excessive dimensions", () => {
  assert.throws(
    () => inspectImage(new TextEncoder().encode("<svg/>"), "image/png"),
    /valid JPEG/,
  );
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const v = new DataView(png.buffer);
  v.setUint32(16, 1200);
  v.setUint32(20, 628);
  assert.deepEqual(inspectImage(png, "image/png"), {
    width: 1200,
    height: 628,
  });
  v.setUint32(16, 99999);
  assert.throws(() => inspectImage(png, "image/png"), /megapixels/);
});

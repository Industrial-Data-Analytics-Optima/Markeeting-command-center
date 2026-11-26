import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareOutlook,
  validOutlookUploadUrl,
} from "../server/email/outlook-uploads.ts";
import { prepareStoredOutlook } from "../server/email/preparation.ts";
import {
  queueEmail,
  retryEmail,
  cancelEmail,
} from "../server/email/delivery.ts";
import { deliverMail } from "../server/email/runtime.ts";
import { saveEmail } from "../server/publishing/email.ts";
import { createTokenVault } from "../server/connections/vault.ts";
import { identityFixture } from "./auth-fixture.mjs";
const key = Buffer.alloc(32, 7).toString("base64");
const mail = (sizes = [20 * 1024 * 1024]) => ({
  from: "sender@example.test",
  to: ["to@example.test"],
  cc: [],
  bcc: [],
  subject: "Reviewed subject",
  body: "Reviewed message",
  messageId: "<hub.test@example.test>",
  createdAt: 1,
  attachments: sizes.map((size) => ({
    name: "same-name.pdf",
    mime: "application/pdf",
    size,
    read: async (offset, length) => new Uint8Array(length).fill(offset % 255),
  })),
});
function provider() {
  const remote = {
    isDraft: true,
    files: [],
    sessions: new Map(),
    puts: [],
    sends: 0,
    creates: 0,
    failAt: null,
    changed: false,
  };
  remote.fetch = async (url, options = {}) => {
    if (url.startsWith("https://outlook.office.com/")) {
      assert.equal(options.headers?.Authorization, undefined);
      assert.equal(options.redirect, "error");
      const session = remote.sessions.get(url);
      assert.ok(session);
      if (options.method === "GET")
        return Response.json({ nextExpectedRanges: [String(session.offset)] });
      assert.equal(options.method, "PUT");
      const length = options.body.length;
      assert.ok(length < 4 * 1024 * 1024);
      assert.equal(options.headers["Content-Length"], String(length));
      assert.equal(
        options.headers["Content-Range"],
        `bytes ${session.offset}-${session.offset + length - 1}/${session.file.size}`,
      );
      remote.puts.push({ offset: session.offset, length });
      session.offset += length;
      if (session.offset === session.file.size)
        remote.files.push({
          ...session.file,
          id: "attachment" + remote.files.length,
        });
      if (remote.failAt === remote.puts.length) {
        remote.failAt = null;
        throw new Error("Connection lost after server received bytes");
      }
      return session.offset === session.file.size
        ? new Response(null, { status: 201 })
        : Response.json({ nextExpectedRanges: [String(session.offset)] });
    }
    assert.ok(url.startsWith("https://graph.microsoft.com/v1.0/"));
    assert.equal(options.headers.Authorization, "Bearer secret");
    assert.equal(options.redirect, "error");
    if (url.endsWith("/send")) {
      remote.sends++;
      remote.isDraft = false;
      return new Response(null, { status: 202 });
    }
    if (url.endsWith("/createUploadSession")) {
      const file = JSON.parse(options.body).AttachmentItem,
        uploadUrl =
          "https://outlook.office.com/upload/" +
          remote.sessions.size +
          "?authtoken=private";
      remote.sessions.set(uploadUrl, { file, offset: 0 });
      return Response.json({
        uploadUrl,
        expirationDateTime: new Date(Date.now() + 3600000).toISOString(),
        nextExpectedRanges: ["0"],
      });
    }
    if (url.includes("/attachments?")) {
      assert.ok(url.includes("microsoft.graph.fileAttachment/contentId"));
      assert.ok(!url.includes("contentBytes"));
      return Response.json({ value: remote.files });
    }
    if (url.endsWith("/attachments")) {
      const file = JSON.parse(options.body);
      remote.files.push({
        ...file,
        id: "small",
        size: Buffer.from(file.contentBytes, "base64").length,
      });
      return Response.json({ id: "small" });
    }
    if (options.method === "PATCH") {
      remote.snapshot = JSON.parse(options.body);
      return Response.json({ id: "draft" });
    }
    if (options.method === "POST") {
      remote.creates++;
      await new Response(options.body).arrayBuffer();
      return Response.json({ id: "draft" });
    }
    return Response.json({
      id: "draft",
      isDraft: remote.isDraft,
      ...remote.snapshot,
      ...(remote.changed ? { subject: "Changed outside hub" } : {}),
    });
  };
  return remote;
}
test("Outlook prepares a full 20 MiB attachment in bounded chunks before explicit submission", async () => {
  const p = provider(),
    state = { files: {} },
    checkpoints = [];
  const send = await prepareOutlook(
    mail(),
    "secret",
    state,
    async (s) => checkpoints.push(structuredClone(s)),
    undefined,
    p.fetch,
  );
  assert.equal(p.sends, 0);
  assert.equal(
    p.puts.reduce((n, p) => n + p.length, 0),
    20 * 1024 * 1024,
  );
  assert.ok(checkpoints.length >= 8);
  assert.equal(state.files["0"].url, undefined);
  await send();
  assert.equal(p.sends, 1);
});
test("interrupted uploads resume at the server offset and reuse the same remote draft", async () => {
  const p = provider(),
    state = { files: {} };
  p.failAt = 2;
  await assert.rejects(
    prepareOutlook(mail(), "secret", state, async () => {}, undefined, p.fetch),
    /interrupted/,
  );
  assert.equal(state.files["0"].offset, 3276800);
  const send = await prepareOutlook(
    mail(),
    "secret",
    state,
    async () => {},
    undefined,
    p.fetch,
  );
  assert.equal(p.puts[2].offset, 6553600);
  assert.equal(p.creates, 1);
  await send();
  assert.equal(p.sends, 1);
});
test("a lost final upload response is reconciled from attachments without uploading duplicates", async () => {
  const p = provider(),
    state = { files: {} };
  p.failAt = 2;
  const message = mail([4000000]);
  await assert.rejects(
    prepareOutlook(
      message,
      "secret",
      state,
      async () => {},
      undefined,
      p.fetch,
    ),
  );
  assert.equal(p.files.length, 1);
  const send = await prepareOutlook(
    message,
    "secret",
    state,
    async () => {},
    undefined,
    p.fetch,
  );
  assert.equal(p.puts.length, 2);
  await send();
  assert.equal(p.sends, 1);
});
test("mixed small and large files retain distinct identities despite duplicate filenames", async () => {
  const p = provider();
  await (
    await prepareOutlook(
      mail([200000, 4000000]),
      "secret",
      { files: {} },
      async () => {},
      undefined,
      p.fetch,
    )
  )();
  assert.equal(p.files.length, 2);
  assert.notEqual(p.files[0].contentId, p.files[1].contentId);
  assert.equal(p.sends, 1);
});
test("outside edits, extra attachments and incomplete upload confirmation block submission", async () => {
  const p = provider(),
    send = await prepareOutlook(
      mail([4000000]),
      "secret",
      { files: {} },
      async () => {},
      undefined,
      p.fetch,
    );
  p.changed = true;
  await assert.rejects(send(), /changed outside/);
  assert.equal(p.sends, 0);
  p.changed = false;
  p.files.push({ id: "outside", name: "unreviewed", size: 1 });
  await assert.rejects(send(), /do not match/);
  assert.equal(p.sends, 0);
  const q = provider(),
    state = {
      draftId: "draft",
      files: {
        0: {
          offset: 4000000,
          url: "https://outlook.office.com/complete",
          expiresAt: Date.now() + 60000,
        },
      },
    };
  q.sessions.set(state.files["0"].url, { offset: 4000000 });
  await assert.rejects(
    prepareOutlook(
      mail([4000000]),
      "secret",
      state,
      async () => {},
      undefined,
      q.fetch,
    ),
    /do not match/,
  );
  assert.equal(q.sends, 0);
});
test("already-submitted remote drafts are never submitted a second time", async () => {
  const p = provider();
  p.isDraft = false;
  const send = await prepareOutlook(
    mail(),
    "secret",
    { draftId: "draft", files: {} },
    async () => {},
    undefined,
    p.fetch,
  );
  assert.deepEqual(await send(), { id: "draft" });
  assert.equal(p.sends, 0);
  assert.equal(p.puts.length, 0);
});
test("signed upload locations reject external hosts, plaintext and embedded credentials", () => {
  for (const url of [
    "https://attacker.test/upload",
    "https://outlook.office.com.attacker.test/",
    "http://outlook.office.com/",
    "https://user:pass@outlook.office.com/",
    "https://outlook.office.com:8443/",
  ])
    assert.throws(() => validOutlookUploadUrl(url));
  assert.equal(
    validOutlookUploadUrl("https://outlook.office.com/path?token=opaque"),
    "https://outlook.office.com/path?token=opaque",
  );
});
const actor = {
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
    "INSERT INTO hub_workspaces VALUES('w','Workspace'); INSERT INTO hub_users VALUES('u','u@example.test','Admin','unused'); INSERT INTO hub_members VALUES('w','u','admin',1); INSERT INTO hub_brands VALUES('b','w','Brand'); INSERT INTO hub_brand_access VALUES('w','u','b'); INSERT INTO social_connections(id,workspace_id,provider,label,sealed_tokens,created_at,granted_scopes) VALUES('m','w','microsoft','sender@example.test','unused',1,'[\"Mail.ReadWrite\",\"Mail.Send\"]'); INSERT INTO hub_connection_brands VALUES('m','b'); INSERT INTO hub_email_files VALUES('file','w','b','object','brief.pdf','application/pdf',20971520,'u',1);",
  );
  const draft = await saveEmail(f.db, actor, {
    brandId: "b",
    mailboxId: "m",
    to: "to@example.test",
    subject: "Subject",
    body: "Body",
    attachments: ["file"],
    clientKey: crypto.randomUUID(),
  });
  return { ...f, draft };
}
test("Outlook queue accepts 20 MiB with write permission and rejects old grants or oversized messages", async () => {
  const f = await fixture();
  try {
    f.sql.exec(
      'UPDATE social_connections SET granted_scopes=\'["Mail.Read","Mail.Send"]\'',
    );
    await assert.rejects(
      queueEmail(f.db, actor, { id: f.draft.id, version: 1 }, true),
      /reauthorize/,
    );
    f.sql.exec(
      'UPDATE social_connections SET granted_scopes=\'["Mail.ReadWrite","Mail.Send"]\'; UPDATE hub_email_files SET bytes=20971521',
    );
    await assert.rejects(
      queueEmail(f.db, actor, { id: f.draft.id, version: 1 }, true),
      /20 MB/,
    );
    f.sql.exec("UPDATE hub_email_files SET bytes=20971520");
    assert.equal(
      (await queueEmail(f.db, actor, { id: f.draft.id, version: 1 }, true))
        .status,
      "queued",
    );
  } finally {
    f.sql.close();
  }
});
test("upload checkpoints are encrypted, context-bound and stop after cancellation", async () => {
  const f = await fixture();
  try {
    const queued = await queueEmail(
      f.db,
      actor,
      { id: f.draft.id, version: 1 },
      true,
    );
    const p = provider();
    p.failAt = 2;
    await deliverMail(f.db, {
      prepare: (job) =>
        prepareStoredOutlook(
          f.db,
          key,
          job,
          mail(),
          "secret",
          undefined,
          p.fetch,
        ),
    });
    const row = f.sql.prepare("SELECT * FROM hub_email_delivery").get();
    assert.equal(row.status, "failed");
    assert.ok(!row.sealed_preparation.includes("authtoken"));
    const vault = await createTokenVault(key);
    const checkpoint = JSON.parse(
      (await vault.open(row.sealed_preparation, "w", "email-upload:" + row.id))
        .accessToken,
    );
    assert.ok(checkpoint.files["0"].url.includes("authtoken"));
    await assert.rejects(
      vault.open(row.sealed_preparation, "other", "email-upload:" + row.id),
    );
    await retryEmail(f.db, actor, queued.id, true);
    await deliverMail(f.db, {
      prepare: (job) =>
        prepareStoredOutlook(
          f.db,
          key,
          job,
          mail(),
          "secret",
          undefined,
          p.fetch,
        ),
    });
    assert.equal(p.creates, 1);
    assert.equal(p.sends, 1);
    assert.equal(
      f.sql.prepare("SELECT status FROM hub_email_delivery").get().status,
      "accepted",
    );
  } finally {
    f.sql.close();
  }
  const g = await fixture();
  try {
    await queueEmail(g.db, actor, { id: g.draft.id, version: 1 }, true);
    const p = provider();
    await deliverMail(g.db, {
      prepare: (job) =>
        prepareStoredOutlook(
          g.db,
          key,
          job,
          mail(),
          "secret",
          undefined,
          async (url, options) => {
            const result = await p.fetch(url, options);
            if (url.includes("createUploadSession"))
              await cancelEmail(g.db, actor, job.id);
            return result;
          },
        ),
    });
    assert.equal(p.sends, 0);
    assert.equal(
      g.sql.prepare("SELECT status FROM hub_email_delivery").get().status,
      "cancelled",
    );
  } finally {
    g.sql.close();
  }
});
test("retry requires an unchanged saved draft and never accepts uncertain or already queued messages", async () => {
  const f = await fixture();
  try {
    const queued = await queueEmail(
      f.db,
      actor,
      { id: f.draft.id, version: 1 },
      true,
    );
    await assert.rejects(
      retryEmail(f.db, actor, queued.id, true),
      /cannot be retried/,
    );
    f.sql.exec("UPDATE hub_email_delivery SET status='uncertain'");
    await assert.rejects(
      retryEmail(f.db, actor, queued.id, true),
      /cannot be retried/,
    );
    f.sql.exec("UPDATE hub_email_delivery SET status='failed'");
    await assert.rejects(
      retryEmail(f.db, actor, queued.id, false),
      /not enabled/,
    );
    f.sql.exec("UPDATE hub_email_drafts SET version=2");
    await assert.rejects(
      retryEmail(f.db, actor, queued.id, true),
      /has changed/,
    );
  } finally {
    f.sql.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { identityFixture } from "./auth-fixture.mjs";
import { saveEmail, emailAddresses } from "../server/publishing/email.ts";
import { inspectEmailFile } from "../server/publishing/email-files.ts";
const a = { id: "u", workspaceId: "w", role: "admin" };
function fixture() {
  const f = identityFixture();
  f.sql.exec(
    "INSERT INTO hub_workspaces VALUES('w','Workspace'); INSERT INTO hub_users VALUES('u','u@example.test','Admin','unused'); INSERT INTO hub_members VALUES('w','u','admin',1); INSERT INTO hub_brands VALUES('b','w','Brand'),('p','w','Private'); INSERT INTO hub_brand_access VALUES('w','u','b'); INSERT INTO social_connections(id,workspace_id,provider,label,sealed_tokens,created_at) VALUES('mail','w','google','hello@example.test','unused',1),('private','w','microsoft','private@example.test','unused',1); INSERT INTO hub_connection_brands VALUES('mail','b'),('private','p');",
  );
  return f;
}
const input = (extra = {}) => ({
  brandId: "b",
  to: "customer@example.test",
  subject: "A follow-up",
  body: "Hello there",
  attachments: [],
  clientKey: crypto.randomUUID(),
  ...extra,
});
test("recipient lists normalize addresses, preserve separate cc/bcc and reject malformed header values", () => {
  assert.deepEqual(
    emailAddresses("One@Example.test; two@example.test,one@example.test"),
    ["one@example.test", "two@example.test"],
  );
  for (const x of [
    "wrong",
    "bad\r\nBcc:evil@example.test",
    "Display Name <one@example.test>",
  ])
    assert.throws(() => emailAddresses(x), /valid email/);
});
test("email drafts persist offline and duplicate saves are idempotent", async () => {
  const { db, sql } = fixture();
  try {
    const payload = input({
        cc: "colleague@example.test",
        bcc: "archive@example.test",
      }),
      first = await saveEmail(db, a, payload);
    assert.equal((await saveEmail(db, a, payload)).id, first.id);
    const row = sql.prepare("SELECT * FROM hub_email_drafts").get();
    assert.equal(row.mailbox_id, null);
    assert.deepEqual(JSON.parse(row.bcc), ["archive@example.test"]);
    assert.equal(
      sql.prepare("SELECT COUNT(*) n FROM hub_email_messages").get().n,
      0,
    );
    await assert.rejects(
      saveEmail(db, a, { ...payload, subject: "Different" }),
      /earlier draft/,
    );
  } finally {
    sql.close();
  }
});
test("mailbox, lead and attachment selection cannot cross brand access boundaries", async () => {
  const { db, sql } = fixture();
  try {
    await assert.rejects(saveEmail(db, a, input({ brandId: "p" })), /access/);
    await assert.rejects(
      saveEmail(db, a, input({ mailboxId: "private" })),
      /mailbox assigned/,
    );
    await assert.rejects(
      saveEmail(db, a, input({ leadId: "unknown" })),
      /lead does not belong/,
    );
    await assert.rejects(
      saveEmail(db, a, input({ attachments: ["unknown"] })),
      /Attachments must belong/,
    );
    await saveEmail(db, a, input({ mailboxId: "mail" }));
  } finally {
    sql.close();
  }
});
test("versioned edits and discard protect other teammates work; send is explicitly unavailable", async () => {
  const { db, sql } = fixture();
  try {
    const payload = input(),
      { id } = await saveEmail(db, a, payload);
    await saveEmail(db, a, { ...payload, id, version: 1, body: "Updated" });
    await assert.rejects(
      saveEmail(db, a, { ...payload, id, version: 1 }),
      /changed elsewhere/,
    );
    await assert.rejects(
      saveEmail(db, a, { brandId: "b", id, action: "send" }),
      /not enabled/,
    );
    assert.equal(
      sql.prepare("SELECT body FROM hub_email_drafts").get().body,
      "Updated",
    );
    await saveEmail(db, a, { brandId: "b", id, version: 2, action: "discard" });
    await assert.rejects(
      saveEmail(db, a, { ...payload, id, version: 3 }),
      /discarded/,
    );
    assert.equal(
      sql.prepare("SELECT status FROM hub_email_drafts").get().status,
      "discarded",
    );
  } finally {
    sql.close();
  }
});
test("reply drafts must use the original mailbox and attachments have a combined limit", async () => {
  const { db, sql } = fixture();
  try {
    sql.exec(
      "INSERT INTO hub_email_messages(id,workspace_id,brand_id,mailbox_id,provider_id,thread_id,direction,sender,recipients,subject,body,received_at) VALUES('msg','w','b','mail','provider','thread','incoming','customer@example.test','[\"hello@example.test\"]','Question','Hello',1); INSERT INTO hub_media(id,workspace_id,brand_id,object_key,mime,bytes,width,height,created_by,created_at) VALUES('large','w','b','key','video/mp4',22000000,1920,1080,'u',1);",
    );
    await assert.rejects(
      saveEmail(db, a, input({ replyToId: "msg" })),
      /original message mailbox/,
    );
    await saveEmail(db, a, input({ replyToId: "msg", mailboxId: "mail" }));
    await assert.rejects(
      saveEmail(db, a, input({ attachments: ["large"] })),
      /20 MB/,
    );
  } finally {
    sql.close();
  }
});
test("document attachments validate type and remain bound to their brand", async () => {
  assert.equal(
    inspectEmailFile("brief.pdf", new TextEncoder().encode("%PDF-1.7\n")),
    "application/pdf",
  );
  assert.equal(
    inspectEmailFile("notes.txt", new TextEncoder().encode("Hello")),
    "text/plain",
  );
  assert.throws(
    () => inspectEmailFile("script.exe", new Uint8Array([1, 2, 3])),
    /Choose a PDF/,
  );
  assert.throws(
    () =>
      inspectEmailFile("../brief.pdf", new TextEncoder().encode("%PDF-1.7")),
    /valid name/,
  );
  assert.throws(
    () => inspectEmailFile("bad.pdf", new Uint8Array([1, 2, 3])),
    /Choose a PDF/,
  );
  const { db, sql } = fixture();
  try {
    sql.exec(
      "INSERT INTO hub_email_files VALUES('document','w','b','key','brief.pdf','application/pdf',100,'u',1),('private-file','w','p','private-key','private.pdf','application/pdf',100,'u',1);",
    );
    await saveEmail(db, a, input({ attachments: ["document"] }));
    await assert.rejects(
      saveEmail(db, a, input({ attachments: ["private-file"] })),
      /belong to this brand/,
    );
    await assert.rejects(
      saveEmail(
        db,
        a,
        input({ subject: "Hello\r\nBcc: injected@example.test" }),
      ),
      /one line/,
    );
    assert.throws(() => emailAddresses("user@@example.test"), /valid email/);
  } finally {
    sql.close();
  }
});

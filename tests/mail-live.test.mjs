import test from "node:test";
import assert from "node:assert/strict";
import { identityFixture } from "./auth-fixture.mjs";
import { saveEmail } from "../server/publishing/email.ts";
import {
  queueEmail,
  cancelEmail,
  resolveEmail,
} from "../server/email/delivery.ts";
import { deliverMail, importMail } from "../server/email/runtime.ts";
import { mimeMessage, base64Chunks } from "../server/email/mime.ts";
import {
  mailProvider,
  MailError,
  htmlToText,
} from "../server/email/providers.ts";
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
    "INSERT INTO hub_workspaces VALUES('w','Workspace'); INSERT INTO hub_users VALUES('u','u@example.test','Admin','unused'),('o','o@example.test','Owner','unused'); INSERT INTO hub_members VALUES('w','u','admin',1),('w','o','super_admin',1); INSERT INTO hub_brands VALUES('b','w','Brand'),('p','w','Private'); INSERT INTO hub_brand_access VALUES('w','u','b'); INSERT INTO social_connections(id,workspace_id,provider,label,sealed_tokens,created_at) VALUES('m','w','google','hello@example.test','unused',1),('private','w','google','private@example.test','unused',1); INSERT INTO hub_connection_brands VALUES('m','b'),('private','p');",
  );
  const draft = await saveEmail(f.db, actor, {
    brandId: "b",
    mailboxId: "m",
    to: "recipient@example.test",
    subject: "A message",
    body: "Hello",
    clientKey: crypto.randomUUID(),
  });
  return { ...f, draft };
}
const outgoing = (extra = {}) => ({
  from: "hello@example.test",
  to: ["recipient@example.test"],
  cc: ["cc@example.test"],
  bcc: ["bcc@example.test"],
  subject: "Résumé and updates",
  body: "Hello 🌍",
  messageId: "<message@example.test>",
  createdAt: 1,
  attachments: [],
  ...extra,
});
async function collect(source) {
  const chunks = [];
  for await (const b of source) chunks.push(Buffer.from(b));
  return Buffer.concat(chunks);
}
test("streamed MIME keeps exact byte lengths across many attachment chunks and folds recipient headers", async () => {
  const bytes = Buffer.alloc(200003, 65),
    reads = [],
    mail = outgoing({
      attachments: [
        {
          name: "brief.pdf",
          mime: "application/pdf",
          size: bytes.length,
          read: async (offset, length) => {
            reads.push(length);
            return bytes.subarray(offset, offset + length);
          },
        },
      ],
    }),
    mime = mimeMessage(mail),
    data = await collect(mime.chunks());
  assert.equal(data.length, mime.length);
  assert.ok(Math.max(...reads) <= 57 * 1024);
  assert.ok(reads.length > 3);
  assert.ok(data.toString().includes("Bcc: bcc@example.test"));
  assert.ok(data.toString().includes("Subject: =?UTF-8?B?"));
  const whole = await collect(base64Chunks(mime.chunks()));
  assert.deepEqual(Buffer.from(whole.toString(), "base64"), data);
  assert.throws(
    () => mimeMessage(outgoing({ from: "bad\r\nBcc:attacker@example.test" })),
    /Invalid email header/,
  );
});
test("Gmail multipart and Outlook MIME transports preserve headers and distinguish acceptance from Sent", async () => {
  const seen = [];
  const fetcher = async (url, options) => {
    const bytes = Buffer.from(await new Response(options.body).arrayBuffer());
    assert.equal(Number(options.headers["Content-Length"]), bytes.length);
    seen.push({ url, options, bytes });
    return url.includes("gmail.googleapis.com")
      ? Response.json({ id: "gmail-id" })
      : new Response(null, { status: 202 });
  };
  const google = mailProvider("google", "token", "hello@example.test", fetcher);
  assert.equal(
    (
      await google.send(
        outgoing({
          threadId: "thread",
          replyMessageId: "<parent@example.test>",
        }),
      )
    ).id,
    "gmail-id",
  );
  assert.ok(seen[0].url.includes("uploadType=multipart"));
  assert.ok(seen[0].bytes.toString().includes('"threadId":"thread"'));
  assert.ok(
    seen[0].bytes.toString().includes("In-Reply-To: <parent@example.test>"),
  );
  const ms = mailProvider("microsoft", "token", "hello@example.test", fetcher);
  assert.equal((await ms.send(outgoing())).id, null);
  assert.ok(
    Buffer.from(seen[1].bytes.toString(), "base64")
      .toString()
      .includes("Message-ID: <message@example.test>"),
  );
});
test("queue is immutable and idempotent, and cancellation restores draft editability", async () => {
  const { db, sql, draft } = await fixture();
  try {
    const first = await queueEmail(
      db,
      actor,
      { id: draft.id, version: 1 },
      true,
    );
    assert.equal(
      (await queueEmail(db, actor, { id: draft.id, version: 1 }, true)).id,
      first.id,
    );
    await assert.rejects(
      saveEmail(db, actor, {
        id: draft.id,
        version: 1,
        brandId: "b",
        to: "another@example.test",
        subject: "Changed",
      }),
      /active delivery/,
    );
    await cancelEmail(db, actor, first.id);
    const changed = await saveEmail(db, actor, {
      id: draft.id,
      version: 1,
      brandId: "b",
      mailboxId: "m",
      to: "recipient@example.test",
      subject: "Changed",
      body: "Updated",
    });
    assert.equal(changed.version, 2);
    assert.equal(
      sql.prepare("SELECT status FROM hub_email_delivery").get().status,
      "cancelled",
    );
  } finally {
    sql.close();
  }
});
test("concurrent workers submit once; Sent import reconciles accepted deliveries without duplicating messages", async () => {
  const { db, sql, draft } = await fixture();
  try {
    const queued = await queueEmail(
      db,
      actor,
      { id: draft.id, version: 1 },
      true,
    );
    let sends = 0;
    const adapter = {
      async prepare() {
        return async () => {
          sends++;
          return { id: "remote" };
        };
      },
    };
    await Promise.all([deliverMail(db, adapter), deliverMail(db, adapter)]);
    assert.equal(sends, 1);
    assert.equal(
      sql.prepare("SELECT status FROM hub_email_delivery").get().status,
      "accepted",
    );
    const id = sql
        .prepare("SELECT message_id FROM hub_email_delivery")
        .get().message_id,
      message = {
        providerId: "remote",
        threadId: "thread",
        direction: "outgoing",
        sender: "hello@example.test",
        to: ["recipient@example.test"],
        replyTo: [],
        subject: "A message",
        body: "Hello",
        receivedAt: 1,
        internetMessageId: id,
      };
    await importMail(db, { id: "m", workspace_id: "w" }, [message, message]);
    assert.equal(
      sql.prepare("SELECT COUNT(*) n FROM hub_email_messages").get().n,
      1,
    );
    assert.equal(
      sql
        .prepare("SELECT status FROM hub_email_delivery WHERE id=?")
        .get(queued.id).status,
      "sent",
    );
  } finally {
    sql.close();
  }
});
test("an ambiguous submission never auto-retries and only an owner can verify absence", async () => {
  const { db, sql, draft } = await fixture();
  try {
    const queued = await queueEmail(
      db,
      actor,
      { id: draft.id, version: 1 },
      true,
    );
    let calls = 0;
    const adapter = {
      async prepare() {
        return async () => {
          calls++;
          throw new MailError(true, "Unknown result");
        };
      },
    };
    await deliverMail(db, adapter);
    await deliverMail(db, adapter);
    assert.equal(calls, 1);
    assert.equal(
      sql.prepare("SELECT status FROM hub_email_delivery").get().status,
      "uncertain",
    );
    const proof = {
      id: queued.id,
      accepted: false,
      note: "Checked the mailbox Sent folder and no matching email is present.",
    };
    await assert.rejects(resolveEmail(db, actor, proof), /super admin/i);
    await resolveEmail(db, { ...actor, id: "o", role: "super_admin" }, proof);
    assert.equal(
      sql.prepare("SELECT status FROM hub_email_delivery").get().status,
      "failed",
    );
  } finally {
    sql.close();
  }
});
test("revoked brand access stops a queued email before provider submission", async () => {
  const { db, sql, draft } = await fixture();
  try {
    await queueEmail(db, actor, { id: draft.id, version: 1 }, true);
    sql.exec("DELETE FROM hub_brand_access WHERE user_id='u'");
    let calls = 0;
    await deliverMail(db, {
      async prepare() {
        calls++;
        return async () => ({ id: "remote" });
      },
    });
    assert.equal(calls, 0);
    assert.equal(
      sql.prepare("SELECT status FROM hub_email_delivery").get().status,
      "failed",
    );
  } finally {
    sql.close();
  }
});
test("Gmail sync decodes subjects, respects Reply-To and treats HTML as safe text with no attachment-body leakage", async () => {
  const provider = mailProvider(
    "google",
    "token",
    "hello@example.test",
    async (url) =>
      url.includes("?format=full")
        ? Response.json({
            id: "id",
            threadId: "thread",
            internalDate: "1234",
            labelIds: ["INBOX"],
            payload: {
              mimeType: "multipart/mixed",
              headers: [
                { name: "From", value: '"Smith, Jane" <jane@example.test>' },
                { name: "Reply-To", value: "support@example.test" },
                { name: "Subject", value: "=?UTF-8?B?UsOpc3Vtw6k=?=" },
              ],
              parts: [
                {
                  mimeType: "text/html",
                  body: {
                    data: Buffer.from(
                      '<p>Hello &amp; welcome</p><script>secret()</script><img src="https://tracker.test">',
                    ).toString("base64url"),
                  },
                },
                {
                  partId: "1",
                  filename: "note.txt",
                  mimeType: "text/plain",
                  body: {
                    size: 9,
                    data: Buffer.from("ATTACHMENT").toString("base64url"),
                  },
                },
              ],
            },
          })
        : Response.json({ messages: [{ id: "id" }] }),
  );
  const result = await provider.list(null),
    m = result.messages[0];
  assert.equal(m.sender, "jane@example.test");
  assert.equal(m.replyTo[0], "support@example.test");
  assert.equal(m.subject, "Résumé");
  assert.equal(m.body, "Hello & welcome");
  assert.equal(m.files[0].name, "note.txt");
  assert.ok(!htmlToText("<script>run()</script><p>Safe</p>").includes("run()"));
});
test("Outlook sync uses actual Inbox/Sent folders and rejects external pagination URLs before exposing credentials", async () => {
  const urls = [],
    provider = mailProvider(
      "microsoft",
      "token",
      "hello@example.test",
      async (url) => {
        urls.push(url);
        return Response.json({
          value: [
            {
              id: url.includes("sentitems") ? "sent" : "incoming",
              conversationId: "conversation",
              from: { emailAddress: { address: "alias@example.test" } },
              toRecipients: [],
              subject: "Hello",
              body: { contentType: "text", content: "Body" },
              receivedDateTime: "2026-11-01T00:00:00Z",
            },
          ],
        });
      },
    );
  const result = await provider.list(null);
  assert.deepEqual(
    result.messages.map((m) => m.direction),
    ["incoming", "outgoing"],
  );
  assert.ok(urls[0].includes("mailFolders/inbox"));
  assert.ok(urls[1].includes("mailFolders/sentitems"));
  await assert.rejects(
    provider.list(
      JSON.stringify({ folder: "inbox", next: "https://attacker.test/token" }),
    ),
    /Invalid mailbox continuation/,
  );
  assert.equal(urls.length, 2);
});

test("access revoked during preparation is checked again before submission", async () => {
  const { db, sql, draft } = await fixture();
  try {
    await queueEmail(db, actor, { id: draft.id, version: 1 }, true);
    let sends = 0;
    await deliverMail(db, {
      async prepare() {
        sql.exec("DELETE FROM hub_connection_brands WHERE connection_id='m'");
        return async () => {
          sends++;
          return { id: "remote" };
        };
      },
    });
    assert.equal(sends, 0);
    assert.equal(
      sql.prepare("SELECT status FROM hub_email_delivery").get().status,
      "failed",
    );
  } finally {
    sql.close();
  }
});

test("provider failures distinguish rejected mail from unknown submission outcomes", async () => {
  const failing = (code) =>
    mailProvider(
      "google",
      "token",
      "hello@example.test",
      async () => new Response(null, { status: code }),
    );
  await assert.rejects(
    failing(503).send(outgoing()),
    (e) => e instanceof MailError && e.uncertain,
  );
  await assert.rejects(
    failing(400).send(outgoing()),
    (e) => e instanceof MailError && !e.uncertain,
  );
  await assert.rejects(
    failing(503).list(null),
    (e) => e instanceof MailError && !e.uncertain,
  );
});

import { AccessError, requireBrand, digest, audit } from "../auth/core.ts";
import type { Actor } from "../auth/core.ts";
function text(v: unknown, max: number, label: string) {
  if (v == null) return "";
  if (typeof v !== "string" || v.length > max)
    throw new AccessError(400, label + " is too long or invalid.");
  return v.trim();
}
export function emailAddresses(v: unknown) {
  const raw = text(v, 3000, "Recipients");
  if (!raw) return [];
  const values = [
    ...new Set(
      raw
        .split(/[;,\n]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (
    values.length > 50 ||
    values.some(
      (s) =>
        s.length > 254 ||
        !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(s) ||
        /[<>\r\n]/.test(s),
    )
  )
    throw new AccessError(
      400,
      "Use valid email addresses separated by commas (up to 50).",
    );
  return values;
}
export async function emailMailbox(
  db: D1Database,
  a: Actor,
  brand: string,
  id: string,
) {
  const row = await db
    .prepare(
      "SELECT c.id FROM social_connections c JOIN hub_connection_brands b ON b.connection_id=c.id WHERE c.id=? AND c.workspace_id=? AND b.brand_id=? AND c.provider IN ('google','microsoft')",
    )
    .bind(id, a.workspaceId, brand)
    .first();
  if (!row)
    throw new AccessError(403, "Choose a mailbox assigned to this brand.");
}
export async function saveEmail(
  db: D1Database,
  a: Actor,
  d: Record<string, unknown>,
) {
  const brand = text(d.brandId, 100, "Brand");
  await requireBrand(db, a, brand);
  const id = text(d.id, 100, "Draft"),
    old = id
      ? await db
          .prepare(
            "SELECT * FROM hub_email_drafts WHERE id=? AND workspace_id=? AND brand_id=?",
          )
          .bind(id, a.workspaceId, brand)
          .first<{ version: number; status: string }>()
      : null;
  if (id && !old) throw new AccessError(404, "Email draft not found.");
  if (
    old &&
    (await db
      .prepare(
        "SELECT id FROM hub_email_delivery WHERE draft_id=? AND status IN ('queued','preparing','submitting','accepted','sent','uncertain')",
      )
      .bind(id)
      .first())
  )
    throw new AccessError(
      409,
      "This draft has an active delivery. Check Outbox before editing.",
    );
  if (d.action === "send")
    throw new AccessError(
      409,
      "Live email delivery is not enabled. Save your draft for now.",
    );
  if (old && d.action === "discard") {
    const r = await db
      .prepare(
        "UPDATE hub_email_drafts SET status='discarded',version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=? AND status='draft'",
      )
      .bind(Date.now(), a.id, id, d.version)
      .run();
    if (!r.meta.changes)
      throw new AccessError(
        409,
        "This draft changed elsewhere. Refresh before discarding.",
      );
    return { id };
  }
  if (d.action && d.action !== "save")
    throw new AccessError(400, "Choose a valid draft action.");
  if (old?.status === "discarded")
    throw new AccessError(409, "This draft was discarded.");
  const to = emailAddresses(d.to),
    cc = emailAddresses(d.cc),
    bcc = emailAddresses(d.bcc),
    subject = text(d.subject, 300, "Subject"),
    body = text(d.body, 10000, "Message"),
    mailbox = text(d.mailboxId, 100, "Mailbox") || null,
    lead = text(d.leadId, 100, "Lead") || null,
    reply = text(d.replyToId, 100, "Message") || null;
  if (/[\r\n]/.test(subject))
    throw new AccessError(400, "Keep the subject on one line.");
  if (!to.length && !subject && !body)
    throw new AccessError(
      400,
      "Add a recipient, subject or message before saving.",
    );
  if (to.length + cc.length + bcc.length > 50)
    throw new AccessError(
      400,
      "Use up to 50 recipients across To, Cc and Bcc.",
    );
  if (mailbox) await emailMailbox(db, a, brand, mailbox);
  if (
    lead &&
    !(await db
      .prepare(
        "SELECT id FROM hub_leads WHERE id=? AND workspace_id=? AND brand_id=?",
      )
      .bind(lead, a.workspaceId, brand)
      .first())
  )
    throw new AccessError(403, "This lead does not belong to this brand.");
  if (reply) {
    const source = await db
      .prepare(
        "SELECT mailbox_id FROM hub_email_messages m WHERE id=? AND workspace_id=? AND (brand_id=? OR EXISTS(SELECT 1 FROM hub_email_message_brands b WHERE b.message_id=m.id AND b.brand_id=?))",
      )
      .bind(reply, a.workspaceId, brand, brand)
      .first<{ mailbox_id: string }>();
    if (!source || source.mailbox_id !== mailbox)
      throw new AccessError(403, "Reply using the original message mailbox.");
  }
  if (d.attachments !== undefined && !Array.isArray(d.attachments))
    throw new AccessError(400, "Choose valid attachments.");
  const attachments = Array.isArray(d.attachments)
    ? [...new Set(d.attachments)]
    : [];
  if (attachments.length > 10 || attachments.some((x) => typeof x !== "string"))
    throw new AccessError(400, "Choose up to 10 attachments.");
  let bytes = 0;
  for (const asset of attachments) {
    const m = await db
      .prepare(
        "SELECT bytes FROM hub_media WHERE id=? AND workspace_id=? AND brand_id=? UNION ALL SELECT bytes FROM hub_email_files WHERE id=? AND workspace_id=? AND brand_id=?",
      )
      .bind(asset, a.workspaceId, brand, asset, a.workspaceId, brand)
      .first<{ bytes: number }>();
    if (!m)
      throw new AccessError(403, "Attachments must belong to this brand.");
    bytes += m.bytes;
  }
  if (bytes > 20 * 1024 * 1024)
    throw new AccessError(400, "Email attachments must total 20 MB or less.");
  const values = [
      mailbox,
      lead,
      reply,
      JSON.stringify(to),
      JSON.stringify(cc),
      JSON.stringify(bcc),
      subject,
      body,
      JSON.stringify(attachments),
    ],
    hash = digest(JSON.stringify([brand, ...values])),
    now = Date.now();
  if (old) {
    const r = await db
      .prepare(
        "UPDATE hub_email_drafts SET mailbox_id=?,lead_id=?,reply_to_id=?,recipients=?,cc=?,bcc=?,subject=?,body=?,attachments=?,payload_hash=?,updated_by=?,updated_at=?,version=version+1 WHERE id=? AND workspace_id=? AND version=? AND status='draft'",
      )
      .bind(...values, hash, a.id, now, id, a.workspaceId, d.version)
      .run();
    if (!r.meta.changes)
      throw new AccessError(
        409,
        "This draft changed elsewhere. Reopen it before saving.",
      );
    return { id, version: old.version + 1 };
  }
  const key = text(d.clientKey, 100, "Save key");
  if (!/^[\w-]{16,100}$/.test(key))
    throw new AccessError(400, "Refresh the composer before saving.");
  const existing = await db
    .prepare(
      "SELECT id,payload_hash,version FROM hub_email_drafts WHERE workspace_id=? AND client_key=?",
    )
    .bind(a.workspaceId, key)
    .first<{ id: string; payload_hash: string; version: number }>();
  if (existing) {
    if (existing.payload_hash !== hash)
      throw new AccessError(409, "This save key belongs to an earlier draft.");
    return { id: existing.id, version: existing.version };
  }
  const created = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT INTO hub_email_drafts(id,workspace_id,brand_id,mailbox_id,lead_id,reply_to_id,recipients,cc,bcc,subject,body,attachments,client_key,payload_hash,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        created,
        a.workspaceId,
        brand,
        ...values,
        key,
        hash,
        a.id,
        a.id,
        now,
        now,
      ),
    audit(db, a, "email.draft_created", created),
  ]);
  return { id: created, version: 1 };
}

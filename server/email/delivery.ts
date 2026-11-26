import { outlookWritable } from "./preparation.ts";
import {
  AccessError,
  requireBrand,
  requireOwner,
  audit,
} from "../auth/core.ts";
import type { Actor } from "../auth/core.ts";
import { emailMailbox, emailAddresses } from "../publishing/email.ts";
export type Delivery = {
  id: string;
  workspace_id: string;
  brand_id: string;
  draft_id: string;
  draft_version: number;
  mailbox_id: string;
  payload: string;
  message_id: string;
  status: string;
  created_by: string;
  created_at: number;
  lease_id: string;
  attempts: number;
};
export async function queueEmail(
  db: D1Database,
  a: Actor,
  d: Record<string, unknown>,
  enabled: boolean,
) {
  const draft = await db
    .prepare(
      "SELECT * FROM hub_email_drafts WHERE id=? AND workspace_id=? AND status='draft'",
    )
    .bind(d.id, a.workspaceId)
    .first<Record<string, unknown>>();
  if (!draft) throw new AccessError(404, "Draft not found.");
  await requireBrand(db, a, String(draft.brand_id));
  if (!enabled)
    throw new AccessError(409, "Live email delivery is not enabled.");
  if (draft.version !== d.version)
    throw new AccessError(409, "The draft changed. Reopen it before sending.");
  if (!draft.mailbox_id) throw new AccessError(400, "Choose a From mailbox.");
  await emailMailbox(db, a, String(draft.brand_id), String(draft.mailbox_id));
  const mailbox = await db
    .prepare(
      "SELECT label,provider,status,granted_scopes FROM social_connections WHERE id=? AND workspace_id=?",
    )
    .bind(draft.mailbox_id, a.workspaceId)
    .first<{
      label: string;
      provider: string;
      status: string;
      granted_scopes: string;
    }>();
  if (!mailbox || mailbox.status === "reconnect_required")
    throw new AccessError(409, "This mailbox needs connection attention.");
  const to = emailAddresses(
    (JSON.parse(String(draft.recipients)) as string[]).join(","),
  );
  if (!to.length || !String(draft.subject).trim() || !String(draft.body).trim())
    throw new AccessError(
      400,
      "Add recipients, subject and a message before sending.",
    );
  const attachments = JSON.parse(String(draft.attachments)) as string[];
  let size = 0;
  for (const id of attachments) {
    const file = await db
      .prepare(
        "SELECT bytes FROM hub_media WHERE id=? AND workspace_id=? AND brand_id=? UNION ALL SELECT bytes FROM hub_email_files WHERE id=? AND workspace_id=? AND brand_id=?",
      )
      .bind(
        id,
        a.workspaceId,
        draft.brand_id,
        id,
        a.workspaceId,
        draft.brand_id,
      )
      .first<{ bytes: number }>();
    if (!file)
      throw new AccessError(
        403,
        "An attachment is no longer available to this brand.",
      );
    size += file.bytes;
  }
  if (
    mailbox.provider === "microsoft" &&
    size > 2 * 1024 * 1024 &&
    !outlookWritable(mailbox.granted_scopes)
  )
    throw new AccessError(
      409,
      "Your super admin needs to reauthorize this Outlook mailbox in Connections to allow larger attachments.",
    );
  if (size > 20 * 1024 * 1024)
    throw new AccessError(400, "Attachments exceed 20 MB.");
  let reply: null | {
    provider_id: string;
    thread_id: string;
    internet_message_id: string;
    subject: string;
  } = null;
  if (draft.reply_to_id) {
    reply = await db
      .prepare(
        "SELECT m.provider_id,m.thread_id,m.internet_message_id,m.subject FROM hub_email_messages m JOIN hub_email_message_brands b ON b.message_id=m.id WHERE m.id=? AND m.workspace_id=? AND m.mailbox_id=? AND b.brand_id=?",
      )
      .bind(draft.reply_to_id, a.workspaceId, draft.mailbox_id, draft.brand_id)
      .first();
    if (!reply?.internet_message_id)
      throw new AccessError(409, "Sync the original message before replying.");
    if (
      String(draft.subject)
        .replace(/^(re:\s*)+/i, "")
        .trim()
        .toLowerCase() !==
      reply.subject
        .replace(/^(re:\s*)+/i, "")
        .trim()
        .toLowerCase()
    )
      throw new AccessError(
        400,
        "Keep the original subject when replying to this thread.",
      );
  }
  const existing = await db
    .prepare(
      "SELECT id,status FROM hub_email_delivery WHERE draft_id=? AND draft_version=?",
    )
    .bind(draft.id, draft.version)
    .first();
  if (existing) return existing;
  const blocked = await db
    .prepare(
      "SELECT id FROM hub_email_delivery WHERE draft_id=? AND status IN ('queued','preparing','submitting','accepted','sent','uncertain')",
    )
    .bind(draft.id)
    .first();
  if (blocked)
    throw new AccessError(
      409,
      "A delivery already exists for this draft. Check Outbox before sending.",
    );
  const id = crypto.randomUUID(),
    now = Date.now(),
    sender = emailAddresses(mailbox.label)[0];
  if (!sender) throw new AccessError(400, "The mailbox identity is invalid.");
  const messageId = "<hub." + id + "@" + sender.split("@")[1] + ">";
  const payload = JSON.stringify({
    to,
    cc: JSON.parse(String(draft.cc)),
    bcc: JSON.parse(String(draft.bcc)),
    subject: draft.subject,
    body: draft.body,
    attachments,
    reply,
  });
  await db.batch([
    db
      .prepare(
        "INSERT INTO hub_email_delivery(id,workspace_id,brand_id,draft_id,draft_version,mailbox_id,payload,message_id,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'queued',?,?,?)",
      )
      .bind(
        id,
        a.workspaceId,
        draft.brand_id,
        draft.id,
        draft.version,
        draft.mailbox_id,
        payload,
        messageId,
        a.id,
        now,
        now,
      ),
    audit(db, a, "email.queued", id),
  ]);
  return { id, status: "queued" };
}
export async function cancelEmail(db: D1Database, a: Actor, id: string) {
  const job = await db
    .prepare(
      "SELECT brand_id FROM hub_email_delivery WHERE id=? AND workspace_id=?",
    )
    .bind(id, a.workspaceId)
    .first<{ brand_id: string }>();
  if (!job) throw new AccessError(404, "Delivery not found.");
  await requireBrand(db, a, job.brand_id);
  const r = await db.batch([
    db
      .prepare(
        "UPDATE hub_email_delivery SET status='cancelled',lease_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status IN ('queued','preparing')",
      )
      .bind(Date.now(), id),
    db
      .prepare(
        "INSERT INTO hub_audit(id,workspace_id,actor_id,action,target_id,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        a.workspaceId,
        a.id,
        "email.cancelled",
        id,
        Date.now(),
      ),
  ]);
  if (!r[0].meta.changes)
    throw new AccessError(
      409,
      "Submission has already started; cancellation cannot be guaranteed.",
    );
  return { id, status: "cancelled" };
}
export async function retryEmail(
  db: D1Database,
  a: Actor,
  id: string,
  enabled: boolean,
) {
  const job = await db
    .prepare("SELECT * FROM hub_email_delivery WHERE id=? AND workspace_id=?")
    .bind(id, a.workspaceId)
    .first<Delivery>();
  if (!job) throw new AccessError(404, "Delivery not found.");
  await requireBrand(db, a, job.brand_id);
  await emailMailbox(db, a, job.brand_id, job.mailbox_id);
  if (!enabled)
    throw new AccessError(409, "Live email delivery is not enabled.");
  const draft = await db
    .prepare(
      "SELECT version,status FROM hub_email_drafts WHERE id=? AND workspace_id=?",
    )
    .bind(job.draft_id, a.workspaceId)
    .first<{ version: number; status: string }>();
  if (!draft || draft.status !== "draft" || draft.version !== job.draft_version)
    throw new AccessError(
      409,
      "This draft has changed. Send its latest saved version instead.",
    );
  const r = await db.batch([
    db
      .prepare(
        "UPDATE hub_email_delivery SET status='queued',error_message=NULL,lease_id=NULL,lease_until=NULL,created_by=?,updated_at=? WHERE id=? AND workspace_id=? AND status='failed' AND EXISTS(SELECT 1 FROM hub_email_drafts d WHERE d.id=hub_email_delivery.draft_id AND d.version=hub_email_delivery.draft_version AND d.status='draft') AND NOT EXISTS(SELECT 1 FROM hub_email_delivery other WHERE other.draft_id=? AND other.id<>? AND other.status IN ('queued','preparing','submitting','accepted','sent','uncertain'))",
      )
      .bind(a.id, Date.now(), id, a.workspaceId, job.draft_id, id),
    db
      .prepare(
        "INSERT INTO hub_audit(id,workspace_id,actor_id,action,target_id,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        a.workspaceId,
        a.id,
        "email.retried",
        id,
        Date.now(),
      ),
  ]);
  if (!r[0].meta.changes)
    throw new AccessError(
      409,
      "This email cannot be retried. Check its current Outbox status.",
    );
  return { id, status: "queued" };
}
export async function resolveEmail(
  db: D1Database,
  a: Actor,
  d: Record<string, unknown>,
) {
  requireOwner(a);
  if (
    typeof d.accepted !== "boolean" ||
    typeof d.note !== "string" ||
    d.note.trim().length < 10 ||
    d.note.length > 500
  )
    throw new AccessError(
      400,
      "Record how you checked Sent and confirmed the outcome.",
    );
  const r = await db.batch([
    db
      .prepare(
        "UPDATE hub_email_delivery SET status=?,error_message=?,updated_at=? WHERE id=? AND workspace_id=? AND status='uncertain'",
      )
      .bind(
        d.accepted ? "accepted" : "failed",
        "Super admin verification: " + d.note,
        Date.now(),
        d.id,
        a.workspaceId,
      ),
    db
      .prepare(
        "INSERT INTO hub_audit(id,workspace_id,actor_id,action,target_id,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        a.workspaceId,
        a.id,
        "email.outcome_verified",
        d.id,
        Date.now(),
      ),
  ]);
  if (!r[0].meta.changes)
    throw new AccessError(409, "This delivery is not awaiting verification.");
  return { status: d.accepted ? "accepted" : "failed" };
}

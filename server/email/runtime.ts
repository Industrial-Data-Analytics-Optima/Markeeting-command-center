import { prepareStoredOutlook, outlookWritable } from "./preparation.ts";
import { connectionRuntime } from "../connections/runtime.ts";
import type { ConnectionEnvironment } from "../connections/runtime.ts";
import { requireBrand } from "../auth/core.ts";
import { emailMailbox } from "../publishing/email.ts";
import { mailProvider, MailError } from "./providers.ts";
import type { SyncedMail } from "./providers.ts";
import type { Delivery } from "./delivery.ts";
import type { MailAttachment, OutgoingMail } from "./mime.ts";
type Environment = ConnectionEnvironment & {
  MEDIA?: R2Bucket;
  EMAIL_SYNC_ENABLED?: string;
  EMAIL_DELIVERY_ENABLED?: string;
};
export async function importMail(
  db: D1Database,
  mailbox: { id: string; workspace_id: string },
  messages: SyncedMail[],
) {
  const brands = (
    await db
      .prepare(
        "SELECT brand_id FROM hub_connection_brands WHERE connection_id=?",
      )
      .bind(mailbox.id)
      .all<{ brand_id: string }>()
  ).results;
  if (!brands.length) return;
  for (const m of messages) {
    const existing = await db
        .prepare(
          "SELECT id FROM hub_email_messages WHERE mailbox_id=? AND provider_id=?",
        )
        .bind(mailbox.id, m.providerId)
        .first<{ id: string }>(),
      id = existing?.id || crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          "INSERT INTO hub_email_messages(id,workspace_id,brand_id,mailbox_id,provider_id,thread_id,direction,sender,recipients,subject,body,received_at,internet_message_id,reply_to,cc,attachments) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(mailbox_id,provider_id) DO UPDATE SET direction=excluded.direction,sender=excluded.sender,recipients=excluded.recipients,subject=excluded.subject,body=excluded.body,internet_message_id=excluded.internet_message_id,reply_to=excluded.reply_to,cc=excluded.cc,attachments=excluded.attachments",
        )
        .bind(
          id,
          mailbox.workspace_id,
          brands[0].brand_id,
          mailbox.id,
          m.providerId,
          m.threadId,
          m.direction,
          m.sender,
          JSON.stringify(m.to),
          m.subject,
          m.body,
          m.receivedAt,
          m.internetMessageId,
          JSON.stringify(m.replyTo),
          JSON.stringify(m.cc || []),
          JSON.stringify(m.files || []),
        ),
      ...brands.map((b) =>
        db
          .prepare("INSERT OR IGNORE INTO hub_email_message_brands VALUES(?,?)")
          .bind(id, b.brand_id),
      ),
    ]);
    if (m.direction === "outgoing")
      await db
        .prepare(
          "UPDATE hub_email_delivery SET status='sent',provider_id=?,error_message=NULL,updated_at=? WHERE mailbox_id=? AND status IN ('accepted','uncertain') AND (provider_id=? OR message_id=?)",
        )
        .bind(
          m.providerId,
          Date.now(),
          mailbox.id,
          m.providerId,
          m.internetMessageId,
        )
        .run();
  }
}
export async function deliverMail(
  db: D1Database,
  adapter: {
    prepare: (job: Delivery) => Promise<() => Promise<{ id: string | null }>>;
  },
  now = Date.now(),
) {
  await db
    .prepare(
      "UPDATE hub_email_delivery SET status=CASE WHEN status='submitting' THEN 'uncertain' ELSE 'failed' END,error_message=CASE WHEN status='submitting' THEN 'Submission was interrupted. Check Sent before retrying.' ELSE 'Preparation was interrupted. Review the draft before retrying.' END,lease_id=NULL,lease_until=NULL,updated_at=? WHERE status IN ('preparing','submitting') AND lease_until<?",
    )
    .bind(now, now)
    .run();
  const rows = (
    await db
      .prepare(
        "SELECT id FROM hub_email_delivery WHERE status='queued' ORDER BY created_at LIMIT 5",
      )
      .all<{ id: string }>()
  ).results;
  for (const row of rows) {
    const lease = crypto.randomUUID(),
      job = await db
        .prepare(
          "UPDATE hub_email_delivery SET status='preparing',lease_id=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=? AND status='queued' RETURNING *",
        )
        .bind(lease, Date.now() + 120000, Date.now(), row.id)
        .first<Delivery>();
    if (!job) continue;
    let submitting = false;
    try {
      const member = await db
        .prepare(
          "SELECT m.role,u.id FROM hub_members m JOIN hub_users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.user_id=? AND m.active=1",
        )
        .bind(job.workspace_id, job.created_by)
        .first<{ id: string; role: "admin" | "super_admin" }>();
      if (!member)
        throw new MailError(
          false,
          "The sender no longer has workspace access.",
        );
      const a = {
        ...member,
        name: "",
        email: "",
        workspaceId: job.workspace_id,
        workspaceName: "",
        sessionHash: "",
      };
      await requireBrand(db, a, job.brand_id);
      await emailMailbox(db, a, job.brand_id, job.mailbox_id);
      const send = await adapter.prepare(job);
      const current = await db
        .prepare(
          "SELECT m.role,u.id FROM hub_members m JOIN hub_users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.user_id=? AND m.active=1",
        )
        .bind(job.workspace_id, job.created_by)
        .first<{ id: string; role: "admin" | "super_admin" }>();
      if (!current)
        throw new MailError(
          false,
          "The sender no longer has workspace access.",
        );
      const currentActor = {
        ...current,
        name: "",
        email: "",
        workspaceId: job.workspace_id,
        workspaceName: "",
        sessionHash: "",
      };
      await requireBrand(db, currentActor, job.brand_id);
      await emailMailbox(db, currentActor, job.brand_id, job.mailbox_id);
      const claimed = await db
        .prepare(
          "UPDATE hub_email_delivery SET status='submitting',lease_until=?,updated_at=? WHERE id=? AND lease_id=? AND status='preparing' AND lease_until>?",
        )
        .bind(Date.now() + 120000, Date.now(), job.id, lease, Date.now())
        .run();
      if (!claimed.meta.changes) continue;
      submitting = true;
      const result = await send();
      await db
        .prepare(
          "UPDATE hub_email_delivery SET status='accepted',provider_id=?,error_message=NULL,lease_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_id=? AND status='submitting'",
        )
        .bind(result.id, Date.now(), job.id, lease)
        .run();
    } catch (e) {
      const uncertain = e instanceof MailError ? e.uncertain : submitting;
      await db
        .prepare(
          "UPDATE hub_email_delivery SET status=?,error_message=?,lease_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_id=?",
        )
        .bind(
          uncertain ? "uncertain" : "failed",
          e instanceof MailError
            ? e.message
            : submitting
              ? "Submission could not be confirmed. Check Sent before retrying."
              : "Preparation failed. Check mailbox access and attachments.",
          Date.now(),
          job.id,
          lease,
        )
        .run();
    }
  }
}
export async function emailTick(e: Environment) {
  if (!e.DB || !e.TOKEN_VAULT_KEY) return;
  const db = e.DB,
    runtime = await connectionRuntime(e);
  if (e.EMAIL_SYNC_ENABLED === "true") {
    const mailbox = await db
      .prepare(
        "SELECT c.id,c.workspace_id,c.provider,c.label,s.cursor FROM social_connections c LEFT JOIN hub_email_sync s ON s.mailbox_id=c.id WHERE c.provider IN ('google','microsoft') AND EXISTS(SELECT 1 FROM hub_connection_brands b WHERE b.connection_id=c.id) AND (s.checked_at IS NULL OR s.checked_at<?) AND (s.lease_until IS NULL OR s.lease_until<?) ORDER BY COALESCE(s.checked_at,0) LIMIT 1",
      )
      .bind(Date.now() - 60000, Date.now())
      .first<{
        id: string;
        workspace_id: string;
        provider: string;
        label: string;
        cursor: string | null;
      }>();
    if (mailbox) {
      await db
        .prepare(
          "INSERT OR IGNORE INTO hub_email_sync(mailbox_id,workspace_id) VALUES(?,?)",
        )
        .bind(mailbox.id, mailbox.workspace_id)
        .run();
      const lease = crypto.randomUUID(),
        claim = await db
          .prepare(
            "UPDATE hub_email_sync SET lease_until=?,lease_id=?,checked_at=? WHERE mailbox_id=? AND lease_until<?",
          )
          .bind(Date.now() + 180000, lease, Date.now(), mailbox.id, Date.now())
          .run();
      if (claim.meta.changes)
        try {
          const token = await runtime.service.accessToken(
              mailbox.workspace_id,
              mailbox.id,
            ),
            client = mailProvider(mailbox.provider, token, mailbox.label),
            head = await client.list(null),
            back = mailbox.cursor ? await client.list(mailbox.cursor) : head;
          await importMail(db, mailbox, [...back.messages, ...head.messages]);
          await db
            .prepare(
              "UPDATE hub_email_sync SET synced_at=?,cursor=?,error_message=NULL,lease_until=0,lease_id=NULL WHERE mailbox_id=? AND lease_id=?",
            )
            .bind(Date.now(), back.cursor, mailbox.id, lease)
            .run();
        } catch {
          await db
            .prepare(
              "UPDATE hub_email_sync SET error_message='Mailbox sync could not finish. Existing messages are retained. Check the connection if this persists.',lease_until=0,lease_id=NULL WHERE mailbox_id=? AND lease_id=?",
            )
            .bind(mailbox.id, lease)
            .run();
        }
    }
  }
  if (e.EMAIL_DELIVERY_ENABLED === "true")
    await deliverMail(db, {
      async prepare(job) {
        const mailbox = await db
          .prepare(
            "SELECT provider,label,granted_scopes FROM social_connections WHERE id=? AND workspace_id=?",
          )
          .bind(job.mailbox_id, job.workspace_id)
          .first<{ provider: string; label: string; granted_scopes: string }>();
        if (!mailbox) throw new MailError(false, "Mailbox unavailable.");
        const token = await runtime.service.accessToken(
            job.workspace_id,
            job.mailbox_id,
          ),
          payload = JSON.parse(job.payload) as {
            to: string[];
            cc: string[];
            bcc: string[];
            subject: string;
            body: string;
            attachments: string[];
            reply: {
              internet_message_id: string;
              thread_id: string;
              provider_id: string;
            } | null;
          };
        const attachments: MailAttachment[] = [];
        for (const id of payload.attachments) {
          const file = await db
            .prepare(
              "SELECT object_key,name,mime,bytes FROM hub_media WHERE id=? AND workspace_id=? AND brand_id=? UNION ALL SELECT object_key,name,mime,bytes FROM hub_email_files WHERE id=? AND workspace_id=? AND brand_id=?",
            )
            .bind(
              id,
              job.workspace_id,
              job.brand_id,
              id,
              job.workspace_id,
              job.brand_id,
            )
            .first<{
              object_key: string;
              name: string;
              mime: string;
              bytes: number;
            }>();
          if (!file || !e.MEDIA || !(await e.MEDIA.head(file.object_key)))
            throw new MailError(false, "A saved attachment is missing.");
          attachments.push({
            name: file.name,
            mime: file.mime,
            size: file.bytes,
            read: async (offset, length) => {
              const bytes = await e.MEDIA!.get(file.object_key, {
                range: { offset, length },
              });
              if (!bytes) throw new Error("Missing attachment");
              return new Uint8Array(await bytes.arrayBuffer());
            },
          });
        }
        const mail: OutgoingMail = {
          from: mailbox.label,
          to: payload.to,
          cc: payload.cc,
          bcc: payload.bcc,
          subject: payload.subject,
          body: payload.body,
          messageId: job.message_id,
          createdAt: job.created_at,
          replyMessageId: payload.reply?.internet_message_id,
          threadId:
            mailbox.provider === "google"
              ? payload.reply?.thread_id
              : undefined,
          attachments,
        };
        if (
          mailbox.provider === "microsoft" &&
          attachments.reduce((n, f) => n + f.size, 0) > 2 * 1024 * 1024
        ) {
          if (!outlookWritable(mailbox.granted_scopes))
            throw new MailError(
              false,
              "Your super admin needs to reauthorize this Outlook mailbox in Connections for larger attachments.",
            );
          return prepareStoredOutlook(
            db,
            e.TOKEN_VAULT_KEY!,
            job,
            mail,
            token,
            payload.reply?.provider_id,
          );
        }
        return () =>
          mailProvider(mailbox.provider, token, mailbox.label).send(mail);
      },
    });
}

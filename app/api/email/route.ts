import { outlookWritable } from "../../../server/email/preparation";
import { env } from "../../../server/platform";
import { actorFor, listBrands, sameOrigin } from "../../../server/auth/core";
import { database, json, failure, body } from "../../../server/auth/http";
import { saveEmail } from "../../../server/publishing/email";
export async function GET(request: Request) {
  try {
    const db = database(),
      a = await actorFor(db, request),
      brands = (await listBrands(db, a)) as { id: string }[],
      ids = brands.map((b) => b.id),
      marks = ids.map(() => "?").join(",") || "NULL";
    const drafts = (
      await db
        .prepare(
          `SELECT d.*,b.name brand_name,u.name author_name FROM hub_email_drafts d JOIN hub_brands b ON b.id=d.brand_id JOIN hub_users u ON u.id=d.updated_by WHERE d.workspace_id=? AND d.brand_id IN (${marks}) AND d.status='draft' AND NOT EXISTS(SELECT 1 FROM hub_email_delivery j WHERE j.draft_id=d.id AND j.status IN ('queued','preparing','submitting','accepted','sent','uncertain')) ORDER BY d.updated_at DESC LIMIT 500`,
        )
        .bind(a.workspaceId, ...ids)
        .all<{
          recipients: string;
          cc: string;
          bcc: string;
          attachments: string;
        }>()
    ).results.map((d) => ({
      ...d,
      to: JSON.parse(d.recipients),
      cc: JSON.parse(d.cc),
      bcc: JSON.parse(d.bcc),
      attachments: JSON.parse(d.attachments),
    }));
    const mailboxes = (
      await db
        .prepare(
          `SELECT c.id,c.label,c.provider,c.status,c.granted_scopes,b.brand_id FROM social_connections c JOIN hub_connection_brands b ON b.connection_id=c.id WHERE c.workspace_id=? AND c.provider IN ('google','microsoft') AND b.brand_id IN (${marks}) ORDER BY c.label`,
        )
        .bind(a.workspaceId, ...ids)
        .all<{
          id: string;
          label: string;
          provider: string;
          status: string;
          brand_id: string;
          granted_scopes: string;
        }>()
    ).results.map(({ granted_scopes, ...m }) => ({
      ...m,
      largeAttachments:
        m.provider !== "microsoft" || outlookWritable(granted_scopes),
    }));
    const messages = (
      await db
        .prepare(
          `SELECT m.id,mb.brand_id,b.name brand_name,m.mailbox_id,m.thread_id,m.direction,m.sender,m.recipients,m.subject,m.body,m.received_at,m.internet_message_id,m.reply_to,m.cc,m.attachments FROM hub_email_messages m JOIN hub_email_message_brands mb ON mb.message_id=m.id JOIN hub_brands b ON b.id=mb.brand_id JOIN hub_connection_brands cb ON cb.connection_id=m.mailbox_id AND cb.brand_id=mb.brand_id WHERE m.workspace_id=? AND mb.brand_id IN (${marks}) ORDER BY m.received_at DESC LIMIT 500`,
        )
        .bind(a.workspaceId, ...ids)
        .all<{
          recipients: string;
          reply_to: string;
          cc: string;
          attachments: string;
        }>()
    ).results.map((m) => ({
      ...m,
      to: JSON.parse(m.recipients),
      replyTo: JSON.parse(m.reply_to),
      cc: JSON.parse(m.cc),
      files: JSON.parse(m.attachments),
    }));
    const deliveries = (
      await db
        .prepare(
          `SELECT j.id,j.brand_id,j.mailbox_id,j.draft_id,j.draft_version,j.status,j.error_message,j.created_at,j.updated_at,j.payload,b.name brand_name,c.label mailbox FROM hub_email_delivery j JOIN hub_brands b ON b.id=j.brand_id JOIN social_connections c ON c.id=j.mailbox_id WHERE j.workspace_id=? AND j.brand_id IN (${marks}) ORDER BY j.created_at DESC LIMIT 500`,
        )
        .bind(a.workspaceId, ...ids)
        .all<{ payload: string }>()
    ).results.map(({ payload, ...r }) => {
      const p = JSON.parse(payload);
      return { ...r, to: p.to, subject: p.subject };
    });
    const sync = (
      await db
        .prepare(
          `SELECT DISTINCT s.mailbox_id,s.checked_at,s.synced_at,s.error_message,CASE WHEN s.cursor IS NULL THEN 0 ELSE 1 END backfilling FROM hub_email_sync s JOIN hub_connection_brands cb ON cb.connection_id=s.mailbox_id WHERE s.workspace_id=? AND cb.brand_id IN (${marks})`,
        )
        .bind(a.workspaceId, ...ids)
        .all()
    ).results;
    return json({
      drafts,
      mailboxes,
      messages,
      deliveries,
      sync,
      canResolve: a.role === "super_admin",
      deliveryEnabled:
        env.EMAIL_DELIVERY_ENABLED === "true" && !!env.TOKEN_VAULT_KEY,
      syncEnabled: env.EMAIL_SYNC_ENABLED === "true" && !!env.TOKEN_VAULT_KEY,
      limit: 500,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const db = database(),
      a = await actorFor(db, request);
    return json(await saveEmail(db, a, await body(request, 65536)), 201);
  } catch (e) {
    return failure(e);
  }
}

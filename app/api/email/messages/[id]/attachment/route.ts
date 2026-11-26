import { env } from "../../../../../../server/platform";
import {
  actorFor,
  listBrands,
  AccessError,
} from "../../../../../../server/auth/core";
import { database, failure } from "../../../../../../server/auth/http";
import { connectionRuntime } from "../../../../../../server/connections/runtime";
import {
  mailProvider,
  MailError,
} from "../../../../../../server/email/providers";
import type { IncomingFile } from "../../../../../../server/email/providers";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const db = database(),
      a = await actorFor(db, request),
      { id } = await params,
      ids = ((await listBrands(db, a)) as { id: string }[]).map((b) => b.id),
      marks = ids.map(() => "?").join(",") || "NULL";
    const message = await db
      .prepare(
        `SELECT DISTINCT m.provider_id,m.attachments,c.id mailbox_id,c.provider,c.label FROM hub_email_messages m JOIN hub_email_message_brands b ON b.message_id=m.id JOIN hub_connection_brands cb ON cb.brand_id=b.brand_id AND cb.connection_id=m.mailbox_id JOIN social_connections c ON c.id=m.mailbox_id AND c.workspace_id=m.workspace_id WHERE m.id=? AND m.workspace_id=? AND b.brand_id IN (${marks})`,
      )
      .bind(id, a.workspaceId, ...ids)
      .first<{
        provider_id: string;
        attachments: string;
        mailbox_id: string;
        provider: string;
        label: string;
      }>();
    if (!message) throw new AccessError(404, "Message not found.");
    const file = (JSON.parse(message.attachments) as IncomingFile[]).find(
      (f) => f.id === new URL(request.url).searchParams.get("file"),
    );
    if (!file) throw new AccessError(404, "Attachment not found.");
    if (!env.TOKEN_VAULT_KEY)
      throw new AccessError(503, "Mailbox connection is unavailable.");
    const runtime = await connectionRuntime(env),
      token = await runtime.service.accessToken(
        a.workspaceId,
        message.mailbox_id,
      ),
      stream = await mailProvider(
        message.provider,
        token,
        message.label,
      ).download(message.provider_id, file);
    let size = 0;
    const limited = stream.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          size += chunk.length;
          if (size > 20 * 1024 * 1024)
            throw new Error("Attachment exceeds download limit");
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(limited, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition":
          "attachment; filename*=UTF-8''" +
          encodeURIComponent(file.name).replace(
            /[!'()*]/g,
            (c) => "%" + c.charCodeAt(0).toString(16),
          ),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch (e) {
    if (e instanceof MailError)
      return Response.json(
        { message: e.message },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    return failure(e);
  }
}

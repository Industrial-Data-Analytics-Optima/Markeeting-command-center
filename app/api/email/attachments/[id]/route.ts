import { env } from "../../../../../server/platform";
import {
  actorFor,
  requireBrand,
  AccessError,
} from "../../../../../server/auth/core";
import { database, failure } from "../../../../../server/auth/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const db = database(),
      a = await actorFor(db, request),
      { id } = await params,
      file = await db
        .prepare("SELECT * FROM hub_email_files WHERE id=? AND workspace_id=?")
        .bind(id, a.workspaceId)
        .first<{
          brand_id: string;
          object_key: string;
          mime: string;
          name: string;
        }>();
    if (!file) throw new AccessError(404, "File not found.");
    await requireBrand(db, a, file.brand_id);
    const object = await env.MEDIA?.get(file.object_key);
    if (!object) throw new AccessError(404, "File not found.");
    return new Response(object.body, {
      headers: {
        "Content-Type": file.mime,
        "Content-Disposition":
          "attachment; filename*=UTF-8''" + encodeURIComponent(file.name),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch (e) {
    return failure(e);
  }
}

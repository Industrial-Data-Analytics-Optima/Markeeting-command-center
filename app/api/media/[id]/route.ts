import { env } from "../../../../server/platform";
import {
  actorFor,
  requireBrand,
  AccessError,
} from "../../../../server/auth/core";
import { database, failure } from "../../../../server/auth/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const db = database(),
      a = await actorFor(db, request),
      { id } = await params;
    const m = await db
      .prepare(
        "SELECT brand_id,object_key,mime FROM hub_media WHERE id=? AND workspace_id=?",
      )
      .bind(id, a.workspaceId)
      .first<{ brand_id: string; object_key: string; mime: string }>();
    if (!m) throw new AccessError(404, "Image not found.");
    await requireBrand(db, a, m.brand_id);
    const obj = await env.MEDIA?.get(
      m.object_key,
      request.headers.has("range") ? { range: request.headers } : undefined,
    );
    if (!obj) throw new AccessError(404, "Image not found.");
    return new Response(request.method === "HEAD" ? null : obj.body, {
      status: request.headers.has("range") && obj.range ? 206 : 200,
      headers: {
        "Content-Type": m.mime,
        "Accept-Ranges": "bytes",
        "Content-Length": String(
          obj.range && "length" in obj.range ? obj.range.length : obj.size,
        ),
        ...(request.headers.has("range") && obj.range && "offset" in obj.range
          ? {
              "Content-Range": `bytes ${obj.range.offset}-${obj.range.offset! + obj.range.length! - 1}/${obj.size}`,
            }
          : {}),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch (e) {
    return failure(e);
  }
}

export const HEAD = GET;

import { inspectVideo } from "../../../server/publishing/video";
import { env } from "../../../server/platform";
import { actorFor, requireBrand, AccessError } from "../../../server/auth/core";
import { database, json, failure } from "../../../server/auth/http";
import { inspectImage, readLimited } from "../../../server/publishing/media";
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new AccessError(403, "Upload from your workspace.");
    const db = database(),
      a = await actorFor(db, request),
      brand = request.headers.get("x-brand-id") || "";
    await requireBrand(db, a, brand);
    if (!env.MEDIA)
      throw new AccessError(
        503,
        "Media storage is not available. You can still save a text draft.",
      );
    const mime = request.headers.get("content-type") || "";
    if (!["image/png", "image/jpeg", "video/mp4"].includes(mime))
      throw new AccessError(400, "Choose a JPEG, PNG or H.264 MP4 video.");
    if (process.env.VERCEL && mime === "video/mp4")
      throw new AccessError(
        503,
        "Video uploads are unavailable on this host until durable direct uploads are implemented.",
      );
    const bytes = await readLimited(
        request,
        mime === "video/mp4"
          ? 25 * 1024 * 1024
          : (process.env.VERCEL ? 4 : 5) * 1024 * 1024,
      ),
      size =
        mime === "video/mp4"
          ? inspectVideo(bytes)
          : { ...inspectImage(bytes, mime), duration: null },
      id = crypto.randomUUID(),
      key = a.workspaceId + "/" + brand + "/" + id;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime } });
    try {
      await db
        .prepare(
          "INSERT INTO hub_media(id,workspace_id,brand_id,object_key,mime,bytes,width,height,created_by,created_at,duration) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          a.workspaceId,
          brand,
          key,
          mime,
          bytes.length,
          size.width,
          size.height,
          a.id,
          Date.now(),
          size.duration,
        )
        .run();
    } catch (e) {
      await env.MEDIA.delete(key);
      throw e;
    }
    return json({ id, ...size }, 201);
  } catch (e) {
    return failure(e);
  }
}

import { env } from "../../../../server/platform";
import {
  actorFor,
  requireBrand,
  listBrands,
  AccessError,
} from "../../../../server/auth/core";
import { database, json, failure } from "../../../../server/auth/http";
import { readLimited } from "../../../../server/publishing/media";
import { inspectEmailFile } from "../../../../server/publishing/email-files";
export async function GET(request: Request) {
  try {
    const db = database(),
      a = await actorFor(db, request),
      ids = ((await listBrands(db, a)) as { id: string }[]).map((b) => b.id),
      marks = ids.map(() => "?").join(",") || "NULL";
    return json({
      files: (
        await db
          .prepare(
            `SELECT id,brand_id,name,mime,bytes FROM hub_email_files WHERE workspace_id=? AND brand_id IN (${marks}) ORDER BY created_at DESC LIMIT 500`,
          )
          .bind(a.workspaceId, ...ids)
          .all()
      ).results,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new AccessError(403, "Upload from your workspace.");
    const db = database(),
      a = await actorFor(db, request),
      brand = request.headers.get("x-brand-id") || "";
    await requireBrand(db, a, brand);
    if (!env.MEDIA) throw new AccessError(503, "File storage is unavailable.");
    let name: string;
    try {
      name = decodeURIComponent(request.headers.get("x-file-name") || "");
    } catch {
      throw new AccessError(400, "Choose a valid file name.");
    }
    const bytes = await readLimited(request, 20 * 1024 * 1024),
      mime = inspectEmailFile(name, bytes),
      id = crypto.randomUUID(),
      key = a.workspaceId + "/" + brand + "/email/" + id;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime } });
    try {
      await db
        .prepare("INSERT INTO hub_email_files VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(
          id,
          a.workspaceId,
          brand,
          key,
          name,
          mime,
          bytes.length,
          a.id,
          Date.now(),
        )
        .run();
    } catch (e) {
      await env.MEDIA.delete(key);
      throw e;
    }
    return json({ id, brand_id: brand, name, mime, bytes: bytes.length }, 201);
  } catch (e) {
    return failure(e);
  }
}

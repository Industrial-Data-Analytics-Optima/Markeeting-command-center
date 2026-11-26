import { AccessError, requireBrand } from "../auth/core.ts";
import type { Actor } from "../auth/core.ts";
import { VIDEO_MAX, inspectStoredVideo } from "./video.ts";
export const PART_SIZE = 8 * 1024 * 1024;
type Upload = {
  id: string;
  workspace_id: string;
  brand_id: string;
  created_by: string;
  object_key: string;
  upload_id: string;
  name: string;
  bytes: number;
  status: string;
  updated_at: number;
  expires_at: number;
};
export async function uploadSession(db: D1Database, a: Actor, id: string) {
  const u = await db
    .prepare(
      "SELECT * FROM hub_media_uploads WHERE id=? AND workspace_id=? AND created_by=?",
    )
    .bind(id, a.workspaceId, a.id)
    .first<Upload>();
  if (!u) throw new AccessError(404, "Upload not found.");
  await requireBrand(db, a, u.brand_id);
  if (u.expires_at < Date.now() && u.status !== "complete")
    throw new AccessError(
      410,
      "This upload expired. Please upload the file again.",
    );
  return u;
}
export async function startUpload(
  db: D1Database,
  bucket: R2Bucket,
  a: Actor,
  d: Record<string, unknown>,
) {
  if (typeof d.brandId !== "string")
    throw new AccessError(400, "Choose a brand.");
  await requireBrand(db, a, d.brandId);
  if (
    typeof d.size !== "number" ||
    !Number.isSafeInteger(d.size) ||
    d.size < 75000 ||
    d.size > VIDEO_MAX
  )
    throw new AccessError(400, "Videos must be 75 KB to 500 MB.");
  if (typeof d.name !== "string" || !d.name.trim() || d.name.length > 180)
    throw new AccessError(400, "Choose a file with a valid name.");
  const id = crypto.randomUUID(),
    key = a.workspaceId + "/" + d.brandId + "/" + id,
    upload = await bucket.createMultipartUpload(key, {
      httpMetadata: { contentType: "video/mp4" },
    });
  try {
    await db
      .prepare("INSERT INTO hub_media_uploads VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .bind(
        id,
        a.workspaceId,
        d.brandId,
        a.id,
        key,
        upload.uploadId,
        d.name,
        d.size,
        "uploading",
        Date.now(),
        Date.now() + 86400000,
      )
      .run();
  } catch (e) {
    await upload.abort();
    throw e;
  }
  return { id, partSize: PART_SIZE };
}
export function partLength(size: number, part: number) {
  const count = Math.ceil(size / PART_SIZE);
  if (!Number.isInteger(part) || part < 1 || part > count)
    throw new AccessError(400, "Invalid upload part.");
  return Math.min(PART_SIZE, size - (part - 1) * PART_SIZE);
}
export async function putPart(
  db: D1Database,
  bucket: R2Bucket,
  a: Actor,
  id: string,
  part: number,
  bytes: Uint8Array,
) {
  const u = await uploadSession(db, a, id);
  if (u.status !== "uploading")
    throw new AccessError(409, "This upload is no longer accepting parts.");
  if (bytes.length !== partLength(u.bytes, part))
    throw new AccessError(400, "Upload part size does not match the file.");
  const saved = await bucket
    .resumeMultipartUpload(u.object_key, u.upload_id)
    .uploadPart(part, bytes);
  await db
    .prepare(
      "INSERT INTO hub_media_upload_parts VALUES(?,?,?) ON CONFLICT(upload_id,part_number) DO UPDATE SET etag=excluded.etag",
    )
    .bind(id, part, saved.etag)
    .run();
  return { partNumber: part };
}
export async function finishUpload(
  db: D1Database,
  bucket: R2Bucket,
  a: Actor,
  id: string,
) {
  const u = await uploadSession(db, a, id);
  if (u.status === "complete") return { id };
  if (!["uploading", "finalizing"].includes(u.status))
    throw new AccessError(409, "This upload is no longer active.");
  const locked = await db
    .prepare(
      "UPDATE hub_media_uploads SET status='finalizing',updated_at=? WHERE id=? AND (status='uploading' OR (status='finalizing' AND updated_at<?))",
    )
    .bind(Date.now(), id, Date.now() - 120000)
    .run();
  if (!locked.meta.changes)
    throw new AccessError(
      409,
      "This video is still being validated. Retry shortly.",
    );
  try {
    let object = await bucket.head(u.object_key);
    if (!object) {
      const parts = (
        await db
          .prepare(
            "SELECT part_number AS partNumber,etag FROM hub_media_upload_parts WHERE upload_id=? ORDER BY part_number",
          )
          .bind(id)
          .all<{ partNumber: number; etag: string }>()
      ).results;
      if (
        parts.length !== Math.ceil(u.bytes / PART_SIZE) ||
        parts.some((p, i) => p.partNumber !== i + 1)
      )
        throw new AccessError(
          409,
          "Some video parts are missing. Retry the upload.",
        );
      object = await bucket
        .resumeMultipartUpload(u.object_key, u.upload_id)
        .complete(parts);
    }
    if (object.size !== u.bytes)
      throw new AccessError(
        400,
        "Uploaded video size does not match the selected file.",
      );
    const size = await inspectStoredVideo(
      object.size,
      async (offset, length) => {
        const r = await bucket.get(u.object_key, { range: { offset, length } });
        if (!r) throw new Error("Missing uploaded object");
        return new Uint8Array(await r.arrayBuffer());
      },
    );
    await db.batch([
      db
        .prepare(
          "INSERT OR IGNORE INTO hub_media(id,workspace_id,brand_id,object_key,mime,bytes,width,height,created_by,created_at,duration,name) VALUES(?,?,?,?,'video/mp4',?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          a.workspaceId,
          u.brand_id,
          u.object_key,
          u.bytes,
          size.width,
          size.height,
          a.id,
          Date.now(),
          size.duration,
          u.name,
        ),
      db
        .prepare(
          "UPDATE hub_media_uploads SET status='complete',updated_at=? WHERE id=?",
        )
        .bind(Date.now(), id),
    ]);
    return { id, ...size };
  } catch (e) {
    if (e instanceof AccessError && e.status === 400) {
      await bucket.delete(u.object_key);
      await db
        .prepare("UPDATE hub_media_uploads SET status='failed' WHERE id=?")
        .bind(id)
        .run();
    } else {
      await db
        .prepare("UPDATE hub_media_uploads SET status='uploading' WHERE id=?")
        .bind(id)
        .run();
    }
    throw e;
  }
}
export async function abortUpload(
  db: D1Database,
  bucket: R2Bucket,
  a: Actor,
  id: string,
) {
  const u = await uploadSession(db, a, id);
  if (u.status === "complete" || u.status === "finalizing")
    throw new AccessError(409, "This upload is already finalizing or saved.");
  await bucket.resumeMultipartUpload(u.object_key, u.upload_id).abort();
  await bucket.delete(u.object_key);
  await db
    .prepare("UPDATE hub_media_uploads SET status='aborted' WHERE id=?")
    .bind(id)
    .run();
  return { id };
}

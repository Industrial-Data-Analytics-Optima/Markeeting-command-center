import { actorFor, listBrands, sameOrigin } from "../../../server/auth/core";
import { database, json, failure, body } from "../../../server/auth/http";
import { updateAsset } from "../../../server/publishing/library";
export async function GET(request: Request) {
  try {
    const db = database(),
      a = await actorFor(db, request),
      brands = (await listBrands(db, a)) as { id: string }[],
      ids = brands.map((b) => b.id),
      marks = ids.map(() => "?").join(",") || "NULL";
    const assets = (
      await db
        .prepare(
          `SELECT m.id,m.brand_id,m.name,m.folder,m.alt_text,m.archived,m.version,m.mime,m.duration,m.bytes,m.width,m.height,m.created_at,b.name brand_name FROM hub_media m JOIN hub_brands b ON b.id=m.brand_id WHERE m.workspace_id=? AND m.brand_id IN (${marks}) ORDER BY m.created_at DESC LIMIT 1000`,
        )
        .bind(a.workspaceId, ...ids)
        .all()
    ).results;
    return json({
      assets,
      limit: 1000,
      videoUploadsAvailable: !process.env.VERCEL,
      imageMaxMB: process.env.VERCEL ? 4 : 5,
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
    return json(await updateAsset(db, a, await body(request)));
  } catch (e) {
    return failure(e);
  }
}

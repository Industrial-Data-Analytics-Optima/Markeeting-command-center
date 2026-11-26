import { env } from "../../../../server/platform";
import {
  actorFor,
  sameOrigin,
  AccessError,
} from "../../../../server/auth/core";
import { database, json, failure, body } from "../../../../server/auth/http";
import {
  startUpload,
  finishUpload,
  abortUpload,
} from "../../../../server/publishing/multipart";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const db = database(),
      a = await actorFor(db, request);
    if (process.env.VERCEL)
      throw new AccessError(
        503,
        "Large video uploads are unavailable on this host until durable direct uploads are implemented.",
      );
    if (!env.MEDIA) throw new AccessError(503, "Media storage is unavailable.");
    const d = await body(request);
    if (d.action === "complete")
      return json(await finishUpload(db, env.MEDIA, a, String(d.id)));
    if (d.action === "abort")
      return json(await abortUpload(db, env.MEDIA, a, String(d.id)));
    if (d.action !== "start")
      throw new AccessError(400, "Invalid upload action.");
    return json(await startUpload(db, env.MEDIA, a, d), 201);
  } catch (e) {
    return failure(e);
  }
}

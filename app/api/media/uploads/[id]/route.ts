import { env } from "../../../../../server/platform";
import { actorFor, AccessError } from "../../../../../server/auth/core";
import { database, json, failure } from "../../../../../server/auth/http";
import {
  putPart,
  PART_SIZE,
  uploadSession,
} from "../../../../../server/publishing/multipart";
import { readLimited } from "../../../../../server/publishing/media";
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new AccessError(403, "Upload from your workspace.");
    if (request.headers.get("content-type") !== "application/octet-stream")
      throw new AccessError(415, "Send a binary upload part.");
    const db = database(),
      a = await actorFor(db, request),
      { id } = await params;
    if (process.env.VERCEL)
      throw new AccessError(
        503,
        "Large video uploads are unavailable on this host.",
      );
    if (!env.MEDIA) throw new AccessError(503, "Media storage is unavailable.");
    await uploadSession(db, a, id);
    return json(
      await putPart(
        db,
        env.MEDIA,
        a,
        id,
        Number(new URL(request.url).searchParams.get("part")),
        await readLimited(request, PART_SIZE),
      ),
    );
  } catch (e) {
    return failure(e);
  }
}

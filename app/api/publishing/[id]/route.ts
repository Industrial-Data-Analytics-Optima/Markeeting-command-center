import {
  actorFor,
  sameOrigin,
  requireBrand,
  AccessError,
} from "../../../../server/auth/core";
import { database, json, failure, body } from "../../../../server/auth/http";
import { cancelPost } from "../../../../server/publishing/posts";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const db = database(),
      a = await actorFor(db, request),
      { id } = await params;
    const post = await db
      .prepare("SELECT brand_id FROM hub_posts WHERE id=? AND workspace_id=?")
      .bind(id, a.workspaceId)
      .first<{ brand_id: string }>();
    if (!post) throw new AccessError(404, "Post not found.");
    await requireBrand(db, a, post.brand_id);
    return json({
      events: (
        await db
          .prepare(
            "SELECT status,message,created_at FROM hub_post_events WHERE post_id=? ORDER BY created_at DESC",
          )
          .bind(id)
          .all()
      ).results,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const db = database(),
      a = await actorFor(db, request),
      { version } = await body(request);
    if (typeof version !== "number" || !Number.isSafeInteger(version))
      throw new AccessError(400, "Reload the current post version.");
    await cancelPost(db, a, (await params).id, version);
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

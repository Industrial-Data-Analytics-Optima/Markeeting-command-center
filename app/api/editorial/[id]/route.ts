import { actorFor, sameOrigin } from "../../../../server/auth/core";
import { database, json, failure, body } from "../../../../server/auth/http";
import {
  editorialPost,
  editorialAction,
  reviewers,
} from "../../../../server/publishing/editorial";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const db = database(),
      a = await actorFor(db, request),
      post = await editorialPost(db, a, (await params).id);
    return json({
      post,
      reviewers: await reviewers(db, a, post),
      comments: (
        await db
          .prepare(
            "SELECT c.id,c.body,c.created_at,u.name AS author_name FROM hub_editorial_comments c JOIN hub_users u ON u.id=c.author_id WHERE c.post_id=? AND c.workspace_id=? ORDER BY c.created_at",
          )
          .bind(post.id, a.workspaceId)
          .all()
      ).results,
      events: (
        await db
          .prepare(
            "SELECT id,status,message,created_at FROM hub_post_events WHERE post_id=? ORDER BY created_at DESC",
          )
          .bind(post.id)
          .all()
      ).results,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const db = database(),
      a = await actorFor(db, request);
    await editorialAction(db, a, (await params).id, await body(request));
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

import { requireBrand } from "../auth/core.ts";
import type { Actor } from "../auth/core.ts";
import { DeliveryError } from "./linkedin.ts";
import type { PostRow } from "./posts.ts";
export type DeliveryAdapter = {
  prepare(post: PostRow): Promise<string | null>;
  publish(post: PostRow, image: string | null): Promise<string>;
};
export async function deliverDue(
  db: D1Database,
  adapter: DeliveryAdapter,
  now = Date.now(),
) {
  // An expired submission lease is ambiguous. Never send it automatically a second time.
  await db
    .prepare(
      "UPDATE hub_posts SET status=CASE WHEN stage='submitting' THEN 'uncertain' ELSE 'scheduled' END,error_message=CASE WHEN stage='submitting' THEN 'Delivery was interrupted after submission began. Check LinkedIn before taking further action.' ELSE 'Delivery preparation was interrupted. Retrying.' END,lease_id=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE status='processing' AND lease_until<?",
    )
    .bind(now, now)
    .run();
  const due = (
    await db
      .prepare(
        "SELECT id FROM hub_posts WHERE status='scheduled' AND scheduled_at<=? AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY scheduled_at LIMIT 10",
      )
      .bind(now, now)
      .all<{ id: string }>()
  ).results;
  let handled = 0;
  for (const item of due) {
    const lease = crypto.randomUUID();
    const post = await db
      .prepare(
        "UPDATE hub_posts SET status='processing',stage='preparing',lease_id=?,lease_until=?,attempts=attempts+1,version=version+1,updated_at=? WHERE id=? AND status='scheduled' RETURNING *",
      )
      .bind(lease, now + 600000, now, item.id)
      .first<PostRow>();
    if (!post) continue;
    let submitting = false;
    try {
      if (
        post.review_mode === "approval" &&
        !["none", "approved"].includes(post.editorial_status)
      )
        throw new DeliveryError(
          "failed",
          "This version needs editorial approval before delivery.",
          "REVIEW_REQUIRED",
        );
      const member = await db
        .prepare(
          "SELECT u.id,u.name,u.email,m.role FROM hub_members m JOIN hub_users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.user_id=? AND m.active=1",
        )
        .bind(post.workspace_id, post.created_by)
        .first<{
          id: string;
          name: string;
          email: string;
          role: Actor["role"];
        }>();
      if (!member)
        throw new DeliveryError(
          "failed",
          "The author no longer has workspace access. An authorized teammate must review and reschedule.",
          "AUTHOR_ACCESS",
        );
      try {
        await requireBrand(
          db,
          {
            ...member,
            workspaceId: post.workspace_id,
            workspaceName: "",
            sessionHash: "",
          },
          post.brand_id,
        );
      } catch {
        throw new DeliveryError(
          "failed",
          "The author no longer has access to this brand.",
          "AUTHOR_ACCESS",
        );
      }
      const image = await adapter.prepare(post);
      const started = await db
        .prepare(
          "UPDATE hub_posts SET stage='submitting',provider_image_id=? WHERE id=? AND lease_id=? AND status='processing' AND lease_until>?",
        )
        .bind(image, post.id, lease, Date.now())
        .run();
      if (!started.meta.changes) continue;
      submitting = true;
      const remoteId = await adapter.publish(post, image);
      // If committing this response fails, the lease reaper leaves the post uncertain rather than retrying.
      await db.batch([
        db
          .prepare(
            "UPDATE hub_posts SET status='published',provider_post_id=?,published_at=?,updated_at=?,error_code=NULL,error_message=NULL,lease_id=NULL,lease_until=NULL,version=version+1 WHERE id=? AND lease_id=? AND status='processing'",
          )
          .bind(remoteId, Date.now(), Date.now(), post.id, lease),
        db
          .prepare(
            "INSERT INTO hub_post_events(id,post_id,status,message,created_at) SELECT ?,?,'published','LinkedIn confirmed publication.',? WHERE changes()=1",
          )
          .bind(crypto.randomUUID(), post.id, Date.now()),
      ]);
      handled++;
    } catch (error) {
      const e =
        error instanceof DeliveryError
          ? error
          : new DeliveryError(
              submitting ? "uncertain" : "retry",
              submitting
                ? "The publication result could not be recorded. Check LinkedIn before taking further action."
                : "Delivery preparation could not finish. We will retry.",
            );
      const status =
        e.kind === "retry"
          ? post.attempts >= 5
            ? "failed"
            : "scheduled"
          : e.kind;
      const message =
        post.attempts >= 5 && e.kind === "retry"
          ? "Delivery stopped after five attempts. Review the connection and reschedule."
          : e.message;
      await db.batch([
        db
          .prepare(
            "UPDATE hub_posts SET status=?,error_code=?,error_message=?,next_attempt_at=?,lease_id=NULL,lease_until=NULL,updated_at=?,version=version+1 WHERE id=? AND lease_id=? AND status=?",
          )
          .bind(
            status,
            e.code,
            message,
            Date.now() +
              Math.max(
                e.retryMs,
                Math.min(3600000, 60000 * 2 ** (post.attempts - 1)),
              ),
            Date.now(),
            post.id,
            lease,
            "processing",
          ),
        db
          .prepare(
            "INSERT INTO hub_post_events(id,post_id,status,message,created_at) SELECT ?,?,?,?,? WHERE changes()=1",
          )
          .bind(crypto.randomUUID(), post.id, status, message, Date.now()),
      ]);
    }
  }
  return handled;
}

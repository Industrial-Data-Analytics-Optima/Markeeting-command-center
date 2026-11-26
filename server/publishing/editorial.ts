import { AccessError, requireBrand } from "../auth/core.ts";
import type { Actor } from "../auth/core.ts";
export type EditorialPost = {
  id: string;
  workspace_id: string;
  brand_id: string;
  status: string;
  text: string;
  version: number;
  editorial_status: string;
  review_mode: "feedback" | "approval";
  reviewer_id: string | null;
  submitted_by: string | null;
  edited_by: string | null;
  created_by: string;
  planned_at: number | null;
};
export function plannedTime(value: unknown) {
  if (value === null || value === "" || value === undefined) return null;
  if (typeof value !== "string")
    throw new AccessError(400, "Choose a valid planning date.");
  const n = Date.parse(value);
  if (
    !Number.isFinite(n) ||
    n < Date.UTC(2000, 0, 1) ||
    n > Date.UTC(2100, 0, 1)
  )
    throw new AccessError(400, "Choose a valid planning date.");
  return n;
}
export function reviewAfterEdit(previous: string, changed: boolean) {
  return changed && previous !== "none" ? "changes_requested" : previous;
}
export async function editorialPost(db: D1Database, a: Actor, id: string) {
  const p = await db
    .prepare("SELECT * FROM hub_posts WHERE id=? AND workspace_id=?")
    .bind(id, a.workspaceId)
    .first<EditorialPost>();
  if (!p) throw new AccessError(404, "Post not found.");
  await requireBrand(db, a, p.brand_id);
  return p;
}
export async function reviewers(db: D1Database, a: Actor, post: EditorialPost) {
  return (
    await db
      .prepare(
        "SELECT u.id,u.name,u.email,m.role FROM hub_members m JOIN hub_users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.active=1 AND u.id<>? AND u.id<>? AND (m.role='super_admin' OR EXISTS(SELECT 1 FROM hub_brand_access b WHERE b.workspace_id=m.workspace_id AND b.user_id=m.user_id AND b.brand_id=?)) ORDER BY u.name",
      )
      .bind(
        a.workspaceId,
        a.id,
        post.edited_by || post.created_by,
        post.brand_id,
      )
      .all()
  ).results;
}
export async function editorialAction(
  db: D1Database,
  a: Actor,
  id: string,
  input: Record<string, unknown>,
  now = Date.now(),
) {
  const post = await editorialPost(db, a, id),
    action = input.action,
    note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 2000)
    throw new AccessError(400, "Keep comments under 2,000 characters.");
  if (action === "comment") {
    if (!note) throw new AccessError(400, "Write a comment first.");
    await db
      .prepare(
        "INSERT INTO hub_editorial_comments(id,workspace_id,post_id,author_id,body,created_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(crypto.randomUUID(), a.workspaceId, id, a.id, note, now)
      .run();
    return;
  }
  if (input.version !== post.version)
    throw new AccessError(
      409,
      "This post changed. Reload it before continuing.",
    );
  if (post.status !== "draft")
    throw new AccessError(
      409,
      "Only drafts can enter editorial review. Cancel delivery and save as a draft first.",
    );
  let statement: D1PreparedStatement, message: string;
  if (action === "plan") {
    const planned = plannedTime(input.plannedAt);
    statement = db
      .prepare(
        "UPDATE hub_posts SET planned_at=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=? AND status='draft'",
      )
      .bind(planned, now, id, a.workspaceId, post.version);
    message = planned
      ? "Planning date updated. This does not schedule delivery."
      : "Planning date removed.";
  } else if (action === "withdraw") {
    if (post.editorial_status === "none")
      throw new AccessError(409, "There is no review to cancel.");
    if (
      a.role !== "super_admin" &&
      ![
        post.created_by,
        post.edited_by,
        post.submitted_by,
        post.reviewer_id,
      ].includes(a.id)
    )
      throw new AccessError(
        403,
        "Only a participant in this review can cancel it.",
      );
    statement = db
      .prepare(
        "UPDATE hub_posts SET review_decision=NULL,editorial_status='none',review_mode='feedback',reviewer_id=NULL,submitted_by=NULL,reviewed_by=NULL,reviewed_at=NULL,review_note=NULL,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=? AND status='draft'",
      )
      .bind(now, id, a.workspaceId, post.version);
    message = `${a.name} cancelled the ${post.review_mode === "approval" ? "approval hold" : "feedback request"}. This draft can be scheduled without a review.${note ? " " + note : ""}`;
  } else if (action === "submit" || action === "reassign") {
    const reassign = action === "reassign";
    const mode = reassign
      ? post.review_mode
      : input.reviewMode === undefined
        ? "feedback"
        : input.reviewMode;
    if (!["feedback", "approval"].includes(String(mode)))
      throw new AccessError(400, "Choose feedback or approval.");
    if (
      reassign &&
      (post.editorial_status !== "in_review" ||
        (a.role !== "super_admin" &&
          ![
            post.created_by,
            post.edited_by,
            post.submitted_by,
            post.reviewer_id,
          ].includes(a.id)))
    )
      throw new AccessError(
        403,
        "Only a participant can reassign an active review.",
      );
    if (!post.text.trim())
      throw new AccessError(
        400,
        "Add post content before requesting a review.",
      );
    if (
      !reassign &&
      !["none", "changes_requested"].includes(post.editorial_status)
    )
      throw new AccessError(409, "This post is already in review or approved.");
    if (
      typeof input.reviewerId !== "string" ||
      input.reviewerId === a.id ||
      input.reviewerId === (post.edited_by || post.created_by) ||
      (reassign && input.reviewerId === post.submitted_by)
    )
      throw new AccessError(
        400,
        "Choose someone other than the author to review this post.",
      );
    const allowed = (await reviewers(db, a, post)) as {
      id: string;
      name: string;
    }[];
    const reviewer = allowed.find((u) => u.id === input.reviewerId);
    if (!reviewer)
      throw new AccessError(
        403,
        "That reviewer does not have active access to this brand.",
      );
    statement = db
      .prepare(
        "UPDATE hub_posts SET review_decision=NULL,editorial_status='in_review',review_mode=?,reviewer_id=?,submitted_by=?,reviewed_by=NULL,reviewed_at=NULL,review_note=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=? AND status='draft'",
      )
      .bind(
        mode,
        reviewer.id,
        reassign ? post.submitted_by : a.id,
        note || null,
        now,
        id,
        a.workspaceId,
        post.version,
      );
    message = `${a.name} ${reassign ? "reassigned" : "requested"} ${mode === "approval" ? "approval (publishing held)" : "feedback (publishing allowed)"} ${reassign ? "to" : "from"} ${reviewer.name}.${note ? " " + note : ""}`;
  } else if (
    action === "approve" ||
    action === "request_changes" ||
    action === "reject"
  ) {
    if (post.editorial_status !== "in_review")
      throw new AccessError(409, "This post is not awaiting a review.");
    if (
      a.id === post.submitted_by ||
      a.id === (post.edited_by || post.created_by)
    )
      throw new AccessError(
        403,
        "You cannot approve or review your own submission.",
      );
    if (a.role !== "super_admin" && a.id !== post.reviewer_id)
      throw new AccessError(
        403,
        "Only the assigned reviewer or another super admin can decide this review.",
      );
    if (["request_changes", "reject"].includes(String(action)) && !note)
      throw new AccessError(400, "Explain what needs to change.");
    statement = db
      .prepare(
        "UPDATE hub_posts SET editorial_status=?,review_decision=?,reviewed_by=?,reviewed_at=?,review_note=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=? AND status='draft' AND editorial_status='in_review'",
      )
      .bind(
        action === "approve" ? "approved" : "changes_requested",
        action === "approve"
          ? "approved"
          : action === "reject"
            ? "rejected"
            : "changes_requested",
        a.id,
        now,
        note || null,
        now,
        id,
        a.workspaceId,
        post.version,
      );
    message = `${a.name} ${action === "approve" ? "approved this version" : action === "reject" ? "rejected this version" : "requested changes"}.${note ? " " + note : ""}`;
  } else throw new AccessError(400, "Unknown editorial action.");
  const result = await db.batch([
    statement,
    db
      .prepare(
        "INSERT INTO hub_post_events(id,post_id,status,message,created_at) SELECT ?,?,?,?,? WHERE changes()=1",
      )
      .bind(crypto.randomUUID(), id, "editorial", message, now),
  ]);
  if (!result[0].meta.changes)
    throw new AccessError(
      409,
      "This post changed. Reload it before continuing.",
    );
}

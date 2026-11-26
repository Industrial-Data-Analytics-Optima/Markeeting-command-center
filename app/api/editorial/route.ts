import { actorFor, listBrands, AccessError } from "../../../server/auth/core";
import { database, json, failure } from "../../../server/auth/http";
export async function GET(request: Request) {
  try {
    const db = database(),
      a = await actorFor(db, request),
      url = new URL(request.url),
      brands = (await listBrands(db, a)) as { id: string; name: string }[],
      ids = brands.map((b) => b.id),
      marks = ids.map(() => "?").join(",") || "NULL",
      review = url.searchParams.get("view") === "reviews";
    let condition = "(p.editorial_status<>'none' OR p.status='draft')",
      values: (number | string)[] = [];
    if (!review) {
      const start = Number(url.searchParams.get("start")),
        end = Number(url.searchParams.get("end"));
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start ||
        end - start > 62 * 86400000
      )
        throw new AccessError(400, "Choose a calendar range of up to 62 days.");
      condition =
        "(COALESCE(p.published_at,p.scheduled_at,p.planned_at) >= ? AND COALESCE(p.published_at,p.scheduled_at,p.planned_at) < ?)";
      values = [start, end];
    }
    const select = `SELECT p.*,b.name AS brand_name,l.name AS page_name,u.name AS author_name,r.name AS reviewer_name FROM hub_posts p JOIN hub_brands b ON b.id=p.brand_id LEFT JOIN hub_linkedin_pages l ON l.id=p.page_id AND l.workspace_id=p.workspace_id AND l.brand_id=p.brand_id AND l.enabled=1 LEFT JOIN hub_users u ON u.id=COALESCE(p.edited_by,p.created_by) LEFT JOIN hub_users r ON r.id=p.reviewer_id WHERE p.workspace_id=? AND p.brand_id IN (${marks}) AND `;
    const posts = (
      await db
        .prepare(select + condition + " ORDER BY p.updated_at DESC LIMIT 1000")
        .bind(a.workspaceId, ...ids, ...values)
        .all()
    ).results;
    const undated = review
      ? []
      : (
          await db
            .prepare(
              select +
                "p.status='draft' AND p.planned_at IS NULL ORDER BY p.updated_at DESC LIMIT 100",
            )
            .bind(a.workspaceId, ...ids)
            .all()
        ).results;
    return json({
      posts,
      undated,
      userId: a.id,
      role: a.role,
      limit: 1000,
      undatedLimit: 100,
    });
  } catch (e) {
    return failure(e);
  }
}

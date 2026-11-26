import {
  actorFor,
  requireOwner,
  requireBrand,
  sameOrigin,
  AccessError,
  audit,
} from "../../../../server/auth/core";
import { database, json, failure, body } from "../../../../server/auth/http";
export async function GET(request: Request) {
  try {
    const db = database(),
      a = await actorFor(db, request);
    requireOwner(a);
    return json({
      pages: (
        await db
          .prepare(
            "SELECT id,name,organization_urn,brand_id,enabled FROM hub_linkedin_pages WHERE workspace_id=? ORDER BY name",
          )
          .bind(a.workspaceId)
          .all()
      ).results,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const db = database(),
      a = await actorFor(db, request);
    requireOwner(a);
    const data = await body(request);
    if (data.all) {
      if (typeof data.brandId !== "string")
        throw new AccessError(400, "Choose a brand.");
      await requireBrand(db, a, data.brandId);
      await db
        .prepare(
          "UPDATE hub_linkedin_pages SET brand_id=?,enabled=1 WHERE workspace_id=? AND brand_id IS NULL AND enabled=0",
        )
        .bind(data.brandId, a.workspaceId)
        .run();
      await audit(db, a, "linkedin.pages_assigned", data.brandId);
      return json({ ok: true });
    }
    if (typeof data.id !== "string")
      throw new AccessError(400, "Choose a page.");
    if (data.brandId && typeof data.brandId !== "string")
      throw new AccessError(400, "Choose a brand.");
    if (typeof data.brandId === "string" && data.brandId)
      await requireBrand(db, a, data.brandId);
    const page = await db
      .prepare(
        "SELECT id,brand_id FROM hub_linkedin_pages WHERE id=? AND workspace_id=?",
      )
      .bind(data.id, a.workspaceId)
      .first<{ id: string; brand_id: string | null }>();
    if (!page) throw new AccessError(404, "Page not found.");
    if (
      page.brand_id !== data.brandId &&
      (await db
        .prepare(
          "SELECT id FROM hub_posts WHERE page_id=? AND status IN ('scheduled','processing') LIMIT 1",
        )
        .bind(page.id)
        .first())
    )
      throw new AccessError(
        409,
        "Cancel this page’s scheduled posts before changing its brand assignment.",
      );
    await db.batch([
      db
        .prepare(
          "UPDATE hub_linkedin_pages SET brand_id=?,enabled=? WHERE id=? AND workspace_id=?",
        )
        .bind(
          data.brandId || page.brand_id,
          data.brandId ? 1 : 0,
          data.id,
          a.workspaceId,
        ),
      audit(db, a, "linkedin.page_assigned", page.id),
    ]);
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

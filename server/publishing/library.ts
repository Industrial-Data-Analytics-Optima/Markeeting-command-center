import { AccessError, requireBrand } from "../auth/core.ts";
import type { Actor } from "../auth/core.ts";
export async function updateAsset(
  db: D1Database,
  a: Actor,
  d: Record<string, unknown>,
) {
  const row = await db
    .prepare("SELECT brand_id FROM hub_media WHERE id=? AND workspace_id=?")
    .bind(d.id, a.workspaceId)
    .first<{ brand_id: string }>();
  if (!row) throw new AccessError(404, "Asset not found.");
  await requireBrand(db, a, row.brand_id);
  const values = [];
  for (const [key, max] of [
    ["name", 180],
    ["folder", 80],
    ["altText", 1000],
  ] as const) {
    const v = d[key];
    if (typeof v !== "string" || v.length > max)
      throw new AccessError(400, "Asset details are too long or invalid.");
    values.push(v.trim());
  }
  if (!values[0]) throw new AccessError(400, "Give this asset a name.");
  if (typeof d.archived !== "boolean")
    throw new AccessError(400, "Choose a valid archive state.");
  const r = await db
    .prepare(
      "UPDATE hub_media SET name=?,folder=?,alt_text=?,archived=?,version=version+1 WHERE id=? AND workspace_id=? AND version=?",
    )
    .bind(...values, d.archived ? 1 : 0, d.id, a.workspaceId, d.version)
    .run();
  if (!r.meta.changes)
    throw new AccessError(
      409,
      "This asset changed elsewhere. Refresh before editing.",
    );
  return { id: d.id };
}

import {
  actorFor,
  requireOwner,
  requireBrand,
  audit,
  listBrands,
  AccessError,
  sameOrigin,
} from "../../../server/auth/core";
import { database, json, failure, body } from "../../../server/auth/http";
export async function GET(request: Request) {
  try {
    const db = database(),
      a = await actorFor(db, request);
    return json({ brands: await listBrands(db, a) });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const db = database(),
      a = await actorFor(db, request);
    requireOwner(a);
    const { name } = await body(request);
    if (typeof name !== "string" || !name.trim() || name.length > 80)
      throw new AccessError(400, "Use a brand name of 1–80 characters.");
    if (
      await db
        .prepare("SELECT id FROM hub_brands WHERE workspace_id=? AND name=?")
        .bind(a.workspaceId, name.trim())
        .first()
    )
      throw new AccessError(409, "That brand already exists.");
    const id = crypto.randomUUID();
    await db.batch([
      db
        .prepare("INSERT INTO hub_brands(id,workspace_id,name) VALUES(?,?,?)")
        .bind(id, a.workspaceId, name.trim()),
      audit(db, a, "brand.created", id),
    ]);
    return json({ id, name: name.trim() }, 201);
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
    const { id, name } = await body(request);
    if (typeof id !== "string") throw new AccessError(400, "Choose a brand.");
    await requireBrand(db, a, id);
    if (typeof name !== "string" || !name.trim() || name.length > 80)
      throw new AccessError(400, "Enter a valid brand name.");
    await db.batch([
      db
        .prepare("UPDATE hub_brands SET name=? WHERE id=? AND workspace_id=?")
        .bind(name.trim(), id, a.workspaceId),
      audit(db, a, "brand.renamed", id),
    ]);
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

import {
  actorFor,
  requireOwner,
  requireBrand,
  audit,
  AccessError,
  sameOrigin,
  token,
  digest,
} from "../../../server/auth/core";
import { database, json, failure, body } from "../../../server/auth/http";
export async function GET(request: Request) {
  try {
    const db = database(),
      a = await actorFor(db, request);
    requireOwner(a);
    const members = (
      await db
        .prepare(
          "SELECT u.id,u.email,u.name,m.role,m.active FROM hub_members m JOIN hub_users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY u.name",
        )
        .bind(a.workspaceId)
        .all()
    ).results;
    const access = (
      await db
        .prepare(
          "SELECT user_id,brand_id FROM hub_brand_access WHERE workspace_id=?",
        )
        .bind(a.workspaceId)
        .all()
    ).results;
    const invites = (
      await db
        .prepare(
          "SELECT token_hash AS id,email,role,expires_at FROM hub_invites WHERE workspace_id=? AND used_at IS NULL AND expires_at>? AND email IS NOT NULL",
        )
        .bind(a.workspaceId, Date.now())
        .all()
    ).results;
    return json({ members, access, invites });
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
    const data = await body(request);
    const email =
      typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      throw new AccessError(400, "Enter a valid email.");
    if (data.role !== "admin" && data.role !== "super_admin")
      throw new AccessError(400, "Choose a valid role.");
    const ids = Array.isArray(data.brandIds)
      ? ([...new Set(data.brandIds)] as string[])
      : [];
    for (const id of ids) await requireBrand(db, a, id);
    if (
      await db
        .prepare("SELECT id FROM hub_users WHERE email=?")
        .bind(email)
        .first()
    )
      throw new AccessError(
        409,
        "This person already has an account. Edit their access instead.",
      );
    const raw = token();
    await db.batch([
      db
        .prepare(
          "DELETE FROM hub_invites WHERE workspace_id=? AND email=? AND used_at IS NULL",
        )
        .bind(a.workspaceId, email),
      db
        .prepare(
          "INSERT INTO hub_invites(token_hash,workspace_id,email,role,brand_ids,expires_at,created_by) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          digest(raw),
          a.workspaceId,
          email,
          data.role,
          JSON.stringify(ids),
          Date.now() + 48 * 3600000,
          a.id,
        ),
      audit(db, a, "member.invited", email),
    ]);
    return json(
      {
        url:
          new URL("/workspace", request.url).origin +
          "/workspace#invite=" +
          raw,
      },
      201,
    );
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
    if (typeof data.id !== "string")
      throw new AccessError(400, "Choose a teammate.");
    if (data.id === a.id)
      throw new AccessError(400, "You cannot change your own access here.");
    if (
      !["admin", "super_admin"].includes(String(data.role)) ||
      typeof data.active !== "boolean"
    )
      throw new AccessError(400, "Choose valid access settings.");
    const member = await db
      .prepare(
        "SELECT role FROM hub_members WHERE workspace_id=? AND user_id=?",
      )
      .bind(a.workspaceId, data.id)
      .first();
    if (!member) throw new AccessError(404, "Member not found.");
    const ids = Array.isArray(data.brandIds)
      ? ([...new Set(data.brandIds)] as string[])
      : [];
    for (const id of ids) await requireBrand(db, a, id);
    await db.batch([
      db
        .prepare(
          "UPDATE hub_members SET role=?,active=? WHERE workspace_id=? AND user_id=?",
        )
        .bind(data.role, data.active ? 1 : 0, a.workspaceId, data.id),
      db
        .prepare(
          "DELETE FROM hub_brand_access WHERE workspace_id=? AND user_id=?",
        )
        .bind(a.workspaceId, data.id),
      ...ids.map((id) =>
        db
          .prepare(
            "INSERT INTO hub_brand_access(workspace_id,user_id,brand_id) VALUES(?,?,?)",
          )
          .bind(a.workspaceId, data.id, id),
      ),
      db
        .prepare("DELETE FROM hub_sessions WHERE workspace_id=? AND user_id=?")
        .bind(a.workspaceId, data.id),
      audit(db, a, "member.access_changed", data.id),
    ]);
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const db = database(),
      a = await actorFor(db, request);
    requireOwner(a);
    const { id } = await body(request);
    if (typeof id !== "string")
      throw new AccessError(400, "Choose an invitation.");
    await db.batch([
      db
        .prepare(
          "DELETE FROM hub_invites WHERE token_hash=? AND workspace_id=? AND used_at IS NULL",
        )
        .bind(id, a.workspaceId),
      audit(db, a, "invite.revoked", id),
    ]);
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

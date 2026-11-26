import {
  AccessError,
  digest,
  hashPassword,
  verifyPassword,
  validPassword,
} from "./core.ts";
export async function acceptInvite(
  db: D1Database,
  data: { token: string; email: string; password: string; name: string },
) {
  if (typeof data.token !== "string" || data.token.length > 100)
    throw new AccessError(400, "This invitation is invalid.");
  const invite = await db
    .prepare(
      "SELECT * FROM hub_invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
    )
    .bind(digest(data.token), Date.now())
    .first<{
      workspace_id: string;
      email: string | null;
      role: string;
      brand_ids: string;
    }>();
  if (!invite || (invite.email && invite.email !== data.email))
    throw new AccessError(
      400,
      "This invitation has expired or belongs to another email address.",
    );
  if (
    typeof data.name !== "string" ||
    !data.name.trim() ||
    data.name.length > 100
  )
    throw new AccessError(400, "Enter your name.");
  if (
    await db
      .prepare("SELECT id FROM hub_users WHERE email=?")
      .bind(data.email)
      .first()
  )
    throw new AccessError(
      409,
      "An account already exists for this email. Ask your super admin to update your access.",
    );
  const passwordHash = await hashPassword(data.password),
    userId = crypto.randomUUID(),
    workspaceId = invite.workspace_id,
    brandIds = JSON.parse(invite.brand_ids) as string[];
  await db.batch([
    db
      .prepare(
        "UPDATE hub_invites SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
      )
      .bind(Date.now(), digest(data.token), Date.now()),
    db
      .prepare(
        "INSERT INTO hub_users(id,email,name,password_hash) SELECT ?,?,?,? WHERE changes()=1",
      )
      .bind(userId, data.email, data.name.trim(), passwordHash),
    db
      .prepare(
        "INSERT INTO hub_members(workspace_id,user_id,role) VALUES(?,?,?)",
      )
      .bind(workspaceId, userId, invite.role),
    ...brandIds.map((id) =>
      db
        .prepare(
          "INSERT INTO hub_brand_access(workspace_id,user_id,brand_id) SELECT ?,?,id FROM hub_brands WHERE id=? AND workspace_id=?",
        )
        .bind(workspaceId, userId, id, workspaceId),
    ),
  ]);
  return { userId, workspaceId };
}
export async function authenticate(
  db: D1Database,
  email: string,
  password: string,
) {
  const user = await db
    .prepare(
      "SELECT u.id,u.password_hash,m.workspace_id FROM hub_users u JOIN hub_members m ON m.user_id=u.id WHERE u.email=? AND m.active=1 LIMIT 1",
    )
    .bind(email)
    .first<{ id: string; password_hash: string; workspace_id: string }>();
  const valid = await verifyPassword(
    password,
    user?.password_hash ||
      "pbkdf2:600000:unknown-account-salt:0000000000000000000000000000000000000000000000000000000000000000",
  );
  if (!user || !valid)
    throw new AccessError(401, "Email or password is incorrect.");
  return { userId: user.id, workspaceId: user.workspace_id };
}
export async function changePassword(
  db: D1Database,
  userId: string,
  current: string,
  next: string,
) {
  validPassword(next);
  const user = await db
    .prepare("SELECT password_hash FROM hub_users WHERE id=?")
    .bind(userId)
    .first<{ password_hash: string }>();
  if (!user || !(await verifyPassword(current, user.password_hash)))
    throw new AccessError(400, "Your current password is incorrect.");
  const hash = await hashPassword(next);
  await db.batch([
    db
      .prepare("UPDATE hub_users SET password_hash=? WHERE id=?")
      .bind(hash, userId),
    db.prepare("DELETE FROM hub_sessions WHERE user_id=?").bind(userId),
  ]);
}

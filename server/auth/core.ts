import { pbkdf2, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(pbkdf2);
export const token = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class AccessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function validPassword(password: unknown): asserts password is string {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    throw new AccessError(400, "Use a password between 12 and 128 characters.");
}
export async function hashPassword(password: string) {
  validPassword(password);
  const salt = token();
  const hash = await derive(password, salt, 600000, 32, "sha256");
  return `pbkdf2:600000:${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [scheme, iterations, salt, hash] = encoded.split(":");
  if (scheme !== "pbkdf2" || iterations !== "600000" || !salt || !hash)
    return false;
  const actual = await derive(password, salt, 600000, 32, "sha256"),
    expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
export type Actor = {
  id: string;
  email: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
  role: "super_admin" | "admin";
  sessionHash: string;
};
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin)
    throw new AccessError(403, "Please use this action from your workspace.");
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AccessError(415, "JSON is required.");
}
export function sessionToken(request: Request) {
  const name =
    new URL(request.url).protocol === "https:"
      ? "__Host-hub_session"
      : "hub_local_session";
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}
export function cookie(request: Request, value: string, maxAge = 43200) {
  const secure = new URL(request.url).protocol === "https:";
  return `${secure ? "__Host-hub_session" : "hub_local_session"}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
export async function actorFor(
  db: D1Database,
  request: Request,
): Promise<Actor> {
  const raw = sessionToken(request);
  if (!raw) throw new AccessError(401, "Sign in to continue.");
  const row = await db
    .prepare(
      `SELECT u.id,u.email,u.name,m.role,w.id AS workspaceId,w.name AS workspaceName FROM hub_sessions s JOIN hub_users u ON u.id=s.user_id JOIN hub_members m ON m.user_id=s.user_id AND m.workspace_id=s.workspace_id JOIN hub_workspaces w ON w.id=m.workspace_id WHERE s.token_hash=? AND s.expires_at>? AND m.active=1`,
    )
    .bind(digest(raw), Date.now())
    .first<Omit<Actor, "sessionHash">>();
  if (!row)
    throw new AccessError(401, "Your session ended. Please sign in again.");
  return { ...row, sessionHash: digest(raw) };
}
export function requireOwner(actor: Actor) {
  if (actor.role !== "super_admin")
    throw new AccessError(
      403,
      "Only the super admin can manage workspace access.",
    );
}
export async function requireBrand(
  db: D1Database,
  actor: Actor,
  brandId: string,
) {
  const brand = await db
    .prepare("SELECT id FROM hub_brands WHERE id=? AND workspace_id=?")
    .bind(brandId, actor.workspaceId)
    .first();
  if (!brand) throw new AccessError(404, "Brand not found.");
  if (
    actor.role !== "super_admin" &&
    !(await db
      .prepare(
        "SELECT brand_id FROM hub_brand_access WHERE workspace_id=? AND user_id=? AND brand_id=?",
      )
      .bind(actor.workspaceId, actor.id, brandId)
      .first())
  )
    throw new AccessError(403, "You do not have access to this brand.");
}
export async function listBrands(db: D1Database, a: Actor) {
  return (
    await db
      .prepare(
        a.role === "super_admin"
          ? "SELECT id,name FROM hub_brands WHERE workspace_id=? ORDER BY name"
          : "SELECT b.id,b.name FROM hub_brands b JOIN hub_brand_access a ON a.brand_id=b.id AND a.workspace_id=b.workspace_id WHERE b.workspace_id=? AND a.user_id=? ORDER BY b.name",
      )
      .bind(
        ...(a.role === "super_admin" ? [a.workspaceId] : [a.workspaceId, a.id]),
      )
      .all()
  ).results;
}
export function audit(
  db: D1Database,
  a: Actor,
  action: string,
  target: string,
) {
  return db
    .prepare(
      "INSERT INTO hub_audit(id,workspace_id,actor_id,action,target_id,created_at) VALUES(?,?,?,?,?,?)",
    )
    .bind(crypto.randomUUID(), a.workspaceId, a.id, action, target, Date.now());
}
export async function throttle(db: D1Database, key: string, maximum = 10) {
  const now = Date.now();
  const result = await db
    .prepare(
      `INSERT INTO hub_login_limits(key,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING attempts`,
    )
    .bind(digest(key), now + 15 * 60000, now, now)
    .first<{ attempts: number }>();
  if (!result || result.attempts > maximum)
    throw new AccessError(
      429,
      "Too many attempts. Please try again in 15 minutes.",
    );
}
export async function issueSession(
  db: D1Database,
  userId: string,
  workspaceId: string,
) {
  const raw = token(),
    now = Date.now();
  await db
    .prepare(
      "INSERT INTO hub_sessions(token_hash,user_id,workspace_id,expires_at,created_at) VALUES(?,?,?,?,?)",
    )
    .bind(digest(raw), userId, workspaceId, now + 43200000, now)
    .run();
  return raw;
}

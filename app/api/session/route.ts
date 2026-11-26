import {
  actorFor,
  AccessError,
  sameOrigin,
  sessionToken,
  cookie,
  digest,
  issueSession,
  throttle,
  listBrands,
} from "../../../server/auth/core";
import {
  acceptInvite,
  authenticate,
  changePassword,
} from "../../../server/auth/accounts";
import { database, json, failure, body } from "../../../server/auth/http";
export async function GET(request: Request) {
  try {
    const db = database();
    try {
      const actor = await actorFor(db, request);
      const { sessionHash, ...user } = actor;
      return json({ user, brands: await listBrands(db, actor) });
    } catch (e) {
      if (e instanceof AccessError && e.status === 401)
        return json({ user: null });
      throw e;
    }
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const db = database(),
      data = await body(request),
      email =
        typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      throw new AccessError(400, "Enter a valid email address.");
    if (typeof data.password !== "string" || data.password.length > 128)
      throw new AccessError(400, "Enter your password.");
    await throttle(db, "login:" + email);
    if (
      data.action === "accept" &&
      (typeof data.token !== "string" || typeof data.name !== "string")
    )
      throw new AccessError(400, "Enter a valid invitation and name.");
    const identity =
      data.action === "accept"
        ? await acceptInvite(db, {
            email,
            token: data.token as string,
            name: data.name as string,
            password: data.password,
          })
        : await authenticate(db, email, data.password);
    const raw = await issueSession(db, identity.userId, identity.workspaceId);
    return json({ ok: true }, 200, { "Set-Cookie": cookie(request, raw) });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const db = database(),
      a = await actorFor(db, request),
      data = await body(request);
    await throttle(db, "password:" + a.id, 5);
    if (typeof data.current !== "string" || data.current.length > 128)
      throw new AccessError(400, "Enter your current password.");
    if (typeof data.password !== "string")
      throw new AccessError(400, "Enter a new password.");
    await changePassword(db, a.id, data.current, data.password);
    return json({ ok: true }, 200, {
      "Set-Cookie": cookie(
        request,
        await issueSession(db, a.id, a.workspaceId),
      ),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const db = database(),
      raw = sessionToken(request);
    if (raw)
      await db
        .prepare("DELETE FROM hub_sessions WHERE token_hash=?")
        .bind(digest(raw))
        .run();
    return json({ ok: true }, 200, { "Set-Cookie": cookie(request, "", 0) });
  } catch (e) {
    return failure(e);
  }
}

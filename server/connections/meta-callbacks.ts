import { readTextLimited } from "../security/request.ts";
import {
  createHmac,
  createHash,
  timingSafeEqual,
  randomBytes,
} from "node:crypto";
import { AccessError } from "../auth/core.ts";
import type { MetaEnvironment } from "./meta-client.ts";

export function verifyMetaRequest(
  value: string,
  secret: string,
  now = Date.now(),
) {
  if (value.length > 16384) throw new AccessError(400, "Invalid Meta request.");
  const parts = value.split(".");
  if (
    parts.length !== 2 ||
    parts.some((p) => !/^[-_a-zA-Z0-9]+={0,2}$/.test(p))
  )
    throw new AccessError(400, "Invalid Meta request.");
  const received = Buffer.from(parts[0], "base64url"),
    expected = createHmac("sha256", secret).update(parts[1]).digest();
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    throw new AccessError(403, "Meta signature verification failed.");
  let data: { algorithm?: string; user_id?: string; issued_at?: number };
  try {
    data = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new AccessError(400, "Invalid Meta request.");
  }
  if (
    data.algorithm !== "HMAC-SHA256" ||
    !data.user_id ||
    !/^\d{1,40}$/.test(data.user_id) ||
    !Number.isFinite(data.issued_at) ||
    Number(data.issued_at) * 1000 > now + 300000 ||
    Number(data.issued_at) * 1000 < now - 86400000
  )
    throw new AccessError(400, "Invalid or expired Meta request.");
  return data.user_id;
}
export async function metaPrivacyCallback(
  db: D1Database,
  request: Request,
  e: MetaEnvironment,
  deletion: boolean,
) {
  if (!e.META_APP_SECRET)
    throw new AccessError(503, "Meta callback verification is not configured.");
  if (
    !request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    throw new AccessError(415, "Meta form encoding is required.");
  if (Number(request.headers.get("content-length") || 0) > 20000)
    throw new AccessError(413, "Request too large.");
  const text = await readTextLimited(request, 20000);
  const signed = new URLSearchParams(text).get("signed_request");
  if (!signed) throw new AccessError(400, "Meta signed_request is required.");
  const user = verifyMetaRequest(signed, e.META_APP_SECRET),
    code = randomBytes(24).toString("base64url");
  let origin: URL | undefined;
  if (deletion) {
    try {
      origin = new URL(e.APP_ORIGIN || "");
    } catch {
      throw new AccessError(503, "The app address is not configured.");
    }
    if (
      origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(origin.hostname)
      )
    )
      throw new AccessError(503, "The app address is invalid.");
  }
  const roots =
    "SELECT id FROM social_connections WHERE provider='meta' AND provider_account_id=?";
  const hash = createHash("sha256")
    .update((deletion ? "deletion:" : "deauthorize:") + signed)
    .digest("hex");
  const guard =
    " AND EXISTS(SELECT 1 FROM hub_meta_deletions WHERE request_hash=? AND code=?)";
  await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO hub_meta_deletions VALUES(?,?,?)")
      .bind(code, hash, Date.now()),
    db
      .prepare(
        "DELETE FROM hub_audit WHERE action LIKE 'meta.%' AND (target_id IN (" +
          roots +
          ") OR target_id IN (SELECT id FROM hub_meta_assets WHERE connection_id IN (" +
          roots +
          ")))" +
          guard,
      )
      .bind(user, user, hash, code),
    db
      .prepare(
        "DELETE FROM hub_meta_assets WHERE connection_id IN (" +
          roots +
          ")" +
          guard,
      )
      .bind(user, hash, code),
    db
      .prepare(
        "DELETE FROM hub_connection_brands WHERE connection_id IN (" +
          roots +
          ")" +
          guard,
      )
      .bind(user, hash, code),
    db
      .prepare(
        "DELETE FROM connection_alerts WHERE connection_id IN (" +
          roots +
          ")" +
          guard,
      )
      .bind(user, hash, code),
    db
      .prepare(
        "DELETE FROM social_connections WHERE provider='meta' AND provider_account_id=?" +
          guard,
      )
      .bind(user, hash, code),
  ]);
  if (!deletion) return { ok: true };
  const saved = await db
    .prepare("SELECT code FROM hub_meta_deletions WHERE request_hash=?")
    .bind(hash)
    .first<{ code: string }>();
  return {
    url: origin!.origin + "/meta-deletion?code=" + saved!.code,
    confirmation_code: saved!.code,
  };
}

import { env } from "../../../../server/platform";
import { database, json, failure } from "../../../../server/auth/http";
import { AccessError } from "../../../../server/auth/core";
import { metaPrivacyCallback } from "../../../../server/connections/meta-callbacks";
export async function POST(request: Request) {
  try {
    return json(await metaPrivacyCallback(database(), request, env, true));
  } catch (e) {
    return failure(e);
  }
}
export async function GET(request: Request) {
  try {
    const code = new URL(request.url).searchParams.get("code") || "";
    if (!/^[-_a-zA-Z0-9]{32}$/.test(code))
      throw new AccessError(404, "Confirmation not found.");
    const row = await database()
      .prepare("SELECT created_at FROM hub_meta_deletions WHERE code=?")
      .bind(code)
      .first<{ created_at: number }>();
    if (!row) throw new AccessError(404, "Confirmation not found.");
    return json({
      status: "completed",
      message:
        "The stored Meta connection, account credentials and associated account data have been removed.",
      completedAt: row.created_at,
    });
  } catch (e) {
    return failure(e);
  }
}

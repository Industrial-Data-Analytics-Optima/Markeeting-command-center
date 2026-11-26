import { env } from "../../../../server/platform";
import { database, json, failure } from "../../../../server/auth/http";
import { metaPrivacyCallback } from "../../../../server/connections/meta-callbacks";
export async function POST(request: Request) {
  try {
    return json(await metaPrivacyCallback(database(), request, env, false));
  } catch (e) {
    return failure(e);
  }
}

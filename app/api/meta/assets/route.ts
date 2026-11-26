import { env } from "../../../../server/platform";
import {
  actorFor,
  sameOrigin,
  AccessError,
} from "../../../../server/auth/core";
import { database, json, failure, body } from "../../../../server/auth/http";
import {
  metaAssets,
  assignMetaAsset,
  rescanMeta,
} from "../../../../server/connections/meta";
export async function GET(request: Request) {
  try {
    const db = database(),
      a = await actorFor(db, request);
    return json(
      await metaAssets(
        db,
        a,
        new URL(request.url).searchParams.get("selected") === "true",
      ),
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
    await assignMetaAsset(db, a, await body(request));
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const db = database(),
      a = await actorFor(db, request),
      input = await body(request);
    if (typeof input.connectionId !== "string")
      throw new AccessError(400, "Choose a Meta connection.");
    return json(await rescanMeta(db, a, input.connectionId, env));
  } catch (e) {
    return failure(e);
  }
}

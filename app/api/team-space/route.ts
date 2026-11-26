import { actorFor, sameOrigin } from "../../../server/auth/core";
import { database, json, failure, body } from "../../../server/auth/http";
import {
  teamList,
  teamDetail,
  teamReferences,
  teamAction,
} from "../../../server/team/space";
export async function GET(request: Request) {
  try {
    const db = database(),
      a = await actorFor(db, request),
      url = new URL(request.url);
    return json(
      url.searchParams.has("id")
        ? await teamDetail(db, a, url.searchParams.get("id")!)
        : url.searchParams.has("references")
          ? await teamReferences(db, a, url.searchParams.get("brand") || "")
          : await teamList(db, a, url),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const db = database(),
      a = await actorFor(db, request);
    return json(await teamAction(db, a, await body(request, 50000)));
  } catch (e) {
    return failure(e);
  }
}

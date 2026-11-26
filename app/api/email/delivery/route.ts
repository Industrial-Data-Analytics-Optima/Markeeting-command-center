import { env } from "../../../../server/platform";
import {
  actorFor,
  sameOrigin,
  AccessError,
} from "../../../../server/auth/core";
import { database, json, failure, body } from "../../../../server/auth/http";
import {
  queueEmail,
  cancelEmail,
  resolveEmail,
  retryEmail,
} from "../../../../server/email/delivery";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const db = database(),
      a = await actorFor(db, request),
      d = await body(request);
    if (d.action === "retry")
      return json(
        await retryEmail(
          db,
          a,
          String(d.id),
          env.EMAIL_DELIVERY_ENABLED === "true" && !!env.TOKEN_VAULT_KEY,
        ),
      );
    if (d.action === "cancel")
      return json(await cancelEmail(db, a, String(d.id)));
    if (d.action === "resolve") return json(await resolveEmail(db, a, d));
    if (d.action && d.action !== "send")
      throw new AccessError(400, "Choose a valid delivery action.");
    return json(
      await queueEmail(
        db,
        a,
        d,
        env.EMAIL_DELIVERY_ENABLED === "true" && !!env.TOKEN_VAULT_KEY,
      ),
      201,
    );
  } catch (e) {
    return failure(e);
  }
}

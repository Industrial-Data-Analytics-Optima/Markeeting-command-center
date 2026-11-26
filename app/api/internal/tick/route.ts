import { env } from "../../../../server/platform";
import { timingSafeEqual } from "node:crypto";
import { tick } from "../../../../server/publishing/runtime";

function authorized(request: Request) {
  const secret = env.SCHEDULER_SECRET;
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  return (
    !!secret &&
    Buffer.byteLength(provided) === Buffer.byteLength(secret) &&
    timingSafeEqual(Buffer.from(secret), Buffer.from(provided))
  );
}

async function run(request: Request) {
  if (!authorized(request))
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  try {
    await tick(env as never);
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ message: "Scheduler run failed" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;

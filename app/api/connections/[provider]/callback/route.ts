import { env } from "../../../../../server/platform";
import { finishOAuth } from "../../../../../server/connections/oauth";
import { database } from "../../../../../server/auth/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  let result = "connected";
  try {
    await finishOAuth(database(), request, (await params).provider, env);
  } catch {
    result = "not_connected";
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/workspace?connection=" + result,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

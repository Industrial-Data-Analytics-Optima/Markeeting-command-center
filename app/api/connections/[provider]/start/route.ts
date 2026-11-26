import { env } from "../../../../../server/platform";
import { beginOAuth } from "../../../../../server/connections/oauth";
import { database, json, failure, body } from "../../../../../server/auth/http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider } = await params;
    const data = await body(request);
    return json({
      url: await beginOAuth(
        database(),
        request,
        provider,
        typeof data.brandId === "string" ? data.brandId : "",
        env,
      ),
    });
  } catch (e) {
    return failure(e);
  }
}

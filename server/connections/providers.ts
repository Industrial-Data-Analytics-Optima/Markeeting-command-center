import type { Tokens } from "./vault";
import { RenewalError } from "./lifecycle.ts";
import type { Provider, Renewal } from "./lifecycle.ts";
type Credentials = { clientId: string; clientSecret: string };
export function tokenRefresher(
  credentials: Partial<Record<Provider, Credentials>>,
  fetcher: typeof fetch = fetch,
) {
  return async (provider: Provider, tokens: Tokens): Promise<Renewal> => {
    // Meta tokens have different extension/validation flows; never send a Meta
    // credential to a generic OAuth refresh endpoint or invent an expiration.
    if (provider === "meta") throw new RenewalError("reauthorize");
    const config = credentials[provider];
    if (!config) throw new RenewalError("temporary");
    if (!tokens.refreshToken) throw new RenewalError("reauthorize");
    const endpoints = {
      google: "https://oauth2.googleapis.com/token",
      microsoft: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      linkedin: "https://www.linkedin.com/oauth/v2/accessToken",
    };
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
    let response: Response;
    try {
      response = await fetcher(endpoints[provider], {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
    } catch {
      throw new RenewalError("temporary");
    }
    let data: Record<string, unknown>;
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new RenewalError("temporary");
    }
    if (!response.ok) {
      // Never persist provider response bodies: they may contain credentials or account data.
      if (
        data.error === "invalid_grant" ||
        data.error === "interaction_required" ||
        data.error === "consent_required"
      )
        throw new RenewalError("reauthorize");
      const retry = response.headers.get("Retry-After");
      const delay = retry
        ? Number.isFinite(Number(retry))
          ? Number(retry) * 1000
          : Math.max(0, Date.parse(retry) - Date.now())
        : undefined;
      throw new RenewalError(
        "temporary",
        delay && Number.isFinite(delay) ? Math.min(delay, 86400000) : undefined,
      );
    }
    if (
      typeof data.access_token !== "string" ||
      typeof data.expires_in !== "number" ||
      data.expires_in <= 0
    )
      throw new RenewalError("temporary");
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
      refreshToken:
        typeof data.refresh_token === "string" ? data.refresh_token : undefined,
      refreshExpiresIn:
        typeof data.refresh_token_expires_in === "number"
          ? data.refresh_token_expires_in
          : undefined,
    };
  };
}

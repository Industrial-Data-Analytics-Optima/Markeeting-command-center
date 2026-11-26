import { settings } from "./oauth.ts";
import type { OAuthEnvironment } from "./oauth.ts";

/** Configuration metadata only. Never expose credential values to the client. */
export function providerReadiness(id: string, e: OAuthEnvironment) {
  const credentials: Record<string, (keyof OAuthEnvironment)[]> = {
    linkedin: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    meta: ["META_APP_ID", "META_APP_SECRET", "META_LOGIN_CONFIG_ID"],
    google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    microsoft: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
  };
  const keys = credentials[id];
  if (!keys)
    return {
      id,
      ready: false,
      missing: [],
      redirectUri: null,
      reason: "This provider is not available.",
    };
  const missing = [...keys, "TOKEN_VAULT_KEY", "APP_ORIGIN"].filter(
    (key) => !e[key as keyof OAuthEnvironment],
  );
  let redirectUri: string | null = null,
    ready = false;
  try {
    if (e.APP_ORIGIN) {
      const origin = new URL(e.APP_ORIGIN);
      if (
        origin.protocol === "https:" ||
        (origin.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(origin.hostname))
      )
        redirectUri = origin.origin + "/api/connections/" + id + "/callback";
    }
    ready = !!settings(id, e) && !!redirectUri;
  } catch {
    /* Invalid server configuration is shown as setup required. */
  }
  return {
    id,
    ready,
    missing,
    redirectUri,
    reason: ready
      ? "Ready to authorize your account."
      : missing.length
        ? "One-time developer app setup is required."
        : "Check the public app address and provider configuration in the server settings.",
  };
}

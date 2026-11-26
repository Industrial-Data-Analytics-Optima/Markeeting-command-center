import { createTokenVault } from "./vault.ts";
import { tokenRefresher } from "./providers.ts";
import { d1ConnectionStore } from "./d1-store.ts";
import { connectionService } from "./lifecycle.ts";
import { maintainConnections } from "./maintenance.ts";
import { maintainMetaConnections } from "./meta.ts";
export type ConnectionEnvironment = {
  DB?: D1Database;
  TOKEN_VAULT_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  APP_ORIGIN?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_LOGIN_CONFIG_ID?: string;
  META_GRAPH_VERSION?: string;
};
/** Call only from trusted server code after workspace/action authorization. */
export async function connectionRuntime(env: ConnectionEnvironment) {
  if (!env.DB || !env.TOKEN_VAULT_KEY)
    throw new Error("Connection storage is not configured");
  const vault = await createTokenVault(env.TOKEN_VAULT_KEY);
  const credential = (clientId?: string, clientSecret?: string) =>
    clientId && clientSecret ? { clientId, clientSecret } : undefined;
  const refresh = tokenRefresher({
    google: credential(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    microsoft: credential(env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET),
    linkedin: credential(env.LINKEDIN_CLIENT_ID, env.LINKEDIN_CLIENT_SECRET),
  });
  const store = d1ConnectionStore(env.DB);
  return {
    service: connectionService(store, vault, refresh),
    maintain: async () => {
      await maintainMetaConnections(env.DB!, env);
      return maintainConnections(env.DB!, vault, refresh);
    },
  };
}

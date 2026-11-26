import { createHmac } from "node:crypto";
import { AccessError } from "../auth/core.ts";

export type MetaEnvironment = {
  APP_ORIGIN?: string;
  TOKEN_VAULT_KEY?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_LOGIN_CONFIG_ID?: string;
  META_GRAPH_VERSION?: string;
};
export function metaSettings(e: MetaEnvironment) {
  if (
    !e.APP_ORIGIN ||
    !e.TOKEN_VAULT_KEY ||
    !e.META_APP_ID ||
    !e.META_APP_SECRET ||
    !e.META_LOGIN_CONFIG_ID
  )
    return null;
  let origin: URL;
  try {
    origin = new URL(e.APP_ORIGIN);
  } catch {
    return null;
  }
  const version = e.META_GRAPH_VERSION || "v27.0";
  if (
    !/^v\d{1,3}\.\d$/.test(version) ||
    !/^\d+$/.test(e.META_APP_ID) ||
    !/^\d+$/.test(e.META_LOGIN_CONFIG_ID) ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(origin.hostname)
      ))
  )
    return null;
  return {
    authorize: "https://www.facebook.com/" + version + "/dialog/oauth",
    exchange: "https://graph.facebook.com/" + version + "/oauth/access_token",
    scope: "",
    profile: "",
    clientId: e.META_APP_ID,
    secret: e.META_APP_SECRET,
    configId: e.META_LOGIN_CONFIG_ID,
    version,
    redirect: origin.origin + "/api/connections/meta/callback",
  };
}
export class MetaError extends AccessError {
  reauthorize: boolean;
  constructor(reauthorize: boolean, message: string) {
    super(reauthorize ? 409 : 502, message);
    this.reauthorize = reauthorize;
  }
}
export type MetaAsset = {
  kind: "facebook" | "instagram";
  providerId: string;
  parentPageId: string;
  name: string;
  username: string | null;
  tasks: string[];
  accessToken: string;
};
export const metaId = (id: unknown): id is string =>
  typeof id === "string" && /^\d{1,40}$/.test(id);
export function metaClient(e: MetaEnvironment, fetcher: typeof fetch = fetch) {
  const config = metaSettings(e);
  if (!config)
    throw new AccessError(
      503,
      "Facebook and Instagram need their one-time Meta app setup.",
    );
  const root = "https://graph.facebook.com/" + config.version + "/";
  async function request(
    path: string,
    token?: string,
    params: Record<string, string> = {},
    form?: Record<string, string>,
  ) {
    if (!/^[a-zA-Z0-9_/]+$/.test(path))
      throw new MetaError(false, "Invalid Meta request.");
    const url = new URL(root + path);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    if (token)
      url.searchParams.set(
        "appsecret_proof",
        createHmac("sha256", config!.secret).update(token).digest("hex"),
      );
    let r: Response;
    try {
      r = await fetcher(url.href, {
        method: form ? "POST" : "GET",
        headers: {
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(form
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
        },
        ...(form ? { body: new URLSearchParams(form) } : {}),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new MetaError(
        false,
        "Meta could not be reached. Existing connections and selections have been kept.",
      );
    }
    let data: Record<string, unknown>;
    try {
      data = (await r.json()) as Record<string, unknown>;
    } catch {
      throw new MetaError(false, "Meta returned an unreadable response.");
    }
    if (!r.ok || data.error) {
      const error = data.error as { code?: number } | undefined;
      throw new MetaError(
        [10, 102, 190, 200].includes(error?.code || 0) || r.status === 401,
        "Meta access could not be verified. Check the app permissions and reconnect if access was revoked.",
      );
    }
    return data;
  }
  async function collection(
    path: string,
    token: string,
    params: Record<string, string>,
  ) {
    const rows: Record<string, unknown>[] = [],
      seen = new Set<string>();
    let after = "";
    for (let n = 0; n < 10; n++) {
      const result = await request(path, token, {
        ...params,
        limit: "100",
        ...(after ? { after } : {}),
      });
      if (!Array.isArray(result.data))
        throw new MetaError(false, "Meta returned an incomplete account list.");
      rows.push(...(result.data as Record<string, unknown>[]));
      const paging = result.paging as
        { next?: string; cursors?: { after?: string } } | undefined;
      if (!paging?.next) return rows;
      const cursor = paging.cursors?.after;
      if (!cursor || seen.has(cursor) || cursor.length > 2000)
        throw new MetaError(
          false,
          "Meta account discovery could not finish. Existing selections have been kept.",
        );
      seen.add(cursor);
      after = cursor;
    }
    throw new MetaError(
      false,
      "Too many Meta assets were selected. Limit the selection in Meta and reconnect.",
    );
  }
  async function permissions(token: string) {
    const rows = await collection("me/permissions", token, {}),
      granted = rows
        .filter(
          (r) => r.status === "granted" && typeof r.permission === "string",
        )
        .map((r) => String(r.permission));
    if (
      !["pages_show_list", "pages_read_engagement"].every((p) =>
        granted.includes(p),
      )
    )
      throw new MetaError(
        true,
        "Approve Facebook Page listing and reading permissions before connecting.",
      );
    return granted;
  }
  async function discover(token: string, granted: string[]) {
    const fields =
      "id,name,access_token,tasks" +
      (granted.includes("instagram_basic")
        ? ",instagram_business_account{id,username,name}"
        : "");
    const pages = await collection("me/accounts", token, { fields }),
      assets: MetaAsset[] = [],
      seen = new Set<string>();
    for (const p of pages) {
      if (
        !metaId(p.id) ||
        typeof p.name !== "string" ||
        typeof p.access_token !== "string" ||
        !p.access_token ||
        !Array.isArray(p.tasks)
      )
        throw new MetaError(
          false,
          "Meta returned incomplete Page credentials. Reconnect and approve Page access.",
        );
      if (seen.has(p.id))
        throw new MetaError(
          false,
          "Meta returned duplicate Pages. Retry discovery.",
        );
      seen.add(p.id);
      const tasks = (p.tasks as unknown[]).filter(
        (t): t is string => typeof t === "string",
      );
      assets.push({
        kind: "facebook",
        providerId: p.id,
        parentPageId: p.id,
        name: p.name.slice(0, 300),
        username: null,
        tasks,
        accessToken: p.access_token,
      });
      const ig = p.instagram_business_account as
        { id?: string; name?: string; username?: string } | undefined;
      if (ig) {
        if (!metaId(ig.id))
          throw new MetaError(
            false,
            "Meta returned an invalid Instagram account.",
          );
        assets.push({
          kind: "instagram",
          providerId: ig.id,
          parentPageId: p.id,
          name: (ig.name || ig.username || p.name).slice(0, 300),
          username: ig.username?.slice(0, 150) || null,
          tasks,
          accessToken: p.access_token,
        });
      }
    }
    if (!assets.length)
      throw new MetaError(
        true,
        "No Facebook Pages were available. Approve at least one managed Page in Meta and reconnect.",
      );
    return assets;
  }
  return {
    request,
    permissions,
    discover,
    async authorize(code: string) {
      const short = await request(
        "oauth/access_token",
        undefined,
        {},
        {
          client_id: config.clientId,
          client_secret: config.secret,
          redirect_uri: config.redirect,
          code,
        },
      );
      if (typeof short.access_token !== "string" || !short.access_token)
        throw new MetaError(
          false,
          "Meta did not return an authorization token.",
        );
      const long = await request(
        "oauth/access_token",
        undefined,
        {},
        {
          grant_type: "fb_exchange_token",
          client_id: config.clientId,
          client_secret: config.secret,
          fb_exchange_token: short.access_token,
        },
      );
      if (typeof long.access_token !== "string" || !long.access_token)
        throw new MetaError(false, "Meta did not grant ongoing access.");
      const debug = await request(
        "debug_token",
        config.clientId + "|" + config.secret,
        { input_token: long.access_token },
      );
      const info = debug.data as
        | {
            is_valid?: boolean;
            app_id?: string;
            user_id?: string;
            type?: string;
            expires_at?: number;
            data_access_expires_at?: number;
          }
        | undefined;
      if (
        !info?.is_valid ||
        String(info.app_id) !== config.clientId ||
        info.type !== "USER" ||
        !metaId(info.user_id)
      )
        throw new MetaError(
          true,
          "Use a User access token configuration for this Meta app and approve the requested access.",
        );
      const expiries = [
        Number(info.expires_at) * 1000,
        Number(info.data_access_expires_at) * 1000,
        typeof long.expires_in === "number"
          ? Date.now() + long.expires_in * 1000
          : NaN,
      ].filter((v) => Number.isFinite(v) && v > 0);
      if (!expiries.length || Math.min(...expiries) <= Date.now())
        throw new MetaError(
          true,
          "Meta returned expired authorization. Reconnect to approve ongoing access.",
        );
      const profile = await request("me", long.access_token, {
        fields: "id,name",
      });
      if (profile.id !== info.user_id || typeof profile.name !== "string")
        throw new MetaError(
          true,
          "Meta did not verify the authorizing account.",
        );
      const granted = await permissions(long.access_token),
        assets = await discover(long.access_token, granted);
      return {
        accessToken: long.access_token,
        expiresAt: Math.min(...expiries),
        userId: info.user_id,
        name: profile.name.slice(0, 300),
        granted,
        assets,
      };
    },
  };
}

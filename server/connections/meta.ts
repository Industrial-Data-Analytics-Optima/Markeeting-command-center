import {
  AccessError,
  actorFor,
  requireOwner,
  requireBrand,
  digest,
  audit,
  listBrands,
} from "../auth/core.ts";
import type { Actor } from "../auth/core.ts";
import { createTokenVault } from "./vault.ts";
import { metaClient, metaSettings, MetaError } from "./meta-client.ts";
import type { MetaAsset, MetaEnvironment } from "./meta-client.ts";

const assetId = (workspace: string, asset: MetaAsset) =>
  "meta-asset-" +
  digest(JSON.stringify([workspace, asset.kind, asset.providerId])).slice(
    0,
    32,
  );
async function snapshot(
  db: D1Database,
  e: MetaEnvironment,
  workspace: string,
  connection: string,
  assets: MetaAsset[],
  guard?: { version: number; lease: string },
) {
  const vault = await createTokenVault(e.TOKEN_VAULT_KEY!),
    now = Date.now();
  const clause = guard
    ? " AND EXISTS(SELECT 1 FROM social_connections c WHERE c.id=? AND c.workspace_id=? AND c.lease_owner=? AND c.version=?)"
    : "";
  const args = guard ? [connection, workspace, guard.lease, guard.version] : [];
  const statements = [
    db
      .prepare(
        "UPDATE hub_meta_assets SET available=0 WHERE connection_id=? AND workspace_id=?" +
          clause,
      )
      .bind(connection, workspace, ...args),
  ];
  for (const asset of assets) {
    const id = assetId(workspace, asset),
      sealed = await vault.seal(
        { accessToken: asset.accessToken, accessExpiresAt: null },
        workspace,
        id,
      );
    statements.push(
      db
        .prepare(
          "INSERT INTO hub_meta_assets(id,workspace_id,connection_id,kind,provider_id,parent_page_id,name,username,tasks,sealed_tokens,discovered_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE 1=1" +
            clause +
            " ON CONFLICT(workspace_id,kind,provider_id) DO UPDATE SET connection_id=excluded.connection_id,parent_page_id=excluded.parent_page_id,name=excluded.name,username=excluded.username,tasks=excluded.tasks,sealed_tokens=excluded.sealed_tokens,available=1,discovered_at=excluded.discovered_at",
        )
        .bind(
          id,
          workspace,
          connection,
          asset.kind,
          asset.providerId,
          asset.parentPageId,
          asset.name,
          asset.username,
          JSON.stringify(asset.tasks),
          sealed,
          now,
          ...args,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        "UPDATE hub_meta_assets SET enabled=0 WHERE connection_id=? AND workspace_id=? AND available=0" +
          clause,
      )
      .bind(connection, workspace, ...args),
  );
  statements.push(...assignmentStatements(db, workspace, clause, args));
  return statements;
}
function assignmentStatements(
  db: D1Database,
  workspace: string,
  clause = "",
  args: unknown[] = [],
) {
  return [
    db
      .prepare(
        "DELETE FROM hub_connection_brands WHERE brand_id IN (SELECT id FROM hub_brands WHERE workspace_id=?) AND connection_id IN (SELECT id FROM social_connections WHERE provider='meta' AND workspace_id=?) AND NOT EXISTS(SELECT 1 FROM hub_meta_assets a WHERE a.connection_id=hub_connection_brands.connection_id AND a.brand_id=hub_connection_brands.brand_id AND a.enabled=1 AND a.available=1)" +
          clause,
      )
      .bind(workspace, workspace, ...args),
    db
      .prepare(
        "INSERT OR IGNORE INTO hub_connection_brands(connection_id,brand_id) SELECT DISTINCT connection_id,brand_id FROM hub_meta_assets WHERE workspace_id=? AND enabled=1 AND available=1 AND brand_id IS NOT NULL" +
          clause,
      )
      .bind(workspace, ...args),
  ];
}
export async function finishMeta(
  db: D1Database,
  request: Request,
  e: MetaEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const a = await actorFor(db, request);
  requireOwner(a);
  const url = new URL(request.url),
    state = url.searchParams.get("state"),
    config = metaSettings(e);
  if (!state || !config)
    throw new AccessError(400, "Meta authorization expired. Start again.");
  if (url.origin !== new URL(config.redirect).origin)
    throw new AccessError(403, "Use the configured workspace address.");
  const claimed = await db
    .prepare(
      "DELETE FROM hub_oauth_states WHERE token_hash=? AND session_hash=? AND workspace_id=? AND provider='meta' AND expires_at>? RETURNING token_hash",
    )
    .bind(digest(state), a.sessionHash, a.workspaceId, Date.now())
    .first();
  if (!claimed || url.searchParams.has("error"))
    throw new AccessError(400, "Meta access was not approved.");
  const code = url.searchParams.get("code");
  if (!code)
    throw new AccessError(400, "Meta did not return an authorization code.");
  const result = await metaClient(e, fetcher).authorize(code),
    id =
      "meta-" +
      digest(JSON.stringify([a.workspaceId, result.userId])).slice(0, 32),
    vault = await createTokenVault(e.TOKEN_VAULT_KEY!),
    now = Date.now();
  const sealed = await vault.seal(
    { accessToken: result.accessToken, accessExpiresAt: result.expiresAt },
    a.workspaceId,
    id,
  );
  await db.batch([
    db
      .prepare(
        "INSERT INTO social_connections(id,workspace_id,provider,label,provider_account_id,sealed_tokens,access_expires_at,created_at,granted_scopes,meta_checked_at) VALUES(?,?,'meta',?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,sealed_tokens=excluded.sealed_tokens,access_expires_at=excluded.access_expires_at,granted_scopes=excluded.granted_scopes,meta_checked_at=excluded.meta_checked_at,version=version+1,status='healthy',retry_at=NULL,failures=0,lease_owner=NULL,lease_until=NULL",
      )
      .bind(
        id,
        a.workspaceId,
        result.name,
        result.userId,
        sealed,
        result.expiresAt,
        now,
        JSON.stringify(result.granted),
        now,
      ),
    ...(await snapshot(db, e, a.workspaceId, id, result.assets)),
    db
      .prepare(
        "DELETE FROM connection_alerts WHERE connection_id=? AND workspace_id=?",
      )
      .bind(id, a.workspaceId),
    audit(db, a, "meta.connected", id),
  ]);
  return id;
}
export async function metaAssets(db: D1Database, a: Actor, selected = false) {
  if (!selected) requireOwner(a);
  const brands = (await listBrands(db, a)) as { id: string }[],
    ids = brands.map((b) => b.id),
    marks = ids.map(() => "?").join(",") || "NULL";
  const filter = selected
    ? ` AND a.enabled=1 AND a.available=1 AND a.brand_id IN (${marks}) AND c.status<>'reconnect_required'`
    : "";
  const assets = (
    await db
      .prepare(
        "SELECT a.id,a.connection_id,a.kind,a.provider_id,a.parent_page_id,a.name,a.username,a.brand_id,a.enabled,a.available,a.discovered_at,c.label account_name,c.status connection_status FROM hub_meta_assets a JOIN social_connections c ON c.id=a.connection_id AND c.workspace_id=a.workspace_id WHERE a.workspace_id=?" +
          filter +
          " ORDER BY a.parent_page_id,a.kind,a.name",
      )
      .bind(a.workspaceId, ...(selected ? ids : []))
      .all()
  ).results;
  const connections = selected
    ? []
    : (
        await db
          .prepare(
            "SELECT id,label,status,access_expires_at,meta_checked_at,granted_scopes FROM social_connections WHERE workspace_id=? AND provider='meta' ORDER BY label",
          )
          .bind(a.workspaceId)
          .all<{ granted_scopes: string }>()
      ).results.map(({ granted_scopes, ...c }) => ({
        ...c,
        instagramPermission: (JSON.parse(granted_scopes) as string[]).includes(
          "instagram_basic",
        ),
      }));
  return { assets, connections };
}
export async function assignMetaAsset(
  db: D1Database,
  a: Actor,
  input: Record<string, unknown>,
) {
  requireOwner(a);
  if (
    typeof input.id !== "string" ||
    (input.brandId !== "" && typeof input.brandId !== "string")
  )
    throw new AccessError(400, "Choose an account and a brand, or Off.");
  const asset = await db
    .prepare(
      "SELECT a.id,a.connection_id,a.available,c.status FROM hub_meta_assets a JOIN social_connections c ON c.id=a.connection_id AND c.workspace_id=a.workspace_id WHERE a.id=? AND a.workspace_id=?",
    )
    .bind(input.id, a.workspaceId)
    .first<{
      id: string;
      connection_id: string;
      available: number;
      status: string;
    }>();
  if (!asset) throw new AccessError(404, "Meta account not found.");
  if (input.brandId) {
    await requireBrand(db, a, input.brandId);
    if (!asset.available || asset.status === "reconnect_required")
      throw new AccessError(
        409,
        "Reconnect Meta and refresh the available accounts before sharing this account.",
      );
  }
  const r = await db.batch([
    db
      .prepare(
        "UPDATE hub_meta_assets SET brand_id=?,enabled=? WHERE id=? AND workspace_id=? AND (?='' OR (available=1 AND EXISTS(SELECT 1 FROM social_connections c WHERE c.id=hub_meta_assets.connection_id AND c.workspace_id=hub_meta_assets.workspace_id AND c.status<>'reconnect_required')))",
      )
      .bind(
        input.brandId || null,
        input.brandId ? 1 : 0,
        input.id,
        a.workspaceId,
        input.brandId,
      ),
    ...assignmentStatements(db, a.workspaceId),
    audit(db, a, "meta.asset_assigned", asset.id),
  ]);
  if (!r[0].meta.changes)
    throw new AccessError(409, "This account changed. Refresh and try again.");
}
export async function rescanMeta(
  db: D1Database,
  a: Actor,
  connection: string,
  e: MetaEnvironment,
  fetcher: typeof fetch = fetch,
) {
  requireOwner(a);
  return rescan(db, a.workspaceId, connection, e, fetcher, a);
}
async function rescan(
  db: D1Database,
  workspace: string,
  connection: string,
  e: MetaEnvironment,
  fetcher: typeof fetch,
  a?: Actor,
) {
  const row = await db
    .prepare(
      "SELECT id,version,sealed_tokens,status FROM social_connections WHERE id=? AND workspace_id=? AND provider='meta'",
    )
    .bind(connection, workspace)
    .first<{
      id: string;
      version: number;
      sealed_tokens: string;
      status: string;
    }>();
  if (!row) throw new AccessError(404, "Meta connection not found.");
  const vault = await createTokenVault(e.TOKEN_VAULT_KEY!),
    tokens = await vault.open(row.sealed_tokens, workspace, connection),
    now = Date.now();
  try {
    if (
      row.status === "reconnect_required" ||
      (tokens.accessExpiresAt !== null && tokens.accessExpiresAt <= now)
    )
      throw new MetaError(
        true,
        "Meta authorization needs renewal. Choose Reconnect.",
      );
    const client = metaClient(e, fetcher),
      granted = await client.permissions(tokens.accessToken),
      assets = await client.discover(tokens.accessToken, granted),
      lease = crypto.randomUUID(),
      version = row.version + 1;
    const statements = [
      db
        .prepare(
          "UPDATE social_connections SET lease_owner=?,version=version+1 WHERE id=? AND workspace_id=? AND version=?",
        )
        .bind(lease, connection, workspace, row.version),
      ...(await snapshot(db, e, workspace, connection, assets, {
        lease,
        version,
      })),
      db
        .prepare(
          "UPDATE social_connections SET granted_scopes=?,meta_checked_at=?,status='healthy',failures=0,retry_at=NULL,lease_owner=NULL,lease_until=NULL WHERE id=? AND workspace_id=? AND lease_owner=? AND version=?",
        )
        .bind(
          JSON.stringify(granted),
          now,
          connection,
          workspace,
          lease,
          version,
        ),
    ];
    const r = await db.batch(statements);
    if (!r[r.length - 1].meta.changes)
      throw new AccessError(
        409,
        "This Meta connection changed during discovery. Refresh before trying again.",
      );
    if (a) await audit(db, a, "meta.assets_refreshed", connection).run();
    return { ok: true };
  } catch (error) {
    if (error instanceof MetaError) {
      const reconnect = error.reauthorize;
      await db.batch([
        db
          .prepare(
            "UPDATE social_connections SET status=?,meta_checked_at=?,failures=failures+1 WHERE id=? AND workspace_id=? AND version=?",
          )
          .bind(
            reconnect ? "reconnect_required" : "retrying",
            reconnect ? now : now - 86400000 + 300000,
            connection,
            workspace,
            row.version,
          ),
        db
          .prepare(
            "INSERT INTO connection_alerts(connection_id,workspace_id,kind,created_at) SELECT id,workspace_id,'reconnect_required',? FROM social_connections WHERE id=? AND workspace_id=? AND status='reconnect_required' AND version=? ON CONFLICT(connection_id,kind) DO NOTHING",
          )
          .bind(now, connection, workspace, row.version),
      ]);
    }
    throw error;
  }
}
export async function maintainMetaConnections(
  db: D1Database,
  e: MetaEnvironment,
  fetcher: typeof fetch = fetch,
) {
  if (!metaSettings(e)) return;
  const rows = (
    await db
      .prepare(
        "SELECT id,workspace_id FROM social_connections WHERE provider='meta' AND status<>'reconnect_required' AND (meta_checked_at IS NULL OR meta_checked_at<?) ORDER BY COALESCE(meta_checked_at,0) LIMIT 2",
      )
      .bind(Date.now() - 86400000)
      .all<{ id: string; workspace_id: string }>()
  ).results;
  for (const row of rows)
    try {
      await rescan(db, row.workspace_id, row.id, e, fetcher);
    } catch {
      /* Keep credentials and selections on transient failures. */
    }
}

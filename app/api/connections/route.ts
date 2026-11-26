import { env } from "../../../server/platform";
import { actorFor, requireOwner } from "../../../server/auth/core";
import { database, json, failure } from "../../../server/auth/http";
import { providerReadiness } from "../../../server/connections/readiness";
export async function GET(request: Request) {
  try {
    const db = database(),
      a = await actorFor(db, request);
    requireOwner(a);
    const accounts = (
      await db
        .prepare(
          "SELECT id,provider,label,status,last_checked_at,last_renewed_at,access_expires_at FROM social_connections WHERE workspace_id=? ORDER BY created_at DESC",
        )
        .bind(a.workspaceId)
        .all()
    ).results;
    const assignments = (
      await db
        .prepare(
          "SELECT cb.connection_id,cb.brand_id FROM hub_connection_brands cb JOIN social_connections c ON c.id=cb.connection_id WHERE c.workspace_id=? AND c.provider<>'linkedin' UNION SELECT p.connection_id,p.brand_id FROM hub_linkedin_pages p WHERE p.workspace_id=? AND p.enabled=1 AND p.brand_id IS NOT NULL",
        )
        .bind(a.workspaceId, a.workspaceId)
        .all()
    ).results;
    return json({
      accounts,
      assignments,
      providers: ["linkedin", "meta", "google", "microsoft"].map((id) =>
        providerReadiness(id, env),
      ),
    });
  } catch (e) {
    return failure(e);
  }
}

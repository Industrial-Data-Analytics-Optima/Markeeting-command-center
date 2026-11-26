import { AccessError, requireBrand, digest, audit } from "../auth/core.ts";
import type { Actor } from "../auth/core.ts";
import {
  parseBudget,
  campaignCurrencies,
  campaignCountries,
} from "../../app/campaign-model.ts";
function text(v: unknown, max: number, label: string) {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" || v.length > max)
    throw new AccessError(400, `${label} is too long or invalid.`);
  return v.trim();
}
function date(v: unknown) {
  if (v === null || v === undefined || v === "") return null;
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    Number.isNaN(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw new AccessError(400, "Use a valid campaign date.");
  return v;
}
export function validateCampaign(data: Record<string, unknown>) {
  const name = text(data.name, 120, "Campaign name");
  if (!name) throw new AccessError(400, "Give the campaign a name.");
  const platform = text(data.platform, 30, "Channel"),
    objective = text(data.objective, 30, "Objective"),
    currency = data.currency ? text(data.currency, 3, "Currency") : null,
    status = data.status || "draft";
  if (!["LinkedIn", "Facebook", "Instagram", ""].includes(platform))
    throw new AccessError(400, "Choose a supported channel.");
  if (!["Awareness", "Traffic", "Leads", "Engagement", ""].includes(objective))
    throw new AccessError(400, "Choose a campaign objective.");
  if (!["draft", "ready", "archived"].includes(String(status)))
    throw new AccessError(400, "Choose a valid plan status.");
  if (currency && !campaignCurrencies.includes(currency))
    throw new AccessError(400, "Choose a supported currency.");
  let budget: number | null;
  try {
    budget = parseBudget(data.budget);
  } catch (e) {
    throw new AccessError(400, (e as Error).message);
  }
  if (budget !== null && !currency)
    throw new AccessError(400, "Choose the currency for this budget.");
  const basis = data.budgetBasis || "total";
  if (!["total", "daily"].includes(String(basis)))
    throw new AccessError(400, "Choose a total or daily budget.");
  const start = date(data.startDate),
    end = date(data.endDate);
  if (start && end && end < start)
    throw new AccessError(400, "End date must be on or after the start date.");
  const countries = Array.isArray(data.countries)
    ? [...new Set(data.countries)]
    : [];
  if (
    countries.some(
      (c) =>
        typeof c !== "string" ||
        !campaignCountries.some(([code]) => c === code),
    ) ||
    (countries.includes("ALL") && countries.length > 1)
  )
    throw new AccessError(400, "Choose individual countries or Worldwide.");
  const audience = text(data.audience, 1500, "Audience"),
    brief = text(data.brief, 4000, "Brief"),
    destination = text(data.destination, 1000, "Destination");
  if (destination) {
    try {
      const url = new URL(destination);
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error();
    } catch {
      throw new AccessError(
        400,
        "Use a complete HTTPS destination URL without credentials.",
      );
    }
  }
  if (
    status === "ready" &&
    (!platform ||
      !objective ||
      !currency ||
      budget === null ||
      !start ||
      !end ||
      !countries.length ||
      !audience)
  )
    throw new AccessError(
      400,
      "Ready plans need a channel, objective, budget, dates, countries and audience.",
    );
  if (status === "ready" && objective === "Traffic" && !destination)
    throw new AccessError(
      400,
      "Add a destination URL for the traffic campaign.",
    );
  return {
    name,
    platform,
    objective,
    currency,
    budget,
    basis: String(basis),
    start,
    end,
    countries,
    audience,
    brief,
    destination,
    status: String(status),
  };
}
export async function saveCampaign(
  db: D1Database,
  a: Actor,
  data: Record<string, unknown>,
) {
  if (typeof data.brandId !== "string")
    throw new AccessError(400, "Choose a brand.");
  await requireBrand(db, a, data.brandId);
  const v = validateCampaign(data),
    ids = Array.isArray(data.postIds)
      ? ([...new Set(data.postIds)] as string[])
      : [];
  if (ids.length > 100) throw new AccessError(400, "Attach up to 100 posts.");
  for (const id of ids) {
    if (
      typeof id !== "string" ||
      !(await db
        .prepare(
          "SELECT id FROM hub_posts WHERE id=? AND workspace_id=? AND brand_id=?",
        )
        .bind(id, a.workspaceId, data.brandId)
        .first())
    )
      throw new AccessError(403, "Campaign content must belong to this brand.");
  }
  const hash = digest(JSON.stringify([data.brandId, v, [...ids].sort()])),
    now = Date.now(),
    values = [
      v.name,
      v.platform,
      v.objective,
      v.currency,
      v.budget,
      v.basis,
      v.start,
      v.end,
      JSON.stringify(v.countries),
      v.audience,
      v.brief,
      v.destination,
      v.status,
    ];
  let id: string;
  if (data.id) {
    const old = await db
      .prepare(
        "SELECT id,brand_id,version FROM hub_campaign_plans WHERE id=? AND workspace_id=?",
      )
      .bind(data.id, a.workspaceId)
      .first<{ id: string; brand_id: string; version: number }>();
    if (!old) throw new AccessError(404, "Campaign not found.");
    await requireBrand(db, a, old.brand_id);
    if (old.brand_id !== data.brandId)
      throw new AccessError(
        400,
        "A saved campaign cannot be moved to another brand.",
      );
    if (old.version !== data.version)
      throw new AccessError(
        409,
        "This campaign changed elsewhere. Reload before editing.",
      );
    id = old.id;
    // Updates and linked content are one batch. The temporary guard causes stale races to roll back.
    const r = await db.batch([
      db
        .prepare(
          "UPDATE hub_campaign_plans SET name=?,platform=?,objective=?,currency=?,budget_minor=?,budget_basis=?,start_date=?,end_date=?,countries=?,audience=?,brief=?,destination=?,status=?,payload_hash=?,updated_by=?,updated_at=?,version=version+1 WHERE id=? AND workspace_id=? AND version=?",
        )
        .bind(...values, hash, a.id, now, id, a.workspaceId, old.version),
      db
        .prepare(
          "INSERT INTO hub_campaign_edit_guards(id,valid) VALUES(?,changes())",
        )
        .bind(id),
      db.prepare("DELETE FROM hub_campaign_posts WHERE campaign_id=?").bind(id),
      ...ids.map((p) =>
        db
          .prepare(
            "INSERT INTO hub_campaign_posts(campaign_id,post_id) VALUES(?,?)",
          )
          .bind(id, p),
      ),
      db.prepare("DELETE FROM hub_campaign_edit_guards WHERE id=?").bind(id),
      audit(db, a, "campaign.updated", id),
    ]);
    if (!r[0].meta.changes)
      throw new AccessError(409, "This campaign changed. Reload it.");
  } else {
    if (
      typeof data.clientKey !== "string" ||
      !/^[-\w]{16,80}$/.test(data.clientKey)
    )
      throw new AccessError(400, "Missing save identifier. Reload the form.");
    const existing = await db
      .prepare(
        "SELECT id,payload_hash FROM hub_campaign_plans WHERE workspace_id=? AND client_key=?",
      )
      .bind(a.workspaceId, data.clientKey)
      .first<{ id: string; payload_hash: string }>();
    if (existing) {
      if (existing.payload_hash !== hash)
        throw new AccessError(
          409,
          "The earlier save succeeded. Reopen the campaign before changing it.",
        );
      return { id: existing.id };
    }
    id = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          "INSERT INTO hub_campaign_plans(id,workspace_id,brand_id,name,platform,objective,currency,budget_minor,budget_basis,start_date,end_date,countries,audience,brief,destination,status,client_key,payload_hash,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          a.workspaceId,
          data.brandId,
          ...values,
          data.clientKey,
          hash,
          a.id,
          a.id,
          now,
          now,
        ),
      ...ids.map((p) =>
        db
          .prepare(
            "INSERT INTO hub_campaign_posts(campaign_id,post_id) VALUES(?,?)",
          )
          .bind(id, p),
      ),
      audit(db, a, "campaign.created", id),
    ]);
  }
  return { id };
}

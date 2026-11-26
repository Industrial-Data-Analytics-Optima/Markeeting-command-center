import { AccessError, requireBrand, digest } from "../auth/core.ts";
import type { Actor } from "../auth/core.ts";
import {
  campaignCurrencies,
  campaignCountries,
  parseBudget,
} from "../../app/campaign-model.ts";
const str = (v: unknown, max = 200) => {
  if (v == null) return "";
  if (typeof v !== "string" || v.length > max)
    throw new AccessError(400, "An ad field is too long or invalid.");
  return v.trim();
};
export async function saveAdBuild(
  db: D1Database,
  a: Actor,
  d: Record<string, unknown>,
) {
  if (d.action && d.action !== "save")
    throw new AccessError(
      409,
      "Live ad delivery is not enabled. Save the build for validation.",
    );
  const brand = str(d.brandId, 100);
  await requireBrand(db, a, brand);
  const id = str(d.id, 100),
    name = str(d.name),
    platform = str(d.platform),
    currency = str(d.currency),
    campaign = str(d.campaignId, 100) || null,
    status = str(d.status) || "draft";
  if (!name) throw new AccessError(400, "Give the campaign a name.");
  if (!["LinkedIn", "Facebook", "Instagram"].includes(platform))
    throw new AccessError(400, "Choose a supported platform.");
  if (currency && !campaignCurrencies.includes(currency))
    throw new AccessError(400, "Choose a supported currency.");
  if (!["draft", "ready", "archived"].includes(status))
    throw new AccessError(400, "Choose a valid campaign state.");
  if (
    campaign &&
    !(await db
      .prepare(
        "SELECT id FROM hub_campaign_plans WHERE id=? AND workspace_id=? AND brand_id=?",
      )
      .bind(campaign, a.workspaceId, brand)
      .first())
  )
    throw new AccessError(403, "Choose a campaign brief from this brand.");
  const objective = str(d.objective);
  if (!["Awareness", "Traffic", "Leads", "Engagement"].includes(objective))
    throw new AccessError(400, "Choose an objective.");
  if (!Array.isArray(d.groups) || !d.groups.length || d.groups.length > 10)
    throw new AccessError(400, "Use between 1 and 10 ad groups.");
  const issues: string[] = [];
  if (!currency) issues.push("Choose a planned budget currency.");
  const groups = [];
  for (let i = 0; i < d.groups.length; i++) {
    const g = d.groups[i] as Record<string, unknown>;
    if (!g || typeof g !== "object")
      throw new AccessError(400, "Invalid ad group.");
    const groupName = str(g.name),
      audience = str(g.audience, 2000),
      exclusions = str(g.exclusions, 1000),
      basis = str(g.basis) || "total",
      start = str(g.start, 10),
      end = str(g.end, 10),
      countries = Array.isArray(g.countries) ? [...new Set(g.countries)] : [];
    if (!["total", "daily"].includes(basis))
      throw new AccessError(400, "Choose daily or total budgeting.");
    if (
      countries.some(
        (c) =>
          typeof c !== "string" || !campaignCountries.some(([k]) => k === c),
      ) ||
      (countries.includes("ALL") && countries.length > 1)
    )
      throw new AccessError(400, "Choose valid countries or Worldwide.");
    for (const date of [start, end])
      if (
        date &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date)
      )
        throw new AccessError(400, "Choose valid dates.");
    if (start && end && end < start)
      throw new AccessError(400, "End date must follow the start date.");
    let minor: number | null;
    try {
      minor = parseBudget(g.budget);
    } catch (e) {
      throw new AccessError(400, (e as Error).message);
    }
    if (minor !== null && !currency)
      throw new AccessError(400, "Choose the budget currency.");
    if (
      !groupName ||
      !audience ||
      !countries.length ||
      minor === null ||
      !start ||
      !end
    )
      issues.push(
        "Complete targeting, budget and dates for group " + (i + 1) + ".",
      );
    if (!Array.isArray(g.ads) || !g.ads.length || g.ads.length > 20)
      throw new AccessError(400, "Use 1 to 20 ads per group.");
    const ads = [];
    for (let j = 0; j < g.ads.length; j++) {
      const ad = g.ads[j] as Record<string, unknown>;
      if (!ad || typeof ad !== "object")
        throw new AccessError(400, "Invalid ad creative.");
      const title = str(ad.name),
        headline = str(ad.headline, 200),
        text = str(ad.text, 3000),
        destination = str(ad.destination, 1000),
        mediaId = str(ad.mediaId, 100),
        cta = str(ad.cta) || "Learn more";
      if (
        ![
          "Learn more",
          "Sign up",
          "Contact us",
          "Download",
          "Apply now",
        ].includes(cta)
      )
        throw new AccessError(400, "Choose a supported call to action.");
      if (destination) {
        try {
          const url = new URL(destination);
          if (url.protocol !== "https:" || url.username || url.password)
            throw new Error();
        } catch {
          throw new AccessError(
            400,
            "Use an HTTPS destination without credentials.",
          );
        }
      }
      if (
        mediaId &&
        !(await db
          .prepare(
            "SELECT id FROM hub_media WHERE id=? AND workspace_id=? AND brand_id=? AND (archived=0 OR ?=1)",
          )
          .bind(mediaId, a.workspaceId, brand, status === "archived" ? 1 : 0)
          .first())
      )
        throw new AccessError(
          403,
          "Choose an active creative asset from this brand.",
        );
      if (!title || !headline || !text || !mediaId || !destination)
        issues.push(
          "Complete creative " + (j + 1) + " in group " + (i + 1) + ".",
        );
      ads.push({ name: title, headline, text, destination, mediaId, cta });
    }
    groups.push({
      name: groupName,
      audience,
      exclusions,
      basis,
      start,
      end,
      countries,
      budget: minor === null ? "" : (minor / 100).toFixed(2),
      ads,
    });
  }
  if (status === "ready" && issues.length)
    throw new AccessError(400, issues.join(" "));
  const payload = JSON.stringify({ objective, groups }),
    hash = digest(
      JSON.stringify([
        brand,
        campaign,
        name,
        platform,
        currency,
        payload,
        status,
      ]),
    ),
    now = Date.now();
  let savedId = id;
  let mutation: D1PreparedStatement;
  if (id) {
    const old = await db
      .prepare(
        "SELECT brand_id,version FROM hub_ad_builds WHERE id=? AND workspace_id=?",
      )
      .bind(id, a.workspaceId)
      .first<{ brand_id: string; version: number }>();
    if (!old || old.brand_id !== brand)
      throw new AccessError(404, "Ad campaign not found.");
    if (!Number.isInteger(d.version))
      throw new AccessError(400, "Reopen this draft before saving.");
    mutation = db
      .prepare(
        "UPDATE hub_ad_builds SET campaign_id=?,name=?,platform=?,currency=?,payload=?,status=?,payload_hash=?,updated_by=?,updated_at=?,version=version+1 WHERE id=? AND workspace_id=? AND version=?",
      )
      .bind(
        campaign,
        name,
        platform,
        currency || null,
        payload,
        status,
        hash,
        a.id,
        now,
        id,
        a.workspaceId,
        d.version,
      );
  } else {
    const key = str(d.clientKey, 100);
    if (!/^[\w-]{16,100}$/.test(key))
      throw new AccessError(400, "Reopen the builder before saving.");
    const old = await db
      .prepare(
        "SELECT id,payload_hash FROM hub_ad_builds WHERE workspace_id=? AND client_key=?",
      )
      .bind(a.workspaceId, key)
      .first<{ id: string; payload_hash: string }>();
    if (old) {
      if (old.payload_hash !== hash)
        throw new AccessError(
          409,
          "An earlier save succeeded. Reopen the saved campaign.",
        );
      return { id: old.id, issues };
    }
    savedId = crypto.randomUUID();
    mutation = db
      .prepare(
        "INSERT INTO hub_ad_builds VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)",
      )
      .bind(
        savedId,
        a.workspaceId,
        brand,
        campaign,
        name,
        platform,
        currency || null,
        payload,
        status,
        key,
        hash,
        a.id,
        a.id,
        now,
        now,
      );
  }
  const results = await db.batch([
    mutation!,
    db
      .prepare(
        "INSERT INTO hub_ad_build_events SELECT ?,?,?,?,? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        savedId,
        a.id,
        status === "ready"
          ? "Marked ready for platform validation. No ads launched."
          : status === "archived"
            ? "Campaign draft archived."
            : "Ad campaign draft saved.",
        now,
      ),
  ]);
  if (!results[0].meta.changes)
    throw new AccessError(
      409,
      "This campaign changed elsewhere. Reopen it before saving.",
    );
  return { id: savedId, issues };
}

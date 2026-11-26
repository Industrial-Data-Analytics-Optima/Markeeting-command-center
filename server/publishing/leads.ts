import { AccessError, requireBrand } from "../auth/core.ts";
import type { Actor } from "../auth/core.ts";
export async function leadMembers(db: D1Database, a: Actor, brand: string) {
  return (
    await db
      .prepare(
        "SELECT u.id,u.name FROM hub_members m JOIN hub_users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.active=1 AND (m.role='super_admin' OR EXISTS(SELECT 1 FROM hub_brand_access b WHERE b.workspace_id=m.workspace_id AND b.user_id=m.user_id AND b.brand_id=?)) ORDER BY u.name",
      )
      .bind(a.workspaceId, brand)
      .all<{ id: string; name: string }>()
  ).results;
}
function field(v: unknown, max: number) {
  if (v == null) return "";
  if (typeof v !== "string" || v.length > max)
    throw new AccessError(400, "A lead field is too long or invalid.");
  return v.trim();
}
export async function saveLead(
  db: D1Database,
  a: Actor,
  d: Record<string, unknown>,
) {
  const id = field(d.id, 100),
    brand = field(d.brandId, 100);
  await requireBrand(db, a, brand);
  const old = id
    ? await db
        .prepare("SELECT * FROM hub_leads WHERE id=? AND workspace_id=?")
        .bind(id, a.workspaceId)
        .first<{
          brand_id: string;
          version: number;
          industry: string;
          job_title: string;
          country: string;
          company_size: string;
          interests: string;
          profile_source: string;
        }>()
    : null;
  if (id && (!old || old.brand_id !== brand))
    throw new AccessError(404, "Lead not found.");
  if (d.action === "note") {
    if (!old) throw new AccessError(404, "Lead not found.");
    const note = field(d.note, 4000);
    if (!note) throw new AccessError(400, "Write a note first.");
    await db
      .prepare("INSERT INTO hub_lead_notes VALUES(?,?,?,?,?)")
      .bind(crypto.randomUUID(), id, a.id, note, Date.now())
      .run();
    return { id };
  }
  const name = field(d.name, 160),
    email = field(d.email, 254),
    phone = field(d.phone, 80),
    company = field(d.company, 200),
    source = field(d.source, 160) || "Manual entry",
    campaign = field(d.campaignId, 100) || null,
    assignee = field(d.assigneeId, 100) || null,
    stage = field(d.stage, 30) || "New",
    follow = field(d.followUp, 10) || null;
  if (!name) throw new AccessError(400, "Enter a lead name.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new AccessError(400, "Enter a valid email address.");
  if (!["New", "Contacted", "Qualified", "Won", "Lost"].includes(stage))
    throw new AccessError(400, "Choose a valid stage.");
  if (
    follow &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(follow) ||
      !Number.isFinite(Date.parse(follow)) ||
      new Date(follow).toISOString().slice(0, 10) !== follow)
  )
    throw new AccessError(400, "Choose a valid follow-up date.");
  if (
    campaign &&
    !(await db
      .prepare(
        "SELECT id FROM hub_campaign_plans WHERE id=? AND workspace_id=? AND brand_id=?",
      )
      .bind(campaign, a.workspaceId, brand)
      .first())
  )
    throw new AccessError(400, "Choose a campaign belonging to this brand.");
  if (
    assignee &&
    !(await leadMembers(db, a, brand)).some((m) => m.id === assignee)
  )
    throw new AccessError(400, "Assign an active teammate with brand access.");
  const profileFields = [
    "industry",
    "job_title",
    "country",
    "company_size",
    "interests",
  ] as const;
  const profile = profileFields.map((key) =>
      d[key] === undefined && old
        ? old[key]
        : field(d[key], key === "interests" ? 1000 : 120),
    ),
    profileSource =
      !old || profile.some((value, i) => value !== old[profileFields[i]])
        ? "manual"
        : old.profile_source;
  const now = Date.now();
  if (old) {
    const result = await db
      .prepare(
        "UPDATE hub_leads SET industry=?,job_title=?,country=?,company_size=?,interests=?,profile_source=?,name=?,email=?,phone=?,company=?,source=?,campaign_id=?,assignee_id=?,stage=?,follow_up=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=?",
      )
      .bind(
        ...profile,
        profileSource,
        name,
        email,
        phone,
        company,
        source,
        campaign,
        assignee,
        stage,
        follow,
        now,
        id,
        a.workspaceId,
        d.version,
      )
      .run();
    if (!result.meta.changes)
      throw new AccessError(
        409,
        "This lead changed elsewhere. Close and reopen it before saving.",
      );
    return { id };
  }
  const key = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO hub_leads(id,workspace_id,brand_id,name,email,phone,company,source,campaign_id,assignee_id,stage,follow_up,version,created_at,updated_at,industry,job_title,country,company_size,interests,profile_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      key,
      a.workspaceId,
      brand,
      name,
      email,
      phone,
      company,
      source,
      campaign,
      assignee,
      stage,
      follow,
      1,
      now,
      now,
      ...profile,
      profileSource,
    )
    .run();
  return { id: key };
}

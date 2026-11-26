import { AccessError, requireBrand, listBrands, audit } from "../auth/core.ts";
import type { Actor } from "../auth/core.ts";

type Entry = {
  id: string;
  author_name?: string;
  workspace_id: string;
  brand_id: string;
  kind: "discussion" | "report";
  category: string;
  title: string;
  body: string;
  next_steps: string;
  observations: string;
  requests: string;
  week_start: string | null;
  reference_kind: "post" | "ad" | null;
  reference_id: string | null;
  status: string;
  created_by: string;
  version: number;
  created_at: number;
  updated_at: number;
};
export function weekStart(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new AccessError(400, "Choose a week.");
  const date = new Date(value + "T12:00:00Z");
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value ||
    date.getUTCFullYear() < 2000 ||
    date.getUTCFullYear() > 2100
  )
    throw new AccessError(400, "Choose a valid week.");
  date.setTime(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86400000);
  return date.toISOString().slice(0, 10);
}
function text(
  input: Record<string, unknown>,
  key: string,
  max: number,
  required = false,
) {
  const value = input[key] === undefined ? "" : input[key];
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (required && !value.trim())
  )
    throw new AccessError(
      400,
      `Enter ${key.replace("_", " ")}${required ? " (required)" : ""}, up to ${max.toLocaleString()} characters.`,
    );
  return value.trim();
}
export async function teamEntry(db: D1Database, a: Actor, id: string) {
  const row = await db
    .prepare(
      "SELECT e.*,u.name AS author_name FROM hub_team_entries e JOIN hub_users u ON u.id=e.created_by WHERE e.id=? AND e.workspace_id=?",
    )
    .bind(id, a.workspaceId)
    .first<Entry>();
  if (!row || (row.status === "draft" && row.created_by !== a.id))
    throw new AccessError(404, "Team item not found.");
  await requireBrand(db, a, row.brand_id);
  return row;
}
async function reference(
  db: D1Database,
  a: Actor,
  brand: string,
  kind: unknown,
  id: unknown,
) {
  if (!kind && !id) return null;
  if (!["post", "ad"].includes(String(kind)) || typeof id !== "string")
    throw new AccessError(400, "Choose a post or ad build.");
  const row = await db
    .prepare(
      kind === "post"
        ? "SELECT id,text AS title,status FROM hub_posts WHERE id=? AND workspace_id=? AND brand_id=?"
        : "SELECT id,name AS title,status FROM hub_ad_builds WHERE id=? AND workspace_id=? AND brand_id=?",
    )
    .bind(id, a.workspaceId, brand)
    .first<{ id: string; title: string; status: string }>();
  if (!row)
    throw new AccessError(
      404,
      "The linked post or ad build is not available to this brand.",
    );
  return { ...row, kind: String(kind) as "post" | "ad" };
}
export async function teamList(db: D1Database, a: Actor, url: URL) {
  const brands = (await listBrands(db, a)) as { id: string; name: string }[],
    ids = brands.map((b) => b.id),
    where = [
      "e.workspace_id=?",
      `e.brand_id IN (${ids.map(() => "?").join(",") || "NULL"})`,
      "(e.status<>'draft' OR e.created_by=?)",
    ],
    args: unknown[] = [a.workspaceId, ...ids, a.id];
  const kind = url.searchParams.get("kind") || "discussion";
  if (!["discussion", "report"].includes(kind))
    throw new AccessError(400, "Choose discussions or reports.");
  where.push("e.kind=?");
  args.push(kind);
  const brand = url.searchParams.get("brand");
  if (brand) {
    await requireBrand(db, a, brand);
    where.push("e.brand_id=?");
    args.push(brand);
  }
  const status = url.searchParams.get("status");
  if (status) {
    if (!["open", "resolved", "draft", "published"].includes(status))
      throw new AccessError(400, "Choose a valid status.");
    where.push("e.status=?");
    args.push(status);
  }
  if (url.searchParams.get("mine") === "true") {
    where.push("e.created_by=?");
    args.push(a.id);
  }
  if (url.searchParams.get("unread") === "true") {
    where.push(
      "e.created_by<>? AND (r.seen_at IS NULL OR r.seen_at<e.updated_at)",
    );
    args.push(a.id);
  }
  const query = (url.searchParams.get("q") || "").trim();
  if (query.length > 200)
    throw new AccessError(400, "Keep search under 200 characters.");
  if (query) {
    where.push(
      "instr(lower(e.title||' '||e.body||' '||e.next_steps||' '||e.observations||' '||e.requests||' '||u.name),lower(?))>0",
    );
    args.push(query);
  }
  const month = url.searchParams.get("month");
  if (month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new AccessError(400, "Choose a valid month.");
    where.push("substr(e.week_start,1,7)=?");
    args.push(month);
  }
  const offset = Number(url.searchParams.get("offset") || 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
    throw new AccessError(400, "Invalid page.");
  const rows = (
    await db
      .prepare(
        `SELECT e.*,u.name AS author_name,b.name AS brand_name,r.seen_at,(SELECT COUNT(*) FROM hub_team_replies c WHERE c.entry_id=e.id) AS reply_count FROM hub_team_entries e JOIN hub_users u ON u.id=e.created_by JOIN hub_brands b ON b.id=e.brand_id LEFT JOIN hub_team_reads r ON r.entry_id=e.id AND r.user_id=? WHERE ${where.join(" AND ")} ORDER BY ${kind === "report" ? "e.week_start DESC," : ""}e.updated_at DESC,e.id LIMIT 41 OFFSET ?`,
      )
      .bind(a.id, ...args, offset)
      .all()
  ).results;
  return {
    entries: rows.slice(0, 40),
    hasMore: rows.length > 40,
    offset,
    userId: a.id,
    role: a.role,
  };
}
export async function teamReferences(db: D1Database, a: Actor, brand: string) {
  await requireBrand(db, a, brand);
  const posts = (
    await db
      .prepare(
        "SELECT id,substr(text,1,160) AS title,status FROM hub_posts WHERE workspace_id=? AND brand_id=? ORDER BY updated_at DESC LIMIT 100",
      )
      .bind(a.workspaceId, brand)
      .all()
  ).results;
  const ads = (
    await db
      .prepare(
        "SELECT id,name AS title,status FROM hub_ad_builds WHERE workspace_id=? AND brand_id=? ORDER BY updated_at DESC LIMIT 100",
      )
      .bind(a.workspaceId, brand)
      .all()
  ).results;
  return { posts, ads };
}
export async function teamDetail(db: D1Database, a: Actor, id: string) {
  const entry = await teamEntry(db, a, id),
    linked = entry.reference_id
      ? await reference(
          db,
          a,
          entry.brand_id,
          entry.reference_kind,
          entry.reference_id,
        ).catch((e) => {
          if (e instanceof AccessError && e.status === 404) return null;
          throw e;
        })
      : null;
  const replies = (
    await db
      .prepare(
        "SELECT c.id,c.body,c.created_at,u.name AS author_name FROM hub_team_replies c JOIN hub_users u ON u.id=c.author_id WHERE c.entry_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT 501",
      )
      .bind(id)
      .all()
  ).results;
  const readers =
    entry.status === "draft"
      ? []
      : (
          await db
            .prepare(
              "SELECT u.name,r.seen_at FROM hub_team_reads r JOIN hub_users u ON u.id=r.user_id JOIN hub_members m ON m.user_id=r.user_id AND m.workspace_id=? AND m.active=1 WHERE r.entry_id=? AND r.seen_at>=? AND (m.role='super_admin' OR EXISTS(SELECT 1 FROM hub_brand_access b WHERE b.workspace_id=m.workspace_id AND b.user_id=m.user_id AND b.brand_id=?)) ORDER BY r.seen_at DESC",
            )
            .bind(a.workspaceId, id, entry.updated_at, entry.brand_id)
            .all()
        ).results;
  const versions = (
    await db
      .prepare(
        "SELECT version,snapshot,created_at FROM hub_team_versions WHERE entry_id=? ORDER BY version DESC LIMIT 50",
      )
      .bind(id)
      .all<{ version: number; snapshot: string; created_at: number }>()
  ).results.map((r) => ({ ...r, snapshot: JSON.parse(r.snapshot) }));
  return {
    entry,
    linked,
    replies: replies.slice(0, 500).reverse(),
    replyLimit: replies.length > 500,
    readers,
    versions,
    userId: a.id,
    role: a.role,
  };
}
export async function teamAction(
  db: D1Database,
  a: Actor,
  input: Record<string, unknown>,
  now = Date.now(),
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new AccessError(400, "Invalid team request.");
  const action = input.action;
  if (action === "create") {
    if (
      typeof input.clientKey !== "string" ||
      !/^[-a-zA-Z0-9]{20,80}$/.test(input.clientKey)
    )
      throw new AccessError(400, "A valid request identity is required.");
    const id = "team-" + input.clientKey,
      previous = await db
        .prepare(
          "SELECT id,created_by FROM hub_team_entries WHERE id=? AND workspace_id=?",
        )
        .bind(id, a.workspaceId)
        .first<{ id: string; created_by: string }>();
    if (previous) {
      if (previous.created_by !== a.id)
        throw new AccessError(409, "This request identity is in use.");
      await teamEntry(db, a, id);
      return { id };
    }
    if (typeof input.brandId !== "string")
      throw new AccessError(400, "Choose a brand.");
    await requireBrand(db, a, input.brandId);
    const kind = input.kind;
    if (!["discussion", "report"].includes(String(kind)))
      throw new AccessError(400, "Choose an item type.");
    const title = text(input, "title", 160, true),
      body = text(input, "body", 8000, true),
      category = kind === "report" ? "update" : input.category || "question";
    if (
      !["question", "request", "observation", "update"].includes(
        String(category),
      )
    )
      throw new AccessError(400, "Choose a discussion category.");
    const week = kind === "report" ? weekStart(input.weekStart) : null,
      status =
        kind === "report"
          ? input.publish === true
            ? "published"
            : "draft"
          : "open",
      linked =
        kind === "discussion"
          ? await reference(
              db,
              a,
              input.brandId,
              input.referenceKind,
              input.referenceId,
            )
          : null;
    const fields = {
      title,
      body,
      next_steps: text(input, "next_steps", 4000),
      observations: text(input, "observations", 4000),
      requests: text(input, "requests", 4000),
    };
    const row = {
      id,
      workspace_id: a.workspaceId,
      brand_id: input.brandId,
      kind,
      category,
      ...fields,
      week_start: week,
      reference_kind: linked?.kind || null,
      reference_id: linked?.id || null,
      status,
      created_by: a.id,
      version: 1,
      created_at: now,
      updated_at: now,
    };
    try {
      await db.batch([
        db
          .prepare(
            "INSERT INTO hub_team_entries(id,workspace_id,brand_id,kind,category,title,body,next_steps,observations,requests,week_start,reference_kind,reference_id,status,created_by,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(...Object.values(row)),
        ...(status === "published"
          ? [
              db
                .prepare("INSERT INTO hub_team_versions VALUES(?,?,?,?,?)")
                .bind(crypto.randomUUID(), id, 1, JSON.stringify(row), now),
            ]
          : []),
        audit(db, a, "team.created", id),
      ]);
    } catch (e) {
      if (String(e).includes("UNIQUE constraint"))
        throw new AccessError(
          409,
          "A report for this brand and week already exists. Open your existing report.",
        );
      throw e;
    }
    return { id };
  }
  if (typeof input.id !== "string")
    throw new AccessError(400, "Choose a team item.");
  const entry = await teamEntry(db, a, input.id),
    id = entry.id;
  if (action === "read") {
    await db
      .prepare(
        "INSERT INTO hub_team_reads VALUES(?,?,?) ON CONFLICT(entry_id,user_id) DO UPDATE SET seen_at=MAX(seen_at,excluded.seen_at)",
      )
      .bind(
        id,
        a.id,
        Math.min(
          entry.updated_at,
          typeof input.seenAt === "number" && Number.isFinite(input.seenAt)
            ? input.seenAt
            : 0,
        ),
      )
      .run();
    return { id };
  }
  if (action === "reply") {
    if (entry.status === "draft")
      throw new AccessError(
        409,
        "Share the report before starting a discussion.",
      );
    const body = text(input, "body", 4000, true),
      replyId = text(input, "clientKey", 80, true);
    if (!/^[-a-zA-Z0-9]{20,80}$/.test(replyId))
      throw new AccessError(400, "A valid reply identity is required.");
    const existing = await db
      .prepare("SELECT entry_id,author_id FROM hub_team_replies WHERE id=?")
      .bind(replyId)
      .first<{ entry_id: string; author_id: string }>();
    if (existing && (existing.entry_id !== id || existing.author_id !== a.id))
      throw new AccessError(409, "This reply identity is already in use.");
    await db.batch([
      db
        .prepare(
          "INSERT INTO hub_team_replies SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM hub_team_replies WHERE id=?)",
        )
        .bind(replyId, id, a.id, body, now, replyId),
      db
        .prepare(
          "UPDATE hub_team_entries SET updated_at=MAX(updated_at+1,?) WHERE id=? AND workspace_id=? AND changes()=1",
        )
        .bind(now, id, a.workspaceId),
    ]);
    return { id };
  }
  if (input.version !== entry.version)
    throw new AccessError(409, "This item changed. Reload before saving.");
  now = Math.max(now, entry.updated_at + 1);
  let statement: D1PreparedStatement,
    next: Entry = { ...entry, updated_at: now, version: entry.version + 1 };
  if (action === "resolve" || action === "reopen") {
    if (
      entry.kind !== "discussion" ||
      (a.role !== "super_admin" && a.id !== entry.created_by)
    )
      throw new AccessError(
        403,
        "Only the author or a super admin can resolve this discussion.",
      );
    next.status = action === "resolve" ? "resolved" : "open";
    statement = db
      .prepare(
        "UPDATE hub_team_entries SET status=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=?",
      )
      .bind(next.status, now, id, a.workspaceId, entry.version);
  } else if (action === "save") {
    if (a.id !== entry.created_by)
      throw new AccessError(
        403,
        "Only the author can edit this item. Add a reply instead.",
      );
    next = {
      ...next,
      title: text(input, "title", 160, true),
      body: text(input, "body", 8000, true),
      next_steps: text(input, "next_steps", 4000),
      observations: text(input, "observations", 4000),
      requests: text(input, "requests", 4000),
      status:
        entry.kind === "report"
          ? entry.status === "published" || input.publish === true
            ? "published"
            : "draft"
          : entry.status,
    };
    statement = db
      .prepare(
        "UPDATE hub_team_entries SET title=?,body=?,next_steps=?,observations=?,requests=?,status=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=?",
      )
      .bind(
        next.title,
        next.body,
        next.next_steps,
        next.observations,
        next.requests,
        next.status,
        now,
        id,
        a.workspaceId,
        entry.version,
      );
  } else throw new AccessError(400, "Unknown team action.");
  const result = await db.batch([
    statement,
    ...(entry.kind === "report" && next.status === "published"
      ? [
          db
            .prepare(
              "INSERT INTO hub_team_versions SELECT ?,?,?,?,? WHERE changes()=1",
            )
            .bind(
              crypto.randomUUID(),
              id,
              next.version,
              JSON.stringify(next),
              now,
            ),
        ]
      : []),
    db
      .prepare("INSERT INTO hub_audit SELECT ?,?,?,?,?,? WHERE changes()=1")
      .bind(
        crypto.randomUUID(),
        a.workspaceId,
        a.id,
        "team." + String(action),
        id,
        now,
      ),
  ]);
  if (!result[0].meta.changes)
    throw new AccessError(409, "This item changed. Reload before saving.");
  return { id };
}

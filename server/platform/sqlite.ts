import {
  createClient,
  type Client,
  type InValue,
  type InStatement,
} from "@libsql/client";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { HubDatabase, HubStatement } from "./types";

function fileUrl() {
  const configured = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL;
  if (process.env.VERCEL && (!configured || configured.startsWith("file:")))
    throw new Error("Configure a remote DATABASE_URL for Vercel.");
  if (configured && !configured.startsWith("file:")) return configured;
  if (configured?.startsWith("file://"))
    return pathToFileURL(fileURLToPath(configured)).href;
  const root = join(process.cwd(), ".data");
  mkdirSync(root, { recursive: true });
  const path = configured?.replace(/^file:/, "") || join(root, "hub.db");
  return pathToFileURL(path).href;
}

async function migrate(client: Client) {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS hub_schema_migrations(id TEXT PRIMARY KEY)",
  );
  const dir = join(process.cwd(), "db", "migrations");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const transaction = await client.transaction("write");
    try {
      const done = await transaction.execute({
        sql: "SELECT id FROM hub_schema_migrations WHERE id=?",
        args: [file],
      });
      if (done.rows.length) {
        await transaction.commit();
        continue;
      }
      const sql = readFileSync(join(dir, file), "utf8");
      await transaction.executeMultiple(sql);
      await transaction.execute({
        sql: "INSERT OR IGNORE INTO hub_schema_migrations VALUES(?)",
        args: [file],
      });
      await transaction.commit();
    } finally {
      transaction.close();
    }
  }
}

let cached: HubDatabase | undefined;

export function openDatabase(): HubDatabase {
  if (cached) return cached;
  const client = createClient({
    url: fileUrl(),
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  cached = createDatabase(client);
  return cached;
}

export function createDatabase(client: Client): HubDatabase {
  let ready: Promise<void> | undefined;
  const ensure = () => (ready ??= migrate(client));
  const statementInputs = new WeakMap<HubStatement, InStatement>();

  function statement(sql: string, args: InValue[] = []): HubStatement {
    const stmt: HubStatement = {
      bind(...next) {
        return statement(sql, next as InValue[]);
      },
      async first() {
        await ensure();
        const result = await client.execute({ sql, args });
        return (result.rows[0] as never) || null;
      },
      async all() {
        await ensure();
        const result = await client.execute({ sql, args });
        return { results: result.rows as never[] };
      },
      async run() {
        await ensure();
        const result = await client.execute({ sql, args });
        return { meta: { changes: result.rowsAffected } };
      },
    };
    statementInputs.set(stmt, { sql, args });
    return stmt;
  }

  return {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      await ensure();
      const queries = statements.map((item) => {
        const query = statementInputs.get(item);
        if (!query) throw new Error("Statement belongs to another database.");
        return query;
      });
      const out = await client.batch(queries, "write");
      return out.map((result) => ({ meta: { changes: result.rowsAffected } }));
    },
  };
}

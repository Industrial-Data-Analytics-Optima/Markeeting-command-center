import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase } from "../server/platform/sqlite.ts";

test("the deployed SQL adapter applies migrations and rolls back a failed multi-statement write", async () => {
  mkdirSync(".local", { recursive: true });
  const path = join(
      process.cwd(),
      ".local",
      "platform-test-" + crypto.randomUUID() + ".db",
    ),
    client = createClient({ url: pathToFileURL(path).href }),
    db = createDatabase(client);
  try {
    await db
      .prepare("INSERT INTO hub_workspaces VALUES('atomic','Atomic')")
      .run();
    await assert.rejects(
      db.batch([
        db.prepare("INSERT INTO hub_brands VALUES('b','atomic','Brand')"),
        db.prepare("INSERT INTO table_that_does_not_exist VALUES('fail')"),
      ]),
    );
    assert.equal(
      await db.prepare("SELECT id FROM hub_brands WHERE id='b'").first(),
      null,
    );
    await db.batch([
      db.prepare("INSERT INTO hub_brands VALUES('b','atomic','Brand')"),
      db.prepare(
        "INSERT INTO hub_brands SELECT 'b2','atomic','Second' WHERE changes()=1",
      ),
    ]);
    assert.equal(
      (await db.prepare("SELECT COUNT(*) n FROM hub_brands").first()).n,
      2,
    );
    assert.equal(
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM hub_schema_migrations WHERE id='0020_optional_reviews.sql'",
          )
          .first()
      ).n,
      1,
    );
  } finally {
    client.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        rmSync(path + suffix, { force: true });
      } catch (e) {
        if (!["EPERM", "EBUSY"].includes(e.code)) throw e;
        // Windows may release the native SQLite handle on the next event-loop turn.
        for (let attempt = 0; attempt < 20; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          try {
            rmSync(path + suffix, { force: true });
            break;
          } catch (retry) {
            if (!["EPERM", "EBUSY"].includes(retry.code) || attempt === 19)
              throw retry;
          }
        }
      }
    }
  }
});

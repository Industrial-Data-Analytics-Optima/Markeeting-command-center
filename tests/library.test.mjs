import test from "node:test";
import assert from "node:assert/strict";
import { identityFixture } from "./auth-fixture.mjs";
import { updateAsset } from "../server/publishing/library.ts";
test("asset edits enforce brand access and versions; archive retains stored image", async () => {
  const { db, sql } = identityFixture();
  try {
    sql.exec(
      "INSERT INTO hub_workspaces VALUES('w','Workspace'); INSERT INTO hub_users VALUES('u','u@example.test','Admin','unused'); INSERT INTO hub_members VALUES('w','u','admin',1); INSERT INTO hub_brands VALUES('b','w','Brand'); INSERT INTO hub_media(id,workspace_id,brand_id,object_key,mime,bytes,width,height,created_by,created_at) VALUES('m','w','b','private-object','image/png',100,1,1,'u',1);",
    );
    const a = { id: "u", workspaceId: "w", role: "admin" },
      input = {
        id: "m",
        version: 1,
        name: "Launch",
        folder: "Campaign",
        altText: "Product on a desk",
        archived: true,
      };
    await assert.rejects(updateAsset(db, a, input), /access/);
    sql.exec("INSERT INTO hub_brand_access VALUES('w','u','b')");
    await updateAsset(db, a, input);
    await assert.rejects(updateAsset(db, a, input), /changed elsewhere/);
    const r = sql.prepare("SELECT * FROM hub_media").get();
    assert.equal(r.archived, 1);
    assert.equal(r.object_key, "private-object");
    assert.equal(r.alt_text, "Product on a desk");
    await assert.rejects(
      updateAsset(db, a, { ...input, version: 2, name: "" }),
      /name/,
    );
  } finally {
    sql.close();
  }
});

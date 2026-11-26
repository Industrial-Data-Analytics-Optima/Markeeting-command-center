import test from "node:test";
import assert from "node:assert/strict";
import { identityFixture } from "./auth-fixture.mjs";
import {
  startUpload,
  putPart,
  finishUpload,
  partLength,
  PART_SIZE,
  abortUpload,
} from "../server/publishing/multipart.ts";
import { VIDEO_MAX } from "../server/publishing/video.ts";
const a = { id: "u", workspaceId: "w", role: "admin" };
function fixture() {
  const f = identityFixture();
  f.sql.exec(
    "INSERT INTO hub_workspaces VALUES('w','Workspace'); INSERT INTO hub_users VALUES('u','u@example.test','Admin','unused'),('x','x@example.test','Other','unused'); INSERT INTO hub_members VALUES('w','u','admin',1),('w','x','admin',1); INSERT INTO hub_brands VALUES('b','w','Brand'); INSERT INTO hub_brand_access VALUES('w','u','b'),('w','x','b');",
  );
  const parts = new Map();
  let object = null;
  const upload = {
    uploadId: "r2-upload",
    async abort() {
      parts.clear();
    },
    async uploadPart(n, bytes) {
      parts.set(n, bytes);
      return { partNumber: n, etag: "etag" + n };
    },
    async complete() {
      object = Buffer.concat([...parts.values()]);
      return { size: object.length };
    },
  };
  const bucket = {
    async createMultipartUpload() {
      return upload;
    },
    resumeMultipartUpload() {
      return upload;
    },
    async head() {
      return object ? { size: object.length } : null;
    },
    async get(key, { range }) {
      return object
        ? {
            async arrayBuffer() {
              return object
                .subarray(range.offset, range.offset + range.length)
                .buffer.slice(
                  object.byteOffset + range.offset,
                  object.byteOffset +
                    Math.min(object.length, range.offset + range.length),
                );
            },
          }
        : null;
    },
    async delete() {
      object = null;
    },
  };
  return { ...f, bucket, parts };
}
test("500 MB boundary and exact chunk sizes are enforced before allocating upload storage", async () => {
  const { db, sql, bucket } = fixture();
  try {
    assert.equal(VIDEO_MAX, 500000000);
    await assert.rejects(
      startUpload(db, bucket, a, {
        brandId: "b",
        size: VIDEO_MAX + 1,
        name: "large.mp4",
      }),
      /500 MB/,
    );
    const { id } = await startUpload(db, bucket, a, {
      brandId: "b",
      size: VIDEO_MAX,
      name: "large.mp4",
    });
    assert.equal(
      sql.prepare("SELECT bytes FROM hub_media_uploads WHERE id=?").get(id)
        .bytes,
      VIDEO_MAX,
    );
    assert.equal(partLength(PART_SIZE + 10, 1), PART_SIZE);
    assert.equal(partLength(PART_SIZE + 10, 2), 10);
    assert.throws(() => partLength(PART_SIZE, 2), /Invalid/);
    await assert.rejects(
      putPart(db, bucket, a, id, 1, new Uint8Array(1)),
      /size/,
    );
  } finally {
    sql.close();
  }
});
test("upload parts, finalization and cancellation are bound to user and brand; incomplete uploads never become media", async () => {
  const { db, sql, bucket } = fixture();
  try {
    const { id } = await startUpload(db, bucket, a, {
      brandId: "b",
      size: 80000,
      name: "clip.mp4",
    });
    await assert.rejects(
      putPart(db, bucket, { ...a, id: "x" }, id, 1, new Uint8Array(80000)),
      /not found/,
    );
    await assert.rejects(finishUpload(db, bucket, a, id), /missing/);
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM hub_media").get().n, 0);
    await abortUpload(db, bucket, a, id);
    await assert.rejects(
      putPart(db, bucket, a, id, 1, new Uint8Array(80000)),
      /no longer/,
    );
  } finally {
    sql.close();
  }
});
test("invalid completed files are removed and never exposed in the library", async () => {
  const { db, sql, bucket } = fixture();
  try {
    const { id } = await startUpload(db, bucket, a, {
      brandId: "b",
      size: 80000,
      name: "fake.mp4",
    });
    await putPart(db, bucket, a, id, 1, new Uint8Array(80000));
    await assert.rejects(finishUpload(db, bucket, a, id), /invalid/);
    assert.equal(await bucket.head(), null);
    assert.equal(
      sql.prepare("SELECT status FROM hub_media_uploads").get().status,
      "failed",
    );
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM hub_media").get().n, 0);
  } finally {
    sql.close();
  }
});

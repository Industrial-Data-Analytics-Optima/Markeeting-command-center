import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import {
  readTextLimited,
  readJsonObject,
  validAppOrigin,
} from "../server/security/request.ts";
import { contentSecurityPolicy } from "../server/security/headers.ts";
import { fileMedia } from "../server/platform/media.ts";

test("JSON requests have streaming byte limits even without a declared length", async () => {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode("a".repeat(8)));
      c.enqueue(new TextEncoder().encode("b".repeat(8)));
      c.close();
    },
  });
  await assert.rejects(
    readTextLimited(
      new Request("https://hub.test", {
        method: "POST",
        body: stream,
        duplex: "half",
      }),
      10,
    ),
    (e) => e.status === 413,
  );
  await assert.rejects(
    readTextLimited(
      new Request("https://hub.test", { method: "POST", body: "ééé" }),
      5,
    ),
    (e) => e.status === 413,
  );
  assert.deepEqual(
    await readJsonObject(
      new Request("https://hub.test", {
        method: "POST",
        body: '{"message":"hello"}',
      }),
      100,
    ),
    { message: "hello" },
  );
  for (const body of ["null", "[]", "true", '"text"', "{invalid"])
    await assert.rejects(
      readJsonObject(
        new Request("https://hub.test", { method: "POST", body }),
        100,
      ),
      (e) => e.status === 400,
    );
  await assert.rejects(
    readTextLimited(
      new Request("https://hub.test", {
        method: "POST",
        body: "small",
        headers: { "Content-Length": "999" },
      }),
      100,
    ),
    (e) => e.status === 413,
  );
});

test("OAuth app origins reject insecure schemes and embedded credentials", () => {
  assert.equal(validAppOrigin("https://hub.test").origin, "https://hub.test");
  assert.equal(validAppOrigin("http://localhost:3000").protocol, "http:");
  for (const value of [
    "ftp://localhost",
    "http://example.com",
    "https://name:secret@example.com",
    "javascript:alert(1)",
  ])
    assert.throws(() => validAppOrigin(value));
});

test("production CSP uses per-request script nonces and blocks framing/objects/foreign connections", () => {
  const policy = contentSecurityPolicy("random-nonce", false, true);
  assert.ok(policy.includes("'nonce-random-nonce'"));
  assert.ok(policy.includes("frame-ancestors 'none'"));
  assert.ok(policy.includes("object-src 'none'"));
  assert.ok(policy.includes("connect-src 'self'"));
  assert.ok(policy.includes("upgrade-insecure-requests"));
  assert.ok(!policy.includes("'unsafe-eval'"));
  assert.ok(!policy.match(/script-src[^;]*'unsafe-inline'/));
  assert.ok(
    contentSecurityPolicy("dev", true, false).includes("'unsafe-eval'"),
  );
});

test("filesystem storage rejects traversal and absolute paths and supports normal private object keys", async () => {
  mkdirSync(".local", { recursive: true });
  const root = mkdtempSync(join(resolve(".local"), "media-security-")),
    bucket = fileMedia(root);
  try {
    for (const key of [
      "../escape",
      "a/../../escape",
      "a\\..\\escape",
      "/absolute",
      "C:/absolute",
      "a//bad",
      "a/./bad",
      "a\0bad",
    ])
      await assert.rejects(bucket.put(key, new Uint8Array([1])));
    await bucket.put("workspace/brand/file", new Uint8Array([1, 2, 3]));
    assert.equal((await bucket.head("workspace/brand/file")).size, 3);
    assert.deepEqual(
      new Uint8Array(
        await (await bucket.get("workspace/brand/file")).arrayBuffer(),
      ),
      new Uint8Array([1, 2, 3]),
    );
  } finally {
    assert.ok(relative(resolve(".local"), root).startsWith("media-security-"));
    rmSync(root, { recursive: true, force: true });
  }
});

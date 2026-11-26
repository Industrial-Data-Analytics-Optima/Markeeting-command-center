import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectVideo,
  inspectStoredVideo,
  VIDEO_MAX,
} from "../server/publishing/video.ts";
import { linkedinClient } from "../server/publishing/linkedin.ts";
const box = (type, ...parts) => {
  const body = Buffer.concat(parts),
    b = Buffer.alloc(8);
  b.writeUInt32BE(body.length + 8);
  b.write(type, 4);
  return Buffer.concat([b, body]);
};
function mp4(seconds = 10, codec = "avc1") {
  const mv = Buffer.alloc(100);
  mv.writeUInt32BE(1000, 12);
  mv.writeUInt32BE(seconds * 1000, 16);
  const handler = Buffer.alloc(20);
  handler.write("vide", 8);
  const sample = Buffer.alloc(78);
  sample.writeUInt16BE(1920, 24);
  sample.writeUInt16BE(1080, 26);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(1, 4);
  return (
    box("ftyp", Buffer.from("isom0000")).length &&
    Buffer.concat([
      box("ftyp", Buffer.from("isom0000")),
      box(
        "moov",
        box("mvhd", mv),
        box(
          "trak",
          box(
            "mdia",
            box("hdlr", handler),
            box("minf", box("stbl", box("stsd", header, box(codec, sample)))),
          ),
        ),
      ),
      box("mdat", Buffer.alloc(80000)),
    ])
  );
}
test("video inspection reads real container metadata and rejects disguised, truncated, oversized-duration and unsupported codec files", () => {
  assert.deepEqual(inspectVideo(mp4()), {
    width: 1920,
    height: 1080,
    duration: 10,
  });
  for (const b of [
    Buffer.alloc(80000),
    mp4().subarray(0, 79000),
    mp4(2),
    mp4(1801),
    mp4(10, "hvc1"),
  ])
    assert.throws(() => inspectVideo(b), /valid H.264/);
});
test("LinkedIn video parts finalize in order and processing gates publication", async () => {
  const calls = [];
  const client = linkedinClient("secret", "202609", async (url, init) => {
    calls.push({ url, init });
    if (url.includes("initializeUpload"))
      return Response.json({
        value: {
          video: "urn:li:video:abc",
          uploadToken: "token",
          uploadInstructions: [
            {
              firstByte: 0,
              lastByte: 1,
              uploadUrl: "https://www.linkedin.com/upload/1",
            },
            {
              firstByte: 2,
              lastByte: 3,
              uploadUrl: "https://www.linkedin.com/upload/2",
            },
          ],
        },
      });
    if (url.includes("/upload/"))
      return new Response(null, {
        headers: { etag: '"part' + calls.length + '"' },
      });
    if (url.includes("finalizeUpload"))
      return new Response(null, { status: 200 });
    return Response.json({ status: "PROCESSING" });
  });
  assert.equal(
    await client.uploadVideo(
      "urn:li:organization:1",
      new Uint8Array([1, 2, 3, 4]).buffer,
    ),
    "urn:li:video:abc",
  );
  assert.deepEqual([...new Uint8Array(calls[1].init.body)], [1, 2]);
  assert.deepEqual([...new Uint8Array(calls[2].init.body)], [3, 4]);
  assert.deepEqual(
    JSON.parse(calls[3].init.body).finalizeUploadRequest.uploadedPartIds,
    ["part2", "part3"],
  );
  assert.equal(await client.videoReady("urn:li:video:abc"), false);
});
test("video upload rejects external credential destinations before sending bytes", async () => {
  let count = 0;
  const c = linkedinClient("secret", "202609", async () => {
    count++;
    return Response.json({
      value: {
        video: "urn:li:video:abc",
        uploadToken: "",
        uploadInstructions: [
          {
            firstByte: 0,
            lastByte: 3,
            uploadUrl: "https://attacker.test/upload",
          },
        ],
      },
    });
  });
  await assert.rejects(
    c.uploadVideo("urn:li:organization:1", new ArrayBuffer(4)),
    /invalid video upload/,
  );
  assert.equal(count, 1);
});
test("video processing failure is terminal and video post payload omits image-only alt text", async () => {
  const failed = linkedinClient("token", "202609", async () =>
    Response.json({ status: "PROCESSING_FAILED" }),
  );
  await assert.rejects(
    failed.videoReady("urn:li:video:abc"),
    (e) => e.kind === "failed" && e.code === "MEDIA_PROCESSING",
  );
  let payload;
  const ready = linkedinClient("token", "202609", async (url, init) => {
    payload = JSON.parse(init.body);
    return new Response(null, {
      status: 201,
      headers: { "x-restli-id": "urn:li:share:123" },
    });
  });
  assert.equal(
    await ready.publish(
      "urn:li:organization:1",
      "Video caption",
      "urn:li:video:abc",
      "library description",
    ),
    "urn:li:share:123",
  );
  assert.deepEqual(payload.content.media, { id: "urn:li:video:abc" });
  assert.equal(payload.commentary, "Video caption");
});
test("500 MB MP4 with metadata at the end validates with small range reads", async () => {
  const file = mp4(),
    ftyp = file.subarray(0, 16),
    moov = file.subarray(16, 16 + file.readUInt32BE(16)),
    mdatSize = VIDEO_MAX - ftyp.length - moov.length,
    header = Buffer.alloc(8);
  header.writeUInt32BE(mdatSize);
  header.write("mdat", 4);
  const segments = [
      [0, ftyp],
      [ftyp.length, header],
      [ftyp.length + mdatSize, moov],
    ],
    reads = [];
  const result = await inspectStoredVideo(VIDEO_MAX, async (offset, length) => {
    reads.push(length);
    const out = Buffer.alloc(length);
    for (const [start, b] of segments) {
      const lo = Math.max(offset, start),
        hi = Math.min(offset + length, start + b.length);
      if (hi > lo) b.copy(out, lo - offset, lo - start, hi - start);
    }
    return out;
  });
  assert.deepEqual(result, { width: 1920, height: 1080, duration: 10 });
  assert.ok(Math.max(...reads) < 1000);
  assert.ok(reads.length < 10);
});
test("LinkedIn delivery consumes the range-reader interface one part at a time", async () => {
  const reads = [];
  const client = linkedinClient("token", "202609", async (url) => {
    if (url.includes("initializeUpload"))
      return Response.json({
        value: {
          video: "urn:li:video:abc",
          uploadToken: "",
          uploadInstructions: [
            {
              firstByte: 0,
              lastByte: 3,
              uploadUrl: "https://www.linkedin.com/upload/1",
            },
            {
              firstByte: 4,
              lastByte: 7,
              uploadUrl: "https://www.linkedin.com/upload/2",
            },
          ],
        },
      });
    if (url.includes("/upload/"))
      return new Response(null, { headers: { etag: "part" } });
    return new Response(null);
  });
  await client.uploadVideo("urn:li:organization:1", {
    size: 8,
    read: async (offset, length) => {
      reads.push([offset, length]);
      return new ArrayBuffer(length);
    },
  });
  assert.deepEqual(reads, [
    [0, 4],
    [4, 4],
  ]);
});

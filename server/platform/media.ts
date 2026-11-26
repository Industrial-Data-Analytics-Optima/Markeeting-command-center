import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  MediaBucket,
  MediaObject,
  MultipartUpload,
  ResumedUpload,
} from "./types";

function rangeFrom(
  options: { range?: Headers | { offset: number; length: number } } | undefined,
  size: number,
) {
  const range = options?.range;
  if (!range) return { offset: 0, length: size };
  if (range && typeof (range as Headers).get === "function") {
    const header = (range as Headers).get("range") || "";
    const match = /bytes=(\d+)-(\d*)/.exec(header);
    if (!match) return { offset: 0, length: size };
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : size - 1;
    return { offset: start, length: Math.max(0, end - start + 1) };
  }
  return range as { offset: number; length: number };
}

function objectFrom(
  bytes: Uint8Array,
  slice: { offset: number; length: number },
  size: number,
): MediaObject {
  const part = Buffer.from(
    bytes.subarray(slice.offset, slice.offset + slice.length),
  );
  return {
    body: new Blob([part]).stream(),
    size,
    range: slice,
    arrayBuffer: () =>
      Promise.resolve(
        part.buffer.slice(
          part.byteOffset,
          part.byteOffset + part.byteLength,
        ) as ArrayBuffer,
      ),
  };
}

export function fileMedia(
  root = join(process.cwd(), ".data", "media"),
): MediaBucket {
  mkdirSync(root, { recursive: true });
  const base = resolve(root);
  const pathFor = (key: string) => {
    if (
      !key ||
      /^[a-zA-Z]:/.test(key) ||
      key.includes("\\") ||
      key.includes("\0") ||
      key.split("/").some((p) => p === ".." || p === "." || !p)
    )
      throw new Error("Invalid storage key.");
    const path = resolve(base, key);
    if (!path.startsWith(base + sep)) throw new Error("Invalid storage key.");
    return path;
  };
  const uploads = new Map<
    string,
    { key: string; parts: Map<number, Uint8Array> }
  >();

  const resume = (key: string, uploadId: string): ResumedUpload => ({
    async uploadPart(part, bytes) {
      const session = uploads.get(uploadId);
      if (!session) throw new Error("Upload is not active.");
      session.parts.set(part, bytes);
      return { etag: "part-" + part };
    },
    async complete(parts) {
      const session = uploads.get(uploadId);
      if (!session) throw new Error("Upload is not active.");
      const chunks = parts.map((p) => {
        const bytes = session.parts.get(p.partNumber);
        if (!bytes) throw new Error("Missing upload part.");
        return bytes;
      });
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      await bucket.put(key, merged);
      uploads.delete(uploadId);
      return { size: total };
    },
    async abort() {
      uploads.delete(uploadId);
      try {
        rmSync(pathFor(key), { force: true });
      } catch {
        /* ignore */
      }
    },
  });

  const bucket: MediaBucket = {
    async put(key, bytes) {
      const file = pathFor(key);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        file,
        bytes instanceof Uint8Array
          ? bytes
          : new Uint8Array(bytes as ArrayBuffer),
      );
    },
    async get(key, options) {
      const file = pathFor(key);
      if (!existsSync(file)) return null;
      const buf = new Uint8Array(readFileSync(file));
      return objectFrom(buf, rangeFrom(options, buf.length), buf.length);
    },
    async head(key) {
      const file = pathFor(key);
      if (!existsSync(file)) return null;
      return { size: statSync(file).size };
    },
    async delete(key) {
      rmSync(pathFor(key), { force: true });
    },
    async createMultipartUpload(key): Promise<MultipartUpload> {
      const uploadId = randomUUID();
      uploads.set(uploadId, { key, parts: new Map() });
      return { uploadId, abort: () => resume(key, uploadId).abort() };
    },
    resumeMultipartUpload(key, uploadId) {
      return resume(key, uploadId);
    },
  };
  return bucket;
}

export async function blobMedia(): Promise<MediaBucket> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return fileMedia();
  const { put, del, head, get } = await import("@vercel/blob");
  const readAll = async (key: string) => {
    const info = await head(key, { token });
    if (Number(info.size) > 32 * 1024 * 1024)
      throw new Error(
        "This object requires the pending streaming storage adapter.",
      );
    const result = await get(key, { access: "private", token });
    if (!result?.stream) return null;
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  };
  const uploads = new Map<
    string,
    { key: string; parts: Map<number, Uint8Array> }
  >();
  const resume = (key: string, uploadId: string): ResumedUpload => ({
    async uploadPart(part, bytes) {
      const session = uploads.get(uploadId);
      if (!session) throw new Error("Upload is not active.");
      session.parts.set(part, bytes);
      await put(key + ".part." + part, Buffer.from(bytes), {
        access: "private",
        token,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return { etag: "part-" + part };
    },
    async complete(parts) {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (const part of parts) {
        const bytes = await readAll(key + ".part." + part.partNumber);
        if (!bytes) throw new Error("Missing upload part.");
        chunks.push(bytes);
        total += bytes.length;
        await del(key + ".part." + part.partNumber, { token }).catch(
          () => undefined,
        );
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      await put(key, Buffer.from(merged), {
        access: "private",
        token,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      uploads.delete(uploadId);
      return { size: total };
    },
    async abort() {
      uploads.delete(uploadId);
      await del(key, { token }).catch(() => undefined);
    },
  });
  return {
    async put(key, bytes, options) {
      await put(
        key,
        Buffer.from(
          bytes instanceof Uint8Array
            ? bytes
            : new Uint8Array(bytes as ArrayBuffer),
        ),
        {
          access: "private",
          token,
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: options?.httpMetadata?.contentType,
        },
      );
    },
    async get(key, options) {
      try {
        const buf = await readAll(key);
        if (!buf) return null;
        return objectFrom(buf, rangeFrom(options, buf.length), buf.length);
      } catch {
        return null;
      }
    },
    async head(key) {
      try {
        const info = await head(key, { token });
        return { size: Number(info.size || 0) };
      } catch {
        return null;
      }
    },
    async delete(key) {
      await del(key, { token }).catch(() => undefined);
    },
    async createMultipartUpload(key) {
      const uploadId = randomUUID();
      uploads.set(uploadId, { key, parts: new Map() });
      return { uploadId, abort: () => resume(key, uploadId).abort() };
    },
    resumeMultipartUpload(key, uploadId) {
      return resume(key, uploadId);
    },
  };
}

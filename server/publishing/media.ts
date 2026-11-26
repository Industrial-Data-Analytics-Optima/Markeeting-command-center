import { AccessError } from "../auth/core.ts";
export function inspectImage(bytes: Uint8Array, mime: string) {
  let width = 0,
    height = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    mime === "image/png" &&
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
  ) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (
    mime === "image/jpeg" &&
    bytes.length > 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216
  ) {
    let i = 2;
    while (i + 4 < bytes.length) {
      if (bytes[i] !== 255) break;
      const marker = bytes[i + 1];
      if (marker === 217 || marker === 218) break;
      const length = view.getUint16(i + 2);
      if (length < 2 || i + 2 + length > bytes.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        length >= 7
      ) {
        height = view.getUint16(i + 5);
        width = view.getUint16(i + 7);
        break;
      }
      i += length + 2;
    }
  }
  if (!width || !height || width * height >= 36152320)
    throw new AccessError(
      400,
      "Choose a valid JPEG or PNG image under 36 megapixels.",
    );
  return { width, height };
}
export async function readLimited(request: Request, max = 5 * 1024 * 1024) {
  const reader = request.body?.getReader();
  if (!reader) throw new AccessError(400, "Choose a media file.");
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) {
      await reader.cancel();
      throw new AccessError(
        413,
        "This file exceeds the upload limit (" +
          Math.round(max / 1024 / 1024) +
          " MB).",
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

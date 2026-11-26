import { AccessError } from "../auth/core.ts";
export const VIDEO_MAX = 500000000;
export function inspectVideo(b: Uint8Array) {
  const fail = () => {
    throw new AccessError(
      400,
      "Use a valid H.264 MP4 video, 3 seconds to 30 minutes, 75 KB to 500 MB.",
    );
  };
  if (b.length < 75000 || b.length > VIDEO_MAX) fail();
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength),
    str = (p: number) => String.fromCharCode(...b.subarray(p, p + 4));
  type Box = { type: string; start: number; end: number };
  function boxes(start: number, end: number): Box[] {
    const out: Box[] = [];
    let p = start;
    while (p < end) {
      if (out.length > 10000) fail();
      if (p + 8 > end) fail();
      let n = v.getUint32(p),
        head = 8;
      if (n === 1) {
        if (p + 16 > end) fail();
        n = Number(v.getBigUint64(p + 8));
        head = 16;
      }
      if (n === 0) n = end - p;
      if (!Number.isSafeInteger(n) || n < head || p + n > end) fail();
      out.push({ type: str(p + 4), start: p + head, end: p + n });
      p += n;
    }
    return out;
  }
  const top = boxes(0, b.length);
  if (
    !top.some((x) => x.type === "ftyp") ||
    !top.some((x) => x.type === "mdat" && x.end > x.start)
  )
    fail();
  const moov = top.find((x) => x.type === "moov");
  if (!moov) fail();
  const children = boxes(moov!.start, moov!.end),
    mv = children.find((x) => x.type === "mvhd");
  if (!mv || mv.end - mv.start < 24) fail();
  const p = mv!.start,
    version = b[p];
  if (version > 1) fail();
  if (version === 1 && mv!.end - p < 32) fail();
  const scale = v.getUint32(p + (version === 1 ? 20 : 12)),
    ticks =
      version === 1 ? Number(v.getBigUint64(p + 24)) : v.getUint32(p + 16),
    duration = ticks / scale;
  if (!Number.isFinite(duration) || duration < 3 || duration > 1800) fail();
  let width = 0,
    height = 0;
  for (const track of children.filter((x) => x.type === "trak")) {
    const tc = boxes(track.start, track.end),
      mdia = tc.find((x) => x.type === "mdia");
    if (!mdia) continue;
    const mc = boxes(mdia.start, mdia.end),
      handler = mc.find((x) => x.type === "hdlr");
    if (
      !handler ||
      handler.end - handler.start < 12 ||
      str(handler.start + 8) !== "vide"
    )
      continue;
    const minf = mc.find((x) => x.type === "minf");
    if (!minf) fail();
    const stbl = boxes(minf!.start, minf!.end).find((x) => x.type === "stbl");
    if (!stbl) fail();
    const stsd = boxes(stbl!.start, stbl!.end).find((x) => x.type === "stsd");
    if (!stsd || stsd.end - stsd.start < 8) fail();
    const entries = boxes(stsd!.start + 8, stsd!.end);
    if (
      !entries.length ||
      entries.some((x) => !["avc1", "avc3"].includes(x.type))
    )
      fail();
    const sample = entries[0];
    if (sample.end - sample.start < 78) fail();
    width = v.getUint16(sample.start + 24);
    height = v.getUint16(sample.start + 26);
    if (!width || !height || width > 7680 || height > 4320) fail();
  }
  if (!width || !height) fail();
  return { width, height, duration };
}
// Scan box headers with range reads; the large media-data box never enters memory.
export async function inspectStoredVideo(
  size: number,
  read: (offset: number, length: number) => Promise<Uint8Array>,
) {
  const fail = () => {
    throw new AccessError(
      400,
      "This MP4 is invalid or its metadata is too complex. Re-export as H.264 MP4.",
    );
  };
  if (size < 75000 || size > VIDEO_MAX)
    throw new AccessError(400, "Videos must be 75 KB to 500 MB.");
  let p = 0,
    count = 0,
    hasType = false,
    hasData = false,
    moov: Uint8Array | null = null;
  while (p < size) {
    if (++count > 128 || p + 8 > size) fail();
    const h = await read(p, Math.min(16, size - p));
    if (h.length < 8) fail();
    const v = new DataView(h.buffer, h.byteOffset, h.byteLength),
      type = String.fromCharCode(...h.subarray(4, 8));
    let n = v.getUint32(0),
      head = 8;
    if (n === 1) {
      if (h.length < 16) fail();
      n = Number(v.getBigUint64(8));
      head = 16;
    }
    if (n === 0) n = size - p;
    if (!Number.isSafeInteger(n) || n < head || p + n > size) fail();
    if (type === "ftyp") hasType = true;
    if (type === "mdat" && n > head) hasData = true;
    if (type === "moov") {
      if (moov || n > 8 * 1024 * 1024) fail();
      moov = await read(p, n);
      if (moov.length !== n) fail();
    }
    p += n;
  }
  if (!hasType || !hasData || !moov) fail();
  const ftyp = new Uint8Array([
      0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0,
    ]),
    mdat = new Uint8Array(75000);
  new DataView(mdat.buffer).setUint32(0, mdat.length);
  mdat.set([109, 100, 97, 116], 4);
  const metadata = new Uint8Array(ftyp.length + moov!.length + mdat.length);
  metadata.set(ftyp);
  metadata.set(moov!, ftyp.length);
  metadata.set(mdat, ftyp.length + moov!.length);
  return inspectVideo(metadata);
}

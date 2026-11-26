import { AccessError } from "../auth/core.ts";
/** Enforce the byte budget while streaming, including requests without Content-Length. */
export async function readTextLimited(request: Request, maxBytes: number) {
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > maxBytes)
  )
    throw new AccessError(413, "Request too large.");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0,
    text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AccessError(413, "Request too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof AccessError) throw error;
    throw new AccessError(400, "Invalid request encoding.");
  } finally {
    reader.releaseLock();
  }
}
export function validAppOrigin(value: string) {
  const origin = new URL(value),
    local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (
    origin.username ||
    origin.password ||
    !(origin.protocol === "https:" || (origin.protocol === "http:" && local))
  )
    throw new AccessError(
      503,
      "Configure an HTTPS app address, or HTTP localhost for development.",
    );
  return origin;
}

export async function readJsonObject(request: Request, maxBytes: number) {
  const text = await readTextLimited(request, maxBytes);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AccessError(400, "A JSON object is required.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AccessError(400, "A JSON object is required.");
  return value as Record<string, unknown>;
}

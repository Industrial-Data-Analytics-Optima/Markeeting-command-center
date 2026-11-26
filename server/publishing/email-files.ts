import { AccessError } from "../auth/core.ts";
export function inspectEmailFile(name: string, bytes: Uint8Array) {
  if (
    !name ||
    name.length > 180 ||
    /[\r\n\x00\/\\]/.test(name) ||
    !bytes.length ||
    bytes.length > 20 * 1024 * 1024
  )
    throw new AccessError(400, "Choose a file up to 20 MB with a valid name.");
  const extension = name.split(".").pop()?.toLowerCase();
  if (
    extension === "pdf" &&
    String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-"
  )
    return "application/pdf";
  const office: Record<string, string> = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  if (
    extension &&
    office[extension] &&
    bytes[0] === 80 &&
    bytes[1] === 75 &&
    bytes[2] === 3 &&
    bytes[3] === 4
  )
    return office[extension];
  if (extension === "csv" || extension === "txt") {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new AccessError(400, "Text attachments must use UTF-8 encoding.");
    }
    return extension === "csv" ? "text/csv" : "text/plain";
  }
  throw new AccessError(
    400,
    "Choose a PDF, DOCX, XLSX, PPTX, CSV or TXT document. Images and videos can be selected from the media library.",
  );
}

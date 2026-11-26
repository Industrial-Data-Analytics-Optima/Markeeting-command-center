import { mimeMessage, base64Chunks, streamChunks } from "./mime.ts";
import type { OutgoingMail } from "./mime.ts";
export class MailError extends Error {
  uncertain: boolean;
  constructor(uncertain: boolean, message: string) {
    super(message);
    this.uncertain = uncertain;
  }
}
export type IncomingFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
};
export type SyncedMail = {
  cc?: string[];
  files?: IncomingFile[];
  providerId: string;
  threadId: string;
  direction: "incoming" | "outgoing";
  sender: string;
  to: string[];
  replyTo: string[];
  subject: string;
  body: string;
  receivedAt: number;
  internetMessageId: string | null;
};
export function mailProvider(
  provider: string,
  token: string,
  mailboxAddress: string,
  fetcher: typeof fetch = fetch,
) {
  if (!["google", "microsoft"].includes(provider))
    throw new MailError(false, "Unsupported mailbox provider.");
  const google = provider === "google",
    root = google
      ? "https://gmail.googleapis.com/"
      : "https://graph.microsoft.com/v1.0/";
  async function call(
    path: string,
    options: RequestInit = {},
    sending = false,
  ) {
    let response: Response;
    try {
      response = await fetcher(root + path, {
        ...options,
        headers: {
          Authorization: "Bearer " + token,
          ...(google ? {} : { Prefer: 'IdType="ImmutableId"' }),
          ...options.headers,
        },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new MailError(
        sending,
        sending
          ? "Submission outcome unknown. Check Sent before retrying."
          : "Mailbox could not be reached.",
      );
    }
    if (!response.ok)
      throw new MailError(
        sending && (response.status >= 500 || response.status === 408),
        "Mailbox request failed (" +
          response.status +
          ")." +
          (sending ? " Check the delivery status before retrying." : ""),
      );
    return response;
  }
  return {
    async send(mail: OutgoingMail) {
      const mime = mimeMessage(mail);
      if (!google) {
        const length = 4 * Math.ceil(mime.length / 3);
        await call(
          "me/sendMail",
          {
            method: "POST",
            headers: {
              "Content-Type": "text/plain",
              "Content-Length": String(length),
            },
            body: streamChunks(base64Chunks(mime.chunks()), length),
          },
          true,
        );
        return { id: null as string | null };
      }
      const boundary = "meta_" + crypto.randomUUID(),
        prefix = new TextEncoder().encode(
          "--" +
            boundary +
            "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
            JSON.stringify(mail.threadId ? { threadId: mail.threadId } : {}) +
            "\r\n--" +
            boundary +
            "\r\nContent-Type: message/rfc822\r\n\r\n",
        ),
        suffix = new TextEncoder().encode("\r\n--" + boundary + "--\r\n");
      async function* parts() {
        yield prefix;
        yield* mime.chunks();
        yield suffix;
      }
      const length = prefix.length + mime.length + suffix.length;
      const r = await call(
        "upload/gmail/v1/users/me/messages/send?uploadType=multipart",
        {
          method: "POST",
          headers: {
            "Content-Type": "multipart/related; boundary=" + boundary,
            "Content-Length": String(length),
          },
          body: streamChunks(parts(), length),
        },
        true,
      );
      const d = (await r.json()) as { id?: string };
      if (!d.id)
        throw new MailError(
          true,
          "Provider accepted the message without a usable ID. Check Sent before retrying.",
        );
      return { id: d.id };
    },
    async download(messageId: string, file: IncomingFile) {
      if (file.size > 20 * 1024 * 1024)
        throw new MailError(
          false,
          "This attachment exceeds the hub’s 20 MB download limit. Open the provider mailbox to download it.",
        );
      if (!google) {
        const r = await call(
          "me/messages/" +
            encodeURIComponent(messageId) +
            "/attachments/" +
            encodeURIComponent(file.id) +
            "/$value",
        );
        return r.body!;
      }
      let data: string | undefined;
      if (file.id.startsWith("a:")) {
        const d = (await (
          await call(
            "gmail/v1/users/me/messages/" +
              encodeURIComponent(messageId) +
              "/attachments/" +
              encodeURIComponent(file.id.slice(2)),
          )
        ).json()) as { data?: string };
        data = d.data;
      } else if (file.id.startsWith("p:")) {
        const d = (await (
          await call(
            "gmail/v1/users/me/messages/" +
              encodeURIComponent(messageId) +
              "?format=full",
          )
        ).json()) as { payload?: GmailPart };
        const find = (p: GmailPart | undefined): string | undefined =>
          !p
            ? undefined
            : p.partId === file.id.slice(2)
              ? p.body?.data
              : p.parts?.map(find).find(Boolean);
        data = find(d.payload);
      }
      if (!data) throw new MailError(false, "The attachment is unavailable.");
      const bytes = Buffer.from(data, "base64url");
      if (bytes.length > 20 * 1024 * 1024)
        throw new MailError(false, "This attachment is too large.");
      return new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(bytes);
          c.close();
        },
      });
    },
    async list(
      cursor: string | null,
    ): Promise<{ messages: SyncedMail[]; cursor: string | null }> {
      if (google) {
        const q = new URLSearchParams({
            q: "(in:inbox OR in:sent) newer_than:30d",
            maxResults: "20",
            ...(cursor ? { pageToken: cursor } : {}),
          }),
          d = (await (
            await call("gmail/v1/users/me/messages?" + q)
          ).json()) as { messages?: { id: string }[]; nextPageToken?: string };
        const messages: SyncedMail[] = [];
        for (const item of d.messages || []) {
          const m = (await (
            await call(
              "gmail/v1/users/me/messages/" +
                encodeURIComponent(item.id) +
                "?format=full",
            )
          ).json()) as {
            id: string;
            threadId: string;
            internalDate: string;
            labelIds?: string[];
            snippet?: string;
            payload?: GmailPart;
          };
          const receivedAt = providerTime(Number(m.internalDate));
          const headers = m.payload?.headers || [],
            h = (name: string) =>
              headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
                ?.value || "";
          messages.push({
            providerId: m.id,
            threadId: m.threadId,
            direction: m.labelIds?.includes("SENT") ? "outgoing" : "incoming",
            sender: address(h("From")),
            to: addresses(h("To")),
            cc: addresses(h("Cc")),
            files: gmailFiles(m.payload),
            replyTo: addresses(h("Reply-To")),
            subject: decodeHeader(h("Subject")),
            body:
              plainPart(m.payload) ||
              htmlToText(htmlPart(m.payload)) ||
              "[Empty message body]",
            receivedAt,
            internetMessageId: h("Message-ID") || null,
          });
        }
        return { messages, cursor: d.nextPageToken || null };
      }
      type State = { folder: "inbox" | "sentitems"; next: string | null };
      async function folderPage(state: State) {
        if (!["inbox", "sentitems"].includes(state.folder))
          throw new MailError(false, "Invalid mailbox folder.");
        const params = new URLSearchParams({
          $top: "25",
          $orderby: "receivedDateTime desc",
          $filter:
            "receivedDateTime ge " +
            new Date(Date.now() - 30 * 86400000).toISOString(),
          $select:
            "id,conversationId,from,toRecipients,replyTo,subject,body,receivedDateTime,internetMessageId,isDraft,ccRecipients,hasAttachments",
        });
        let path = "me/mailFolders/" + state.folder + "/messages?" + params;
        if (state.next) {
          if (!state.next.startsWith(root))
            throw new MailError(false, "Invalid mailbox continuation.");
          path = state.next.slice(root.length);
        }
        const d = (await (
          await call(path, {
            headers: {
              Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"',
            },
          })
        ).json()) as { value?: GraphMail[]; "@odata.nextLink"?: string };
        const messages: SyncedMail[] = (d.value || [])
          .filter((m) => !m.isDraft)
          .map((m) => ({
            providerId: m.id,
            threadId: m.conversationId,
            direction:
              state.folder === "sentitems"
                ? ("outgoing" as const)
                : ("incoming" as const),
            sender: m.from?.emailAddress?.address || "",
            to: (m.toRecipients || []).map((r) => r.emailAddress.address),
            cc: (m.ccRecipients || []).map((r) => r.emailAddress.address),
            files: [],
            replyTo: (m.replyTo || []).map((r) => r.emailAddress.address),
            subject: m.subject || "",
            body:
              m.body?.contentType?.toLowerCase() === "text"
                ? (m.body.content || "").slice(0, 100000)
                : m.body?.contentType?.toLowerCase() === "html"
                  ? htmlToText(m.body.content || "")
                  : "[Message body unavailable]",
            receivedAt: providerTime(Date.parse(m.receivedDateTime)),
            internetMessageId: m.internetMessageId || null,
          }));
        for (const message of messages) {
          const original = d.value?.find((m) => m.id === message.providerId);
          if (original?.hasAttachments) {
            const files = (await (
              await call(
                "me/messages/" +
                  encodeURIComponent(message.providerId) +
                  "/attachments?$select=id,name,contentType,size,isInline",
              )
            ).json()) as {
              value?: {
                id: string;
                name: string;
                contentType: string;
                size: number;
                "@odata.type"?: string;
              }[];
            };
            message.files = (files.value || [])
              .filter(
                (f) => f["@odata.type"] === "#microsoft.graph.fileAttachment",
              )
              .slice(0, 50)
              .map((f) => ({
                id: f.id,
                name: f.name,
                mime: f.contentType,
                size: f.size,
              }));
          }
        }
        return { messages, next: d["@odata.nextLink"] || null };
      }
      if (cursor) {
        let state: State;
        try {
          state = JSON.parse(cursor);
        } catch {
          throw new MailError(false, "Invalid mailbox continuation.");
        }
        const page = await folderPage(state);
        return {
          messages: page.messages,
          cursor: page.next
            ? JSON.stringify({ ...state, next: page.next })
            : state.folder === "inbox"
              ? JSON.stringify({ folder: "sentitems", next: null })
              : null,
        };
      }
      const inbox = await folderPage({ folder: "inbox", next: null }),
        sent = await folderPage({ folder: "sentitems", next: null });
      return {
        messages: [...inbox.messages, ...sent.messages],
        cursor: inbox.next
          ? JSON.stringify({ folder: "inbox", next: inbox.next })
          : sent.next
            ? JSON.stringify({ folder: "sentitems", next: sent.next })
            : null,
      };
    },
  };
}
type GmailPart = {
  partId?: string;
  filename?: string;
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
};
function plainPart(part: GmailPart | undefined, depth = 0): string {
  if (!part || part.filename || depth > 12) return "";
  if (part.mimeType === "text/plain" && part.body?.data)
    return Buffer.from(part.body.data, "base64url")
      .toString("utf8")
      .slice(0, 100000);
  return (part.parts || [])
    .map((p) => plainPart(p, depth + 1))
    .filter(Boolean)
    .join("\n")
    .slice(0, 100000);
}
function address(value: string) {
  return value.match(/<([^<>]+)>/)?.[1] || value.trim();
}
function addresses(value: string) {
  return value
    ? value
        .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
        .map(address)
        .filter(Boolean)
    : [];
}
type GraphMail = {
  hasAttachments?: boolean;
  ccRecipients?: { emailAddress: { address: string } }[];
  id: string;
  conversationId: string;
  from?: { emailAddress: { address: string } };
  toRecipients?: { emailAddress: { address: string } }[];
  replyTo?: { emailAddress: { address: string } }[];
  subject?: string;
  body?: { contentType: string; content: string };
  receivedDateTime: string;
  internetMessageId?: string;
  isDraft?: boolean;
};

function decodeHeader(value: string) {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(
      /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
      (full, charset: string, kind: string, content: string) => {
        try {
          const bytes =
            kind.toLowerCase() === "b"
              ? Buffer.from(content, "base64")
              : Buffer.from(
                  content
                    .replaceAll("_", " ")
                    .replace(/=([0-9a-f]{2})/gi, (_: string, hex: string) =>
                      String.fromCharCode(parseInt(hex, 16)),
                    ),
                  "binary",
                );
          return new TextDecoder(charset).decode(bytes);
        } catch {
          return full;
        }
      },
    );
}

function htmlPart(part: GmailPart | undefined, depth = 0): string {
  if (!part || part.filename || depth > 12) return "";
  if (part.mimeType === "text/html" && part.body?.data)
    return Buffer.from(part.body.data, "base64url")
      .toString("utf8")
      .slice(0, 500000);
  return (part.parts || [])
    .map((p) => htmlPart(p, depth + 1))
    .filter(Boolean)
    .join("\n")
    .slice(0, 500000);
}
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(?:p|div|br|li|tr|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
      (_, entity: string) => {
        const known: Record<string, string> = {
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
          nbsp: " ",
        };
        if (known[entity.toLowerCase()]) return known[entity.toLowerCase()];
        const n = entity.toLowerCase().startsWith("#x")
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
        return Number.isInteger(n) && n > 0 && n <= 0x10ffff
          ? String.fromCodePoint(n)
          : "";
      },
    )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 100000);
}

function providerTime(value: number) {
  if (!Number.isFinite(value) || value < 0)
    throw new MailError(
      false,
      "Provider returned an invalid message timestamp.",
    );
  return value;
}
function gmailFiles(part: GmailPart | undefined, depth = 0): IncomingFile[] {
  if (!part || depth > 12) return [];
  if (part.filename && (part.body?.attachmentId || part.body?.data))
    return [
      {
        id: part.body.attachmentId
          ? "a:" + part.body.attachmentId
          : "p:" + part.partId,
        name: part.filename,
        mime: part.mimeType || "application/octet-stream",
        size: part.body.size || 0,
      },
    ];
  return (part.parts || [])
    .flatMap((p) => gmailFiles(p, depth + 1))
    .slice(0, 50);
}

export type MailAttachment = {
  name: string;
  mime: string;
  size: number;
  read: (offset: number, length: number) => Promise<Uint8Array>;
};
export type OutgoingMail = {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  messageId: string;
  createdAt: number;
  replyMessageId?: string;
  threadId?: string;
  attachments: MailAttachment[];
};
const encode = (s: string) => new TextEncoder().encode(s);
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
function header(value: string) {
  if (/[\r\n\x00]/.test(value)) throw new Error("Invalid email header");
  return value;
}
function encodedSubject(subject: string) {
  let part = "";
  const words: string[] = [];
  for (const c of subject) {
    if (encode(part + c).length > 42) {
      words.push("=?UTF-8?B?" + b64(encode(part)) + "?=");
      part = "";
    }
    part += c;
  }
  if (part) words.push("=?UTF-8?B?" + b64(encode(part)) + "?=");
  return words.join("\r\n ");
}
const wrapped = (bytes: Uint8Array) => b64(bytes).replace(/.{1,76}/g, "$&\r\n");
export function mimeMessage(mail: OutgoingMail) {
  const boundary = "hub_" + crypto.randomUUID().replaceAll("-", "");
  const first = encode(
    [
      "From: " + header(mail.from),
      "To: " + mail.to.map(header).join(",\r\n "),
      ...(mail.cc.length ? ["Cc: " + mail.cc.map(header).join(",\r\n ")] : []),
      ...(mail.bcc.length
        ? ["Bcc: " + mail.bcc.map(header).join(",\r\n ")]
        : []),
      "Subject: " + encodedSubject(header(mail.subject)),
      "Date: " + new Date(mail.createdAt).toUTCString(),
      "Message-ID: " + header(mail.messageId),
      ...(mail.replyMessageId
        ? [
            "In-Reply-To: " + header(mail.replyMessageId),
            "References: " + header(mail.replyMessageId),
          ]
        : []),
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="' + boundary + '"',
      "",
      "--" + boundary,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      "",
    ].join("\r\n"),
  );
  const body = encode(wrapped(encode(mail.body))),
    end = encode("\r\n--" + boundary + "--\r\n");
  const heads = mail.attachments.map((a) => {
    const filename = encodeURIComponent(a.name).match(/.{1,60}/g) || [
      "attachment",
    ];
    return encode(
      "\r\n--" +
        boundary +
        "\r\nContent-Type: " +
        header(a.mime) +
        "\r\nContent-Disposition: attachment;\r\n " +
        filename
          .map(
            (p, i) => "filename*" + i + "*=" + (i === 0 ? "UTF-8''" : "") + p,
          )
          .join(";\r\n ") +
        "\r\nContent-Transfer-Encoding: base64\r\n\r\n",
    );
  });
  const length =
    first.length +
    body.length +
    end.length +
    mail.attachments.reduce((n, a, i) => {
      const chars = 4 * Math.ceil(a.size / 3);
      return n + heads[i].length + chars + 2 * Math.ceil(chars / 76);
    }, 0);
  async function* chunks() {
    yield first;
    yield body;
    for (let i = 0; i < mail.attachments.length; i++) {
      const a = mail.attachments[i];
      yield heads[i];
      for (let offset = 0; offset < a.size; offset += 57 * 1024) {
        const size = Math.min(57 * 1024, a.size - offset),
          bytes = await a.read(offset, size);
        if (bytes.length !== size) throw new Error("Attachment length changed");
        yield encode(wrapped(bytes));
      }
    }
    yield end;
  }
  return { length, chunks };
}
export async function* base64Chunks(source: AsyncIterable<Uint8Array>) {
  let carry = new Uint8Array(0);
  for await (const chunk of source) {
    const bytes = new Uint8Array(carry.length + chunk.length);
    bytes.set(carry);
    bytes.set(chunk, carry.length);
    const end = bytes.length - (bytes.length % 3);
    if (end) yield encode(b64(bytes.subarray(0, end)));
    carry = bytes.slice(end);
  }
  if (carry.length) yield encode(b64(carry));
}
export function streamChunks(
  source: AsyncIterable<Uint8Array>,
  length: number,
) {
  const iterator = source[Symbol.asyncIterator]();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const value = await iterator.next();
        if (value.done) controller.close();
        else controller.enqueue(value.value);
      } catch (e) {
        controller.error(e);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
  if (typeof FixedLengthStream !== "undefined") {
    const fixed = new FixedLengthStream(length);
    stream.pipeTo(fixed.writable).catch(() => {});
    return fixed.readable;
  }
  return stream;
}

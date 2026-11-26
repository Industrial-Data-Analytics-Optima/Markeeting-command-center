import { mimeMessage, base64Chunks, streamChunks } from "./mime.ts";
import type { OutgoingMail } from "./mime.ts";
import { MailError } from "./providers.ts";
export type OutlookPreparation = {
  draftId?: string;
  files: Record<
    string,
    {
      offset: number;
      complete?: boolean;
      url?: string;
      expiresAt?: number;
    }
  >;
};
const chunkSize = 320 * 1024 * 10;
export function validOutlookUploadUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MailError(false, "Outlook returned an invalid upload location.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !["outlook.office.com", "outlook.office365.com"].includes(url.hostname)
  )
    throw new MailError(
      false,
      "Outlook returned an unsupported upload location.",
    );
  return value;
}
export async function prepareOutlook(
  mail: OutgoingMail,
  token: string,
  state: OutlookPreparation,
  checkpoint: (state: OutlookPreparation) => Promise<void>,
  replyId?: string,
  fetcher: typeof fetch = fetch,
) {
  const root = "https://graph.microsoft.com/v1.0/";
  async function graph(path: string, init: RequestInit = {}, sending = false) {
    let r: Response;
    try {
      r = await fetcher(root + path, {
        ...init,
        headers: {
          Authorization: "Bearer " + token,
          Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"',
          ...init.headers,
        },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new MailError(
        sending,
        sending
          ? "Outlook submission outcome is unknown. Check Sent before retrying."
          : "Outlook preparation was interrupted. The saved message can be retried.",
      );
    }
    if (!r.ok)
      throw new MailError(
        sending && (r.status >= 500 || r.status === 408),
        "Outlook request failed (" + r.status + ").",
      );
    return r;
  }
  if (!state.draftId) {
    const mime = mimeMessage({ ...mail, attachments: [] }),
      length = 4 * Math.ceil(mime.length / 3),
      r = await graph(
        replyId
          ? "me/messages/" + encodeURIComponent(replyId) + "/createReply"
          : "me/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "text/plain",
            "Content-Length": String(length),
          },
          body: streamChunks(base64Chunks(mime.chunks()), length),
        },
      ),
      created = (await r.json()) as {
        id?: string;
      };
    if (!created.id)
      throw new MailError(
        false,
        "Outlook did not return a draft identity. No message was submitted.",
      );
    state.draftId = created.id;
    await checkpoint(state);
  }
  type Draft = {
    id: string;
    isDraft: boolean;
    subject: string;
    body: {
      content: string;
    };
    toRecipients: {
      emailAddress: {
        address: string;
      };
    }[];
    ccRecipients: {
      emailAddress: {
        address: string;
      };
    }[];
    bccRecipients: {
      emailAddress: {
        address: string;
      };
    }[];
  };
  const path = "me/messages/" + encodeURIComponent(state.draftId),
    getDraft = async () => {
      try {
        return (await (
          await graph(
            path +
              "?$select=id,isDraft,subject,body,toRecipients,ccRecipients,bccRecipients",
          )
        ).json()) as Draft;
      } catch {
        throw new MailError(
          true,
          "The saved Outlook draft cannot be verified. Check Sent before retrying.",
        );
      }
    };
  const draft = await getDraft();
  if (draft.isDraft === false) return async () => ({ id: state.draftId! });
  if (draft.isDraft !== true)
    throw new MailError(
      true,
      "Outlook draft state is unknown. Check Sent first.",
    );
  const recipients = (items: string[]) =>
    items.map((address) => ({ emailAddress: { address } }));
  await graph(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: mail.subject,
      body: { contentType: "Text", content: mail.body },
      toRecipients: recipients(mail.to),
      ccRecipients: recipients(mail.cc),
      bccRecipients: recipients(mail.bcc),
    }),
  });
  type File = {
    id: string;
    name: string;
    size: number;
    contentId?: string;
  };
  const listFiles = async () => {
    const result = (await (
      await graph(
        path +
          "/attachments?$select=id,name,size,microsoft.graph.fileAttachment/contentId",
      )
    ).json()) as {
      value: File[];
      "@odata.nextLink"?: string;
    };
    if (!Array.isArray(result.value) || result["@odata.nextLink"])
      throw new MailError(
        false,
        "The saved Outlook attachments cannot be fully verified.",
      );
    return result.value;
  };
  const list = { value: await listFiles() };
  const contentId = (i: number) =>
      mail.messageId.replace(/[<>]/g, "") + ".file" + i,
    expected = new Set(mail.attachments.map((_, i) => contentId(i)));
  if (
    (list.value || []).some((a) => !a.contentId || !expected.has(a.contentId))
  )
    throw new MailError(
      false,
      "The Outlook draft contains an attachment outside this saved message. Review the provider draft before retrying.",
    );
  for (let i = 0; i < mail.attachments.length; i++) {
    const file = mail.attachments[i],
      key = String(i),
      cid = contentId(i),
      existing = list.value?.find(
        (a) =>
          a.contentId === cid && a.size === file.size && a.name === file.name,
      );
    let part = state.files[key] || { offset: 0 };
    state.files[key] = part;
    if (existing) {
      state.files[key] = { offset: file.size, complete: true };
      await checkpoint(state);
      continue;
    }
    if (part.complete) {
      part = { offset: 0 };
      state.files[key] = part;
    }
    if (file.size < 3000000) {
      const bytes = await file.read(0, file.size);
      if (bytes.length !== file.size)
        throw new MailError(false, "Attachment size changed.");
      await graph(path + "/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: file.name,
          contentType: file.mime,
          contentId: cid,
          isInline: false,
          contentBytes: Buffer.from(bytes).toString("base64"),
        }),
      });
      state.files[key] = { offset: file.size, complete: true };
      await checkpoint(state);
      continue;
    }
    async function uploadRequest(method: string, bytes?: Uint8Array) {
      const url = validOutlookUploadUrl(part.url!);
      let response: Response;
      try {
        response = await fetcher(url, {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(30000),
          ...(bytes
            ? {
                headers: {
                  "Content-Type": "application/octet-stream",
                  "Content-Length": String(bytes.length),
                  "Content-Range":
                    "bytes " +
                    part.offset +
                    "-" +
                    (part.offset + bytes.length - 1) +
                    "/" +
                    file.size,
                },
                body: bytes as BodyInit,
              }
            : {}),
        });
      } catch {
        throw new MailError(
          false,
          "An Outlook attachment upload was interrupted. Retry the saved message to resume.",
        );
      }
      return response;
    }
    if (part.url && part.expiresAt && part.expiresAt > Date.now()) {
      const response = await uploadRequest("GET");
      if (response.ok) {
        const status = (await response.json()) as {
          nextExpectedRanges?: string[];
        };
        part.offset = nextOffset(status.nextExpectedRanges, file.size);
      } else if (response.status === 404 || response.status === 410) {
        part = { offset: 0 };
        state.files[key] = part;
      } else
        throw new MailError(
          false,
          "Outlook upload progress could not be checked. Retry later.",
        );
    } else if (part.url) {
      part = { offset: 0 };
      state.files[key] = part;
    }
    if (!part.url) {
      const session = (await (
        await graph(path + "/attachments/createUploadSession", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            AttachmentItem: {
              attachmentType: "file",
              name: file.name,
              contentType: file.mime,
              size: file.size,
              contentId: cid,
              isInline: false,
            },
          }),
        })
      ).json()) as {
        uploadUrl: string;
        expirationDateTime: string;
        nextExpectedRanges?: string[];
      };
      part.url = validOutlookUploadUrl(session.uploadUrl);
      part.expiresAt = Date.parse(session.expirationDateTime);
      if (!Number.isFinite(part.expiresAt) || part.expiresAt <= Date.now())
        throw new MailError(
          false,
          "Outlook returned an expired upload session.",
        );
      part.offset = nextOffset(session.nextExpectedRanges, file.size);
      await checkpoint(state);
    }
    while (part.offset < file.size) {
      const bytes = await file.read(
        part.offset,
        Math.min(chunkSize, file.size - part.offset),
      );
      if (
        !bytes.length ||
        bytes.length !== Math.min(chunkSize, file.size - part.offset)
      )
        throw new MailError(false, "Attachment size changed.");
      const response = await uploadRequest("PUT", bytes);
      if (!response.ok)
        throw new MailError(
          false,
          "Outlook attachment upload failed (" +
            response.status +
            "). Retry the saved message.",
        );
      if (response.status === 201) {
        part = { offset: file.size, complete: true };
        state.files[key] = part;
      } else {
        const progress = (await response.json()) as {
          nextExpectedRanges?: string[];
        };
        const offset = nextOffset(progress.nextExpectedRanges, file.size);
        if (offset !== part.offset + bytes.length)
          throw new MailError(
            false,
            "Outlook returned unexpected upload progress. Retry to verify it.",
          );
        part.offset = offset;
        if (offset === file.size)
          throw new MailError(
            false,
            "Outlook has not confirmed the completed attachment.",
          );
      }
      await checkpoint(state);
    }
  }
  async function verifyFiles() {
    const actual = await listFiles();
    if (
      actual.length !== mail.attachments.length ||
      mail.attachments.some(
        (f, i) =>
          actual.filter(
            (a) =>
              a.contentId === contentId(i) &&
              a.name === f.name &&
              a.size === f.size,
          ).length !== 1,
      )
    )
      throw new MailError(
        false,
        "Outlook attachments do not match the saved message. Retry to verify the upload before sending.",
      );
  }
  await verifyFiles();
  return async () => {
    const current = await getDraft();
    if (current.isDraft === false) return { id: state.draftId! };
    if (current.isDraft !== true)
      throw new MailError(true, "Outlook draft state cannot be confirmed.");
    const addresses = (
        items: {
          emailAddress: {
            address: string;
          };
        }[],
      ) =>
        items
          .map((i) => i.emailAddress.address.toLowerCase())
          .sort()
          .join(","),
      wanted = (items: string[]) =>
        items
          .map((s) => s.toLowerCase())
          .sort()
          .join(","),
      text = (s: string) => s.replace(/\r\n/g, "\n").trim();
    if (
      current.subject !== mail.subject ||
      text(current.body?.content || "") !== text(mail.body) ||
      addresses(current.toRecipients || []) !== wanted(mail.to) ||
      addresses(current.ccRecipients || []) !== wanted(mail.cc) ||
      addresses(current.bccRecipients || []) !== wanted(mail.bcc)
    )
      throw new MailError(
        false,
        "The Outlook draft was changed outside the hub. Retry to restore the reviewed message before sending.",
      );
    await verifyFiles();
    await graph(path + "/send", { method: "POST" }, true);
    return { id: state.draftId! };
  };
}
function nextOffset(ranges: string[] | undefined, size: number) {
  if (!ranges || ranges.length !== 1 || !/^\d+-?$/.test(ranges[0]))
    throw new MailError(false, "Outlook returned invalid upload progress.");
  const offset = Number(ranges[0].replace(/-$/, ""));
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > size)
    throw new MailError(false, "Outlook returned invalid upload progress.");
  return offset;
}

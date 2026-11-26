import { createTokenVault } from "../connections/vault.ts";
import { MailError } from "./providers.ts";
import { prepareOutlook } from "./outlook-uploads.ts";
import type { OutlookPreparation } from "./outlook-uploads.ts";
import type { Delivery } from "./delivery.ts";
import type { OutgoingMail } from "./mime.ts";
export function outlookWritable(scopes: string) {
  try {
    return (JSON.parse(scopes) as string[]).some(
      (s) =>
        s === "Mail.ReadWrite" ||
        s === "https://graph.microsoft.com/Mail.ReadWrite",
    );
  } catch {
    return false;
  }
}
export async function prepareStoredOutlook(
  db: D1Database,
  key: string,
  job: Delivery,
  mail: OutgoingMail,
  token: string,
  replyId?: string,
  fetcher: typeof fetch = fetch,
) {
  const vault = await createTokenVault(key),
    context = "email-upload:" + job.id;
  const row = await db
    .prepare(
      "SELECT sealed_preparation FROM hub_email_delivery WHERE id=? AND workspace_id=? AND lease_id=? AND status='preparing'",
    )
    .bind(job.id, job.workspace_id, job.lease_id)
    .first<{
      sealed_preparation: string | null;
    }>();
  if (!row)
    throw new MailError(
      false,
      "Email preparation was cancelled or its lease expired.",
    );
  const state: OutlookPreparation = row.sealed_preparation
    ? JSON.parse(
        (await vault.open(row.sealed_preparation, job.workspace_id, context))
          .accessToken,
      )
    : { files: {} };
  return prepareOutlook(
    mail,
    token,
    state,
    async (current) => {
      const sealed = await vault.seal(
          { accessToken: JSON.stringify(current), accessExpiresAt: null },
          job.workspace_id,
          context,
        ),
        now = Date.now();
      const r = await db
        .prepare(
          "UPDATE hub_email_delivery SET sealed_preparation=?,provider_id=?,lease_until=?,updated_at=? WHERE id=? AND workspace_id=? AND lease_id=? AND status='preparing' AND lease_until>?",
        )
        .bind(
          sealed,
          current.draftId || null,
          now + 120000,
          now,
          job.id,
          job.workspace_id,
          job.lease_id,
          now,
        )
        .run();
      if (!r.meta.changes)
        throw new MailError(
          false,
          "Email preparation was cancelled or its lease expired.",
        );
    },
    replyId,
    fetcher,
  );
}

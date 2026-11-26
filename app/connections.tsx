import { useState } from "react";
import { Modal } from "./ui";
export const connectionProviders = [
  {
    id: "linkedin",
    name: "LinkedIn",
    description: "Company pages, organic publishing and post performance.",
    detail: "Choose the company pages you manage.",
  },
  {
    id: "meta",
    name: "Facebook & Instagram",
    description: "Facebook Pages and linked Instagram professional accounts.",
    detail: "Choose your business, pages and Instagram accounts.",
  },
  {
    id: "google",
    name: "Gmail",
    description: "Read, reply and send from your connected mailboxes.",
    detail: "Choose the Google account you want to use.",
  },
  {
    id: "microsoft",
    name: "Outlook",
    description: "Outlook and Microsoft 365 email in one place.",
    detail: "Choose your Microsoft account or work mailbox.",
  },
];
export type ProviderSetupState = {
  id: string;
  ready: boolean;
  reason: string;
  missing: string[];
  redirectUri: string | null;
};

export function ProviderSetup({
  state,
  close,
  refresh,
  connect,
}: {
  state: ProviderSetupState;
  close: () => void;
  refresh: () => Promise<void>;
  connect: () => void;
}) {
  const provider = connectionProviders.find((p) => p.id === state.id)!;
  const portals: Record<string, string> = {
    linkedin: "https://www.linkedin.com/developers/apps",
    meta: "https://developers.facebook.com/apps/",
    google: "https://console.cloud.google.com/apis/credentials",
    microsoft: "https://entra.microsoft.com/",
  };
  const [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState(false),
    [checking, setChecking] = useState(false),
    [checkError, setCheckError] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(state.redirectUri!);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <Modal title={provider.name + " · one-time app setup"} close={close}>
      <div className="provider-setup">
        <p>
          This setup is done once for the hub. Your admins won’t need developer
          accounts or API credentials.
        </p>
        <div className="provider-connect-status" role="status">
          <b>
            {state.ready
              ? "Setup detected · Connect is ready"
              : "Connect is already built"}
          </b>
          <p>
            {state.ready
              ? "Authorize your account using the Connect button below."
              : "Complete these steps and redeploy. The existing Connect button will activate automatically; no additional feature build is needed."}
          </p>
        </div>
        <ol>
          <li>
            <a href={portals[state.id]} target="_blank" rel="noreferrer">
              Open {provider.name}’s developer portal
            </a>{" "}
            and create a company-owned app.
            {state.id === "linkedin" &&
              " Associate it with your company’s LinkedIn Page and complete the requested app verification."}
          </li>
          {state.id === "linkedin" && (
            <li>
              Request <b>Community Management API</b> access for company-page
              publishing, page discovery and reporting. LinkedIn must approve
              the required permissions.{" "}
              <a
                href="https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review"
                target="_blank"
                rel="noreferrer"
              >
                Official access requirements
              </a>
            </li>
          )}
          {state.id === "meta" && (
            <li>
              Add <b>Facebook Login for Business</b>. Create a configuration
              using <b>User access tokens</b> and select Facebook Pages with{" "}
              <code>pages_show_list</code>, <code>pages_read_engagement</code>{" "}
              and <code>instagram_basic</code>. Copy its configuration ID into{" "}
              <code>META_LOGIN_CONFIG_ID</code>. Instagram must be a Business or
              Creator account linked to a Facebook Page. Register the
              deauthorization callback at{" "}
              <code>
                {state.redirectUri?.replace(
                  "/connections/meta/callback",
                  "/meta/deauthorize",
                )}
              </code>{" "}
              and the data-deletion callback at{" "}
              <code>
                {state.redirectUri?.replace(
                  "/connections/meta/callback",
                  "/meta/deletion",
                )}
              </code>
              . Complete Meta’s app review and business verification
              requirements for your intended use.
            </li>
          )}
          <li>
            Register this exact OAuth redirect URL in the developer app:
            <div className="provider-callback">
              <input
                aria-label="OAuth redirect URL"
                readOnly
                value={
                  state.redirectUri ||
                  "Set a valid APP_ORIGIN on the server first."
                }
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                disabled={!state.redirectUri}
                onClick={copy}
              >
                {copied ? "Copied" : "Copy URL"}
              </button>
            </div>
            {copyError && (
              <small role="status">Select the URL and copy it manually.</small>
            )}
          </li>
          <li>
            Add{" "}
            {state.id === "meta"
              ? "the app ID, app secret and login configuration ID"
              : "the app’s client ID and client secret"}{" "}
            to{" "}
            <b>
              Vercel → this project → Settings → Environment Variables →
              Production
            </b>
            . Keep secrets there; don’t paste them into chat or the hub.
            {state.missing.length > 0 && (
              <div className="provider-missing">
                <span>Missing server settings</span>
                {state.missing.map((key) => (
                  <code key={key}>{key}</code>
                ))}
              </div>
            )}
          </li>
          <li>
            Redeploy the Vercel project, then use <b>Check setup</b> below. The{" "}
            <b>Connect</b> button already exists and activates when the settings
            are detected.
          </li>
        </ol>
        {state.id === "linkedin" && (
          <p className="provider-setup-note">
            Once connected, choose only the pages you want to make available and
            assign them to brands. Unselected pages stay private. Advertising
            and Lead Sync require separate approvals and integrations.
          </p>
        )}
        {state.id === "meta" && (
          <p className="provider-setup-note">
            After authorization, choose which Facebook Pages and linked
            Instagram accounts to share with each brand. Unselected accounts
            remain private. Connection setup does not launch ads or publish
            content.
          </p>
        )}
        {checkError && (
          <p className="access-error" role="alert">
            {checkError}
          </p>
        )}
        <footer className="provider-setup-actions">
          <button
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              setCheckError("");
              try {
                await refresh();
              } catch (e) {
                setCheckError((e as Error).message);
              } finally {
                setChecking(false);
              }
            }}
          >
            {checking ? "Checking…" : "Check setup"}
          </button>
          <button
            className="primary"
            disabled={!state.ready || checking}
            onClick={connect}
          >
            Connect {provider.name}
          </button>
        </footer>
      </div>
    </Modal>
  );
}

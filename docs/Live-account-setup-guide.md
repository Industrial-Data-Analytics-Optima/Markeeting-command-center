# Marketing hub: live-account setup guide

Prepared 18 November 2026. This is a one-time owner/developer setup guide, not a screen that your admins will have to work through.

## The experience we are building

Super admin selects **Connect account → provider sign-in → choose pages/mailbox → assign brand → finish**. Admins receive access inside the hub. They do not need developer-console access, API keys, or shared passwords. Workspace logout is separate from revoking a brand connection.

## 1. Production host and callbacks

The app is deployed at https://marketing-command-center-ivory.vercel.app with Turso storage and private Blob storage. Team authentication and the LinkedIn, Google and Microsoft OAuth callback handlers are implemented. Provider developer apps must still be configured and approved for the intended access. Meta authorization and private Facebook/Instagram account selection are implemented; live provider acceptance still needs the app credentials and approval.

Register exact redirect URLs, without wildcards:

| Provider  | Production redirect URI                                                                | Handler     |
| --------- | -------------------------------------------------------------------------------------- | ----------- |
| LinkedIn  | `https://marketing-command-center-ivory.vercel.app/api/connections/linkedin/callback`  | Implemented |
| Google    | `https://marketing-command-center-ivory.vercel.app/api/connections/google/callback`    | Implemented |
| Microsoft | `https://marketing-command-center-ivory.vercel.app/api/connections/microsoft/callback` | Implemented |
| Meta      | `https://marketing-command-center-ivory.vercel.app/api/connections/meta/callback`      | Implemented |

In Vercel production environment variables, set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` from the company-owned developer app, then redeploy. The hub already has its token-vault key and resolves its production origin. Explicit `APP_ORIGIN`, if set, must match the production host above. Do not put client secrets in GitHub, chat, or browser-side fields.

Connections now displays **Setup required → View setup**, including the exact missing variable names and a copyable callback URL. Once configured it offers **Connect**; this is credential readiness, not proof of LinkedIn approval. The approved OAuth flow then discovers pages privately, and the super admin explicitly assigns selected pages to brands. Unselected pages are not exposed to admins.

## 2. LinkedIn — start this application early

Create an app in the [LinkedIn developer portal](https://www.linkedin.com/developers/apps), associate it with the appropriate company page, and complete the requested ownership verification. Add the finalized redirect URI under the app's authentication settings.

Apply for the products the hub needs:

- **Community Management:** company-page publishing, engagement and page reporting.
- **Advertising:** ad-account discovery, campaign management and paid reporting.
- **Lead Sync:** lead-form response retrieval. This is separate from Advertising access.

Request permissions for implemented features only; reporting uses `r_ads_reporting`, campaign management uses `rw_ads`, and lead retrieval uses `r_marketing_leadgen_automation`. Page/content permissions depend on the approved Community Management capabilities. Prepare a screen recording showing those actual workflows. [Official access and permission guidance](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-03).

Approved Marketing Developer Platform partners can receive programmatic refresh tokens. LinkedIn documents default 60-day access tokens and a fixed one-year refresh-token lifetime; renewal does not restart that year. Schedule owner reminders before reauthorization becomes necessary. [LinkedIn token renewal](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens).

## 3. Meta — Facebook and linked Instagram connection

1. Create a company-owned business app in the [Meta developer portal](https://developers.facebook.com/apps/), add **Facebook Login for Business**, and configure the exact callback above.
2. Create a **User access token** login configuration. Select Facebook Pages and request `pages_show_list` and `pages_read_engagement`; include `instagram_basic` for linked professional Instagram discovery. The hub currently implements this user-token flow, not the business-integration system-user configuration.
3. Complete the business verification, app-review and access requirements shown for your intended use. Instagram must be a Business or Creator account linked to a Facebook Page for this flow. Personal Instagram accounts do not qualify. [Official Meta login guidance](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/) and [Instagram requirements](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started/).
4. In the app dashboard, register `https://marketing-command-center-ivory.vercel.app/api/meta/deauthorize` as the deauthorization callback and `https://marketing-command-center-ivory.vercel.app/api/meta/deletion` as the data-deletion callback. Signed requests are verified before stored Meta credentials/account data are removed. The deletion response includes a private confirmation code and a human-readable status page. Provide your company’s actual privacy policy and support information for review.
5. Set `META_APP_ID`, `META_APP_SECRET`, and the login configuration's `META_LOGIN_CONFIG_ID` in Vercel Production environment variables, then redeploy. `META_GRAPH_VERSION` defaults to `v27.0` and can be set to the app's supported Graph version.
6. In Connections, use **Check setup**, then the existing **Connect** button. The button is always visible and activates when server configuration is detected; no later UI build is needed.
7. Authorize on Meta. After returning to the hub, select each Facebook Page or Instagram account to share and choose its brand. New/unselected accounts remain private. Facebook and Instagram can be selected independently; sharing a Facebook Page does not silently share its linked Instagram account.
8. Test reauthorization, manual account refresh, removing Page access, denied permissions and brand isolation. Existing choices survive successful reconnects. Removed access is disabled. Temporary failures retain saved credentials and selections. Regular health/discovery checks use the existing background scheduler; minute scheduling is not enabled by default on the current Hobby deployment.

Credentials are encrypted and remain independent of workspace login/logout. User tokens are exchanged for long-lived tokens with provider-reported expiry; the app does not invent refresh tokens or promise permanent authorization. Page tokens derived from the long-lived user grant are stored separately and never returned to the browser. Meta can revoke access after security, permission or business changes. [Token lifetime guidance](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/).

Scope: this completes the **connection and account-selection layer**. Facebook/Instagram posting adapters, insights imports, ad-account discovery/launch, lead retrieval and provider webhooks are separate work and are not claimed as enabled by connecting accounts. Those features need their own implemented adapters and approved permissions.

## 4. Google — Gmail

Create a company-owned Google Cloud project, enable Gmail API and configure the OAuth branding, audience and data-access settings. Create an OAuth client of type **Web application** and add the exact callback URI.

For an email client that reads, edits drafts and sends, `gmail.modify` provides the relevant capabilities and is a restricted scope. External production use may require restricted-scope verification and, depending on data handling and applicable exceptions, a security assessment. Use the current review requirements for your intended deployment. [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

The backend must request offline access and preserve refresh tokens when refresh responses omit a replacement. [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

Do not leave a production Gmail integration in external **Testing** mode: refresh tokens for these permissions ordinarily expire after seven days. Production status removes that testing limitation but does not make tokens permanent; revocation, password/security events and account policies can still end access. [Google refresh-token expiration](https://developers.google.com/identity/protocols/oauth2/).

## 5. Microsoft — Outlook / Microsoft 365

In Microsoft Entra, create an app registration and configure a **Web** redirect URI, not a SPA redirect. Choose account support deliberately: one tenant for a single organization's mailboxes, or organizational plus personal Microsoft accounts if the hub needs both Microsoft 365 and Outlook.com. [App registration](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).

Use delegated Graph mail access for the connected mailbox: `Mail.ReadWrite` and `Mail.Send`, plus the identity/offline permissions required by the chosen authorization flow. Tenant policy may require administrator consent. [Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference).

Use server-side offline access, persist rotated refresh tokens, and monitor client-credential expiry too. Microsoft's refresh lifetimes and revocation rules vary by flow and policy; a Web flow avoids the SPA-specific 24-hour refresh lifetime. [Microsoft refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens).

## 6. Store configuration once, on the server

Never paste passwords or secrets into chat or into an admin-facing connection form. Enter them through the selected host's secret manager.

The connection-runtime factory now accepts `DB`, `TOKEN_VAULT_KEY`, and provider `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`, and `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` pairs. The vault key must be a securely generated 32-byte key encoded as base64, backed up securely. Meta configuration will be added with its provider-specific flow. None of these values has been created or installed by this build.

Apply the connection database migration, wire the runtime into authenticated server jobs, and install a recurring maintenance trigger. The maintenance function currently processes up to 25 due connections per invocation; cadence and capacity must be checked against the number of accounts. Alert records are durable, but an owner notification channel still needs wiring.

## 7. Verify before real operations

Use a test page and mailbox first. Verify account selection, brand restrictions, logout without disconnecting a page, token renewal, provider outages, owner reconnection and removal of a staff member. Confirm that a failed account cannot block unrelated accounts.

Reconnection must keep the existing connection identity, brand assignments and queued work. Restore drafts for review; do not blindly publish overdue content or replay an ad-spend operation. Confirm genuine provider delivery before reporting success.

## Current build boundary

Implemented: expanded sample analytics, the simpler connection UI, encrypted token vault, durable connection repository/migration, tested refresh adapters for Google/Microsoft/LinkedIn, retry/lease handling and a maintenance function.

Not activated: production hosting, shared-user login, OAuth authorization/callback/account selection, live metric ingestion, Meta-specific token lifecycle, scheduled maintenance and delivered notifications. The Connect button returns a plain-language unavailable message until these are ready; it never fakes a successful connection.

# Turso + Vercel deploy checklist

Windows PowerShell. Secrets stay in `.local/` (gitignored) or the Vercel dashboard. Never commit `.env.local`, `.local/production.env`, or `.local/turso.env`.

## 0. One-time tools

```powershell
cd "C:\Users\bhuju\Desktop\Marketing Command Center Source"
node -v   # 22.13 or newer
npx vercel login
```

Install Turso CLI (optional if you create the DB in the Turso dashboard):

```powershell
irm https://get.tur.so/install.ps1 | iex
```

Close the terminal, open a new one, then:

```powershell
turso auth login
turso auth token
```

## 1. Generate app secrets

```powershell
npm run secrets
```

This writes `.local/production.env` with `TOKEN_VAULT_KEY` and `CRON_SECRET` (`SCHEDULER_SECRET` matches cron). Keep that file.

## 2. Create the Turso database

**A. Script (if you have an API token):**

```powershell
$env:TURSO_API_TOKEN = "<paste turso auth token>"
npm run turso:provision
```

This writes `.local/turso.env` with `DATABASE_URL` and `TURSO_AUTH_TOKEN`.

**B. Dashboard:** Turso → Create database → name `marketing-command-center` → copy the **libSQL URL** and a **database token** (not the account API token) into `.local/turso.env`:

```
DATABASE_URL=libsql://marketing-command-center-<org>.turso.io
TURSO_AUTH_TOKEN=
```

Schema migrations run on first API request. You do not apply SQL by hand.

## 3. Create Vercel Blob

1. [vercel.com](https://vercel.com) → the project (create it in step 4 if it does not exist yet).
2. Storage → Blob → Create.
3. Copy the **Read/Write** token into `.local/production.env` as `BLOB_READ_WRITE_TOKEN`.

Production video acceptance is outstanding: the current adapter still needs persistent multipart state and bounded reads/assembly, and uploads must avoid Function payload limits. Do not enable large hosted video uploads until those changes and hosted tests are complete.

## 4. Create the Vercel project

From the repo root, after `npx vercel login`:

```powershell
npx vercel link
npx vercel env add DATABASE_URL production
npx vercel env add TURSO_AUTH_TOKEN production
npx vercel env add BLOB_READ_WRITE_TOKEN production
npx vercel env add TOKEN_VAULT_KEY production
npx vercel env add CRON_SECRET production
npx vercel env add SCHEDULER_SECRET production
```

Paste values from `.local/turso.env` and `.local/production.env`. Repeat the same keys for **Preview** if you want staging.

After the first deploy you will know the URL. Then:

```powershell
npx vercel env add APP_ORIGIN production
```

Value: `https://<project>.vercel.app` or your custom domain. No trailing slash.

Leave OAuth client IDs empty until you are ready to connect live accounts. Set:

```
EMAIL_DELIVERY_ENABLED=false
EMAIL_SYNC_ENABLED=false
LINKEDIN_API_VERSION=202609
```

Do **not** add `NEXT_PUBLIC_` versions of any secret.

## 5. Deploy

```powershell
npx vercel --prod
```

Or connect the GitHub repo `ndlovunhlanhlaluju-prog/Marketing-Command-Center-Source` in the Vercel dashboard (Import → this repo → Framework Preset Next.js → Root `.`).

The default `vercel.json` does not enable cron. Minute cron requires a suitable paid plan: copy the `crons` entry from `vercel.pro.example.json` when ready and set matching `CRON_SECRET` / `SCHEDULER_SECRET`. Do not substitute daily cron for reliable post scheduling: publishing needs a recent heartbeat.

## 6. Smoke-check the host

```
https://<project>.vercel.app/api/health
```

Expect `{ "ok": true, "host": "vercel" }`.

Open the site. You should see Sign in, not a 500.

## 7. First super admin

Point `APP_ORIGIN` at the live URL in the environment you bootstrap, then:

```powershell
$env:DATABASE_URL = "<from .local/turso.env>"
$env:TURSO_AUTH_TOKEN = "<from .local/turso.env>"
$env:APP_ORIGIN = "https://<project>.vercel.app"
npm run owner:invite
```

Open `.local/owner-setup.url` in the browser, set name + password (12+ characters). The link works once, for 24 hours, and only while the workspace has no members.

Local file DB instead of Turso:

```powershell
$env:DATABASE_URL = "file:.data/hub.db"
$env:APP_ORIGIN = "http://localhost:3000"
npm run owner:invite
npm run dev
```

## 8. OAuth (when you turn connections on)

Register these exact redirect URIs on each provider, using `APP_ORIGIN`:

| Provider  | Redirect URI                                                       |
| --------- | ------------------------------------------------------------------ |
| LinkedIn  | `https://<host>/api/connections/linkedin/callback`                 |
| Google    | `https://<host>/api/connections/google/callback`                   |
| Microsoft | `https://<host>/api/connections/microsoft/callback` (Web, not SPA) |

Add the client id/secret pairs in Vercel, redeploy, then Connect on the Connections screen. For Meta, configure META_APP_ID, META_APP_SECRET and META_LOGIN_CONFIG_ID for a Facebook Login for Business User-token configuration. The callback is `/api/connections/meta/callback`. The connection flow and private page/account assignment are implemented; live Meta acceptance remains required.

## 9. Go-live gate

- [ ] `/api/health` returns ok
- [ ] Super admin can sign in and sign out
- [ ] Brands list shows IDAO / Optimaviz / Nestwise (or the names you created)
- [ ] Ctrl+K opens Jump to
- [ ] Connections shows “Setup required” until secrets exist, then “Connect account”
- [ ] Upload a JPEG in Media library
- [ ] Cron: Vercel → Logs after a minute, or `POST /api/internal/tick` with `Authorization: Bearer $CRON_SECRET`

## If something fails

| Symptom                       | Likely cause                                                 |
| ----------------------------- | ------------------------------------------------------------ |
| 503 storage is not configured | Missing `DATABASE_URL`                                       |
| Login 500 on first hit        | Turso token is an account token, not a database token        |
| Media upload 503              | Missing `BLOB_READ_WRITE_TOKEN`                              |
| Cron 401                      | `CRON_SECRET` / `SCHEDULER_SECRET` mismatch                  |
| OAuth bounce                  | `APP_ORIGIN` does not match the registered redirect URI      |
| Invite “expired”              | Workspace already has a member, or `APP_ORIGIN` host differs |

# Marketing Command Center — product review candidate

Start with [REVIEW-START-HERE.md](REVIEW-START-HERE.md). This is a sanitized, separately hardened review candidate based on source commit `abfe4730bd8954ecd5f3a7c4e5699b6867e74d58`. It has not replaced the deployed application.

## Local review

Use Node 22 (22.13+; validated with 22.23.5) and npm.

```sh
npm ci
```

Copy `.env.example` to `.env.local`. For an isolated local review, retain the file database and localhost origin, generate your own vault/scheduler secrets with `npm run secrets`, (saved in the ignored `.local/production.env`) and copy only the generated key/secret values into `.env.local`. Do not use production credentials or the production database. Then run:

```sh
npm run owner:invite
npm run dev
```

Open the one-time URL saved privately in `.local/owner-setup.url`. The initial owner invitation expires in 24 hours. Subsequent email-bound teammate invitations expire in 48 hours. No invitation emails are sent automatically.

## Reproducible checks

```sh
npm run check
npm run review:smoke
```

The check command runs formatting, ESLint, TypeScript, domain/security tests, the Next production build, and npm audit. ESLint retains React Compiler effect-loading/performance diagnostics as visible warnings, described in [the security review](SECURITY-REVIEW.md); warnings do not mean the application has received approval. The smoke command starts a local production server against a fresh temporary database, checks access control and headers, and deletes its isolated records. Run it after the build; it never connects to a remote database.

## Stack and source map

- Next.js App Router / React / TypeScript, with npm as the only package manager.
- `app/`: UI and authenticated route handlers.
- `server/auth/`, `server/security/`: identity, access checks, bounded request parsing and CSP.
- `server/connections/`: encrypted provider credentials, OAuth, lifecycle and readiness.
- `server/publishing/`, `server/email/`, `server/team/`: domain workflows.
- `server/platform/`: libSQL/Turso adapter and private storage adapter. Cloudflare interface types remain for adapter compatibility; no Cloudflare runtime/build is required.
- `db/migrations/`: all 22 ordered SQL migrations; these are authoritative. The unused prototype ORM schema was removed.
- `tests/`: regression tests. Prototype sample data is isolated in `tests/fixtures/`, never served by the app.

## Deployment and product acceptance

The intended host is Vercel with a separate remote Turso database and private Vercel Blob store. Configure secrets in the host, never in source. See [deployment instructions](docs/hosting-vercel.md), [.env.example](.env.example), [provider setup](docs/Live-account-setup-guide.md), [team workflows](docs/Team-collaboration.md), and [the launch checklist](LAUNCH-CHECKLIST.md).

Live provider authorization/acceptance, approved scopes, a verified scheduler, large uploads and other launch requirements remain explicit in the checklist. Meta connection/asset assignment does not imply Meta publishing, ads or reporting. Saved ad builds are preparation records, not live campaigns. Email sync/delivery remain off until tested and explicitly configured.

This folder deliberately contains no installed dependencies, build output, Git history, real credentials, local database, uploads or live workspace data. Run `npm ci` to install dependencies.

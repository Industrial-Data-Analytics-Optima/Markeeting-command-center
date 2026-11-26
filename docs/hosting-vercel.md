# Host on Vercel

Step-by-step PowerShell commands: [deploy-checklist.md](./deploy-checklist.md).

The hub now talks to a platform layer instead of Cloudflare bindings.

| Need        | Local                                              | Vercel                                                                     |
| ----------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| SQL         | `DATABASE_URL=file:.data/hub.db` (libSQL / SQLite) | Turso `libsql://…` + `TURSO_AUTH_TOKEN`                                    |
| Media       | `.data/media`                                      | `BLOB_READ_WRITE_TOKEN` (Vercel Blob)                                      |
| Secrets     | `.env.local`                                       | Project Environment Variables                                              |
| Minute jobs | optional                                           | Optional supported-plan cron → `GET /api/internal/tick` with `CRON_SECRET` |

## Deploy

1. Create a Turso database, apply nothing by hand — migrations run on first request.
2. Create a Vercel Blob store and copy the read/write token.
3. Generate `TOKEN_VAULT_KEY` (`openssl rand -base64 32`) and a `CRON_SECRET`.
4. Set production env vars in Production only. Give Preview a separate test database, Blob store, vault key, origin and provider apps; do not share production credentials. None of these use a `NEXT_PUBLIC_` prefix:

```
APP_ORIGIN=https://your-domain.vercel.app
DATABASE_URL=libsql://….turso.io
TURSO_AUTH_TOKEN=
BLOB_READ_WRITE_TOKEN=
TOKEN_VAULT_KEY=
CRON_SECRET=
SCHEDULER_SECRET=   # same value as CRON_SECRET is fine
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
```

5. Register OAuth redirect URIs as `https://your-domain.vercel.app/api/connections/{linkedin|meta|google|microsoft}/callback`.
6. The default `vercel.json` omits cron so an initial import does not require a paid scheduler. Use the `crons` entry in `vercel.pro.example.json` only on a plan supporting minute jobs. Set `SCHEDULER_SECRET` and `CRON_SECRET` to the same value. Without a minute scheduler, publishing stays paused.

`npm run build` is `next build`. This review candidate contains no alternate Cloudflare build.

Production media acceptance is still outstanding. See the root README for multipart and Function-size limitations before enabling large uploads.

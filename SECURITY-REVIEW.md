# Security review evidence — 22 November 2026

## Decision and scope

**Review candidate prepared; production approval remains pending.** This is a source review, regression/check run and isolated local HTTP smoke assessment. It is not an independent penetration test, a compliance certification, or a guarantee that no vulnerabilities exist. No live user workspace, provider credential, database or token is included. Changes here have not been deployed over the current site.

Base commit: `abfe4730bd8954ecd5f3a7c4e5699b6867e74d58`. Target runtime: Node 22; test/build evidence uses Node 22.23.5. The candidate uses Next 16.4.6, with an npm lockfile.

## Automated evidence

| Check                               | Result                                               | Evidence                                                      |
| ----------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| npm audit, complete dependency tree | 0 known vulnerabilities reported at preparation time | `review-evidence/dependency-audit.json`                       |
| Domain and security tests, Node 22  | 155 passed                                           | `review-evidence/tests-node22.log`                            |
| TypeScript                          | Passed                                               | `review-evidence/typecheck.log`                               |
| Next production build, Node 22      | Passed                                               | `review-evidence/build-node22.log`                            |
| ESLint                              | 0 errors; 32 warnings retained                       | `review-evidence/eslint.json`                                 |
| Formatting                          | Checked with Prettier                                | `review-evidence/format-check.log`                            |
| Local production HTTP smoke         | See recorded output; no real accounts/providers used | `review-evidence/http-smoke.log`                              |
| Source/archive hygiene              | See packaging scan and file manifest                 | `review-evidence/package-scan.json`, `SOURCE-MANIFEST.sha256` |
| Dependency inventory                | CycloneDX SBOM, including development dependencies   | `review-evidence/sbom.cdx.json`                               |

The initial post-pruning audit reported 17 dependency findings (including 1 critical and 9 high). Updating Next/associated tooling, refreshing compatible transitive patches, and overriding a pinned affected Zod 4 dependency reduced the final audit to zero. Audit findings change over time; rerun before approval. No forced downgrade of the Blob SDK was used.

## Controls reviewed and tested

- **Identity:** invitation-bound signup, salted PBKDF2-SHA256 password hashing (600,000 iterations), hashed session/invitation tokens, active membership checks, session expiry, password-change session revocation and last-owner continuity. Teammates do not receive platform passwords.
- **Authorization:** role/owner restrictions, workspace and brand checks, private report drafts, explicit page assignment and exclusion of unselected provider assets, and author/reviewer workflow restrictions. Server checks remain authoritative; UI hiding is not the access boundary.
- **CSRF and input:** same-origin checks on browser writes, JSON content requirements, streamed byte bounds independent of Content-Length, strict object-shaped JSON, route field validation and parameter-bound SQL. Binary upload paths enforce their own origin, media-type and size checks.
- **Credentials/OAuth:** AES-GCM credential vault with workspace/connection context, session-bound single-use OAuth states, PKCE for mailbox providers, pinned provider endpoints, redirect refusal/timeouts, safe app origins and signed Meta callbacks. Reauthorization and transient-failure cases have tests; live provider acceptance remains pending.
- **Browser:** HttpOnly/SameSite cookies (Secure on HTTPS), nonce CSP with no inline/eval script allowance in production, framing/object/base restrictions, no-store application responses, nosniff/referrer/permissions headers and HSTS on HTTPS. Inline styles remain allowed for existing component styling.
- **Storage:** brand-gated private media routes, image/video format checks, filename/type checks for email attachments, path traversal rejection in local storage and a 32 MiB full-read ceiling in the current Blob adapter. Vercel video/multipart writes fail closed until the adapter is replaced.
- **Operations:** bearer-protected scheduler with timing-safe comparison; no default credentials; secrets remain server-only; generic API logs omit exception bodies. OAuth/provider errors are reduced to user-safe messages.

## Remaining findings and launch requirements

1. **Independent assessment and browser acceptance are outstanding.** Computer-use/browser tools could not initialize. HTTP checks can prove nonce/header markup and API behavior, not full browser hydration, UX, responsive layout or accessibility.
2. **Frontend lint backlog remains visible.** React Compiler effect-state diagnostics were changed from errors to warnings with an explicit comment in ESLint configuration. The 32 warnings also include exhaustive dependencies, unused variables and unoptimized image diagnostics. They are not suppressed and should be reviewed; a successful lint exit is not a zero-warning claim.
3. **Privileged account safeguards need an explicit decision.** MFA/SSO and self-service password reset are not implemented. Define and test super-admin recovery and decide whether deployment is acceptable without MFA for a narrowly restricted pilot.
4. **Distributed abuse controls need hosting configuration.** Existing per-account login throttles are not a complete per-IP/WAF/distributed rate-limit system. Apply edge protections and load-test login, upload and expensive endpoints.
5. **Large files are not production accepted.** The old Blob adapter buffers complete objects and multipart state was in memory. The candidate blocks Vercel video/multipart uploads, bounds direct images to 4 MiB there, and refuses Blob full reads above 32 MiB. Implement durable direct uploads, bounded streaming/range reads, quotas/expiry cleanup and host-limit testing before enabling video. Larger email-file uploads also need a host-compatible design.
6. **Malware scanning, retention and recovery are operational work.** Format validation does not scan for malware. Approve the attachment policy/scanner, privacy and retention schedule, audit retention, tested backups/restores, vault-key custody/rotation, monitoring and incident response.
7. **Provider integrations remain gated by actual acceptance and scope.** App review, company verification, permissions, token revocation/reconnect and provider-specific actions must be validated with dedicated test accounts. Connection readiness only means server configuration exists. Meta publishing/insights/ads/lead sync and live advertising controls are not complete. Email sync/send flags remain off. Scheduled delivery requires a verified heartbeat.
8. **Automated migrations require staging acceptance.** All 22 migrations are retained unchanged and run through the transactional SQL adapter. Plan backup/restore and privileges; do not run this review against the production database.

See `LAUNCH-CHECKLIST.md` for sign-off owners and required evidence. Approval belongs to the reviewing team.

## References

- Next.js security advisories: https://github.com/vercel/next.js/security/advisories
- Next.js nonce CSP guidance: https://nextjs.org/docs/app/guides/content-security-policy
- Pinned Zod dependency advisory: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- The included npm audit JSON records the dependency result used for this candidate.

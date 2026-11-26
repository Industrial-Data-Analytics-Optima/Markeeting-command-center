# Launch approval checklist

No item is pre-approved by automated tests. The product/security/operations owners should record names and dates against the accepted release scope.

## Product

- [ ] Review desktop/mobile layouts, keyboard operation, dialogs, unsaved-change guards, accessibility and actual browser hydration under CSP. Browser automation could not run in the preparation environment.
- [ ] Confirm brand separation, roles, optional feedback versus held approval, rejection reasons and review activity.
- [ ] Confirm email-bound invitation acceptance, expiry, revocation, manual sending and administrator recovery procedure.
- [ ] Confirm discussion/report visibility, private drafts, shared history, monthly filters/exports and handover access.
- [ ] Sign off on the exact first-release scope. Meta publishing/insights, live ads/boosting/billing and provider lead sync are not implemented by account connections alone.

## Security

- [ ] Independently review access control, CSRF, OAuth state and scope handling, token encryption and sensitive logs. Run the included checks and an independent application security assessment.
- [ ] Decide the super-admin MFA/SSO requirement. Neither is implemented; define compensating controls for any limited pilot and an approved plan before a broader privileged rollout.
- [ ] Configure edge rate limits/WAF for login, invite acceptance and expensive/upload endpoints. Current application login throttling is per account, not a complete network/distributed-abuse defense.
- [ ] Approve file-type policy and malware scanning requirements for attachments/media. Antivirus scanning is not implemented.
- [ ] Approve privacy, retention/deletion, lead exports, mailbox access, audit retention and employee data handling. Meta deletion covers Meta credentials/associated connection data, not all workspace records.
- [ ] Review non-security lint warnings before release; do not mistake warning-level diagnostics for a clean frontend performance review.

## Integrations and operations

- [ ] Set production secrets in hosting only; use a separate test environment/database, scoped service tokens and a private Blob store.
- [ ] Validate all 22 migrations against a staging backup and test restore/rollback procedures. Migrations are applied by the SQL adapter and require database write/schema permissions.
- [ ] Establish vault-key custody/rotation, credential revocation, incident response, owner recovery and dependency maintenance. Changing the vault key without a re-encryption plan makes stored tokens unreadable.
- [ ] Complete app review/business verification and real-account acceptance for LinkedIn/Meta/Google/Microsoft, including reconnect, permission loss and unselected page privacy.
- [ ] Validate a real background scheduler and heartbeat before enabling scheduled delivery. Confirm host plan limits; default Vercel configuration has no minute cron.
- [ ] Keep email sync/delivery flags off until real test mailboxes pass send, reply, attachments, retries and uncertain-outcome checks. Provider submission is not proof of recipient delivery.
- [ ] Keep Vercel video/multipart uploads disabled until durable direct upload state, bounded range reads and realistic hosted-load acceptance are implemented. The review candidate enforces this gate. Larger email file uploads also require a host-compatible direct-upload design.
- [ ] Configure operational alerts, logs with retention/redaction, uptime, backups, spend limits and load testing.

## Recorded sign-off

Product owner / scope / date:

Security reviewer / accepted risks / date:

Operations owner / staging evidence / date:

Release reference / approval decision:

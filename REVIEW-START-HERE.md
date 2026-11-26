# Product team review

## What this handoff is

A source-only review candidate for Marketing Command Center. Review the application, security controls and limitations before approving a pilot or production release. This candidate is separate from the current deployment; its hardening changes are not live.

## Read in this order

1. `README.md` — setup, stack and checks.
2. `REVIEW-CHANGES.md` — cleanup/hardening performed for this handoff.
3. `SECURITY-REVIEW.md` — evidence, scope and residual risks.
4. `LAUNCH-CHECKLIST.md` — product/security/operations decisions still required.
5. `review-evidence/` — raw sanitized check output and dependency inventory.

The archive and folder contain the same source. `SOURCE-MANIFEST.sha256` records file hashes; it intentionally excludes itself. Checks are point-in-time evidence, not a penetration test, compliance certification or blanket production approval.

## Suggested acceptance path

Use an isolated database and test provider accounts. Review administrator/brand separation first, then publishing/reviews, team discussions/reports, invitation onboarding, media and email. Validate actual social-provider flows only after app/scopes approval. Explicitly decide which unfinished capabilities stay disabled for the first release. Capture sign-off in the launch checklist.

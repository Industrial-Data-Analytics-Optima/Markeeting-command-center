# Review-candidate changes

Base: `abfe4730bd8954ecd5f3a7c4e5699b6867e74d58` from the existing repository. Changes in this folder are local to the review candidate.

- Removed the public demo route and demo UI, dead ORM schema/tooling, Cloudflare runtime/build/scheduler configurations, unused prototype images, duplicate pnpm files and obsolete local smoke scripts. Removed the sample-workspace link from login.
- Kept required brand assets, font license, runtime source, migrations, domain tests and Vercel configuration. Moved prototype-only calculation/data fixtures out of `app/` into `tests/fixtures/`; kept regression coverage.
- Formatted TypeScript, TSX, JavaScript, JSON, CSS and Markdown consistently with Prettier. SQL migration contents remain unchanged.
- Updated Next.js and its ESLint configuration to 16.4.6. Refreshed transitive patches; pinned a Zod 4.6.6 override because a Vercel CLI-config transitive dependency pinned an affected Zod release. The override stays within Zod major version 4 and is documented for future removal when upstream updates.
- Added streamed UTF-8 byte limits and JSON-object validation, including requests with no Content-Length. Applied the same bounded reader to Meta signed callbacks. Added explicit field validation at route boundaries.
- Rejected unsafe OAuth app-origin schemes and embedded credentials. Added local storage-key traversal protection and a conservative Blob full-read ceiling.
- Added per-request nonce CSP via Next proxy and dynamic rendering, preserving secure headers and preventing shared caching of application/API responses. Styles retain unsafe-inline for the existing React style system; scripts do not.
- Sanitized generic API error logs to an error type rather than a potentially sensitive exception object.
- Blocked the non-durable serverless multipart/video upload path on Vercel; media UI reflects this restriction. Limited direct image uploads to 4 MiB on Vercel. Durable streaming/direct uploads remain unfinished.
- Fixed a misnamed ordinary callback that triggered hook rules, a render-time ref write, a render-time clock read, a const declaration and a Windows-only SQLite test cleanup race and local file-URL normalization. Existing effect-loading/exhaustive-dependency diagnostics remain disclosed lint warnings.
- Added security regression tests and an isolated local production HTTP smoke script. Included review/launch documentation and point-in-time check evidence.

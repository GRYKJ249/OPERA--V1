# Opera on Replit

## Run and verify
- Keep the imported Node.js/TypeScript structure; Node.js 24 runs the server TypeScript directly.
- Run workflow: `npm run dev`; the launcher starts Opera on port 5000 and Gitea internally on port 3001, proxied at `/gitea/`.
- Replit supplies `DATABASE_URL`; never put database credentials in source files.
- `npm run db:init` checks connectivity and reports schema counts.
- `npm run db:test` checks queries, authorization views, and rollback.
- `npm run build` compiles `src/` into `assets/js/`.
- `npm run gitea:init` creates the separate `gitea` schema in the existing development database; run it once before starting Gitea in a fresh database.

## Development database
- The imported development database was empty. The existing `database/schema.sql` was applied transactionally.
- `database/seed.sql` contains repeatable original roles, permissions, and settings, excluding placeholder contact information and accounts.
- The server does not create or migrate tables on startup. Apply schema changes deliberately to development; managed production schema changes go through Publish.
- No legacy account or content records were available in this import; do not invent owner accounts or import archived SQLite migrations as PostgreSQL.

## Services still requiring configuration
- Signup stores pending users and verification hashes in PostgreSQL. Email verification and password-reset delivery need `RESEND_API_KEY` and `MAIL_FROM`; do not bypass verification to compensate for missing email configuration.
- Google/GitHub login needs the corresponding OAuth credentials. These are separate from database connectivity.
- Public portfolio content remains the imported static website; its display is not yet driven by database content tables.

## Gitea integration
- Keep Opera's public schema and login flow unchanged. Gitea uses the same `DATABASE_URL` in its own PostgreSQL schema and authenticates browser requests through Opera's session-checked reverse proxy.
- Gitea's executable, config, and repository files live under the ignored `runtime/gitea/` directory. Git repository contents are filesystem data, not SQL rows; project filesystem data does not persist across published deployment versions.
- Gitea is pinned to the official Linux amd64 release and its downloaded checksum is verified before launch.
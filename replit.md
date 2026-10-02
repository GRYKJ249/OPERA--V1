# Opera on Replit

## Run and verify
- Keep the imported Node.js/TypeScript structure; Node.js 24 runs the server TypeScript directly.
- Run workflow: `npm run dev`, serving the website and same-origin authentication API on port 5000.
- Replit supplies `DATABASE_URL`; never put database credentials in source files.
- `npm run db:init` checks connectivity and reports schema counts.
- `npm run db:test` checks queries, authorization views, and rollback.
- `npm run build` compiles `src/` into `assets/js/`.

## Development database
- The imported development database was empty. The existing `database/schema.sql` was applied transactionally.
- `database/seed.sql` contains repeatable original roles, permissions, and settings, excluding placeholder contact information and accounts.
- The server does not create or migrate tables on startup. Apply schema changes deliberately to development; managed production schema changes go through Publish.
- No legacy account or content records were available in this import; do not invent owner accounts or import archived SQLite migrations as PostgreSQL.

## Services still requiring configuration
- Signup stores pending users and verification hashes in PostgreSQL. Email verification and password-reset delivery need `RESEND_API_KEY` and `MAIL_FROM`; do not bypass verification to compensate for missing email configuration.
- Google/GitHub login needs the corresponding OAuth credentials. These are separate from database connectivity.
- Public portfolio content remains the imported static website; its display is not yet driven by database content tables.
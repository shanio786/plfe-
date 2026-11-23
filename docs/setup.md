# Phase 1 setup and acceptance

## Application boundary

The portable application lives in `artifacts/plfe/`. Its top-level folders are
`app/`, `modules/core/`, `lib/`, `prisma/`, `components/` and `scripts/`.
The repository-root npm scripts delegate to this one Next.js 15 application.
It does not call the scaffold API server or use any platform authentication,
database client, storage SDK, or hosted runtime.

The complete source plan is `docs/PLAN.md`. The approved corrections and decisions
are recorded in `docs/phase1-decisions.md`; these override the original plan where
they differ.

## Prerequisites

- Linux, Node.js 22 LTS and npm.
- PostgreSQL **16**; UTF-8 database.
- Nginx and a domain with HTTPS. Secure cookies are intentionally never downgraded
  to insecure cookies. Plain HTTP is unsuitable for acceptance testing login.
- A dedicated uploads directory outside any public/static directory.

## Direct Node.js deployment

1. Clone the source into the company's server account.
2. Copy `.env.example` to `.env`, restrict it to the service account (`chmod 600
   .env`), and fill the deployment values. Do not put business settings here.
3. Create a database owned by a **migration role**. Create a separate login role
   `plfe_app` for the running app. Use a PostgreSQL password policy appropriate to
   the server; do not put passwords into command history.
4. Set `MIGRATION_DATABASE_URL` to the migration role's connection.
   Set `DATABASE_URL` to the limited runtime role's connection.
   Leave `PLFE_DATABASE_URL` unset. It is only an optional local-preview override.
5. Set `APP_URL` to the exact external HTTPS origin, e.g.
   `https://portal.example.com`. Set `UPLOAD_DIR` to an absolute directory owned by
   the app's OS user, with mode 0700.
6. Set `SEED_OWNER_EMAIL`, `SEED_OWNER_NAME`, and `SEED_OWNER_PASSWORD` yourself.
   The password must meet the configured policy. The seed never prints it.
7. From the repository root:

   ```sh
   npm install
   npm run build
   npm run db:migrate
   # Apply deploy/runtime-grants.sql as the migration role.
   npm run db:seed
   npm start
   ```

   The first seed creates PLFE and ZAHRA HOME, twelve monthly periods per
   financial year, one initial branch per company, the eleven template roles
   in each company, approval rules, and an invoice numbering configuration.
   No invoices, accounts, journal entries or other later-phase records exist.
   Business numbering is not consumed by seeding.
8. Run `npm run worker` as a second systemd service alongside the app. Phase 1
   schedules expired-session cleanup only. Use `WorkingDirectory` equal to the
   repository root and the same environment file for both units.
9. Put Nginx in front of port `PORT` (default 3000). For a host-installed Nginx,
   use the supplied TLS template with `proxy_pass http://127.0.0.1:3000` rather
   than Docker's `http://app:3000`. Replace the example hostname/certificate paths.
   Only Nginx should be able to reach the application port.
10. Log in with the seed Owner. Change the temporary password immediately.
    Remove `SEED_OWNER_PASSWORD` and optional test passwords from the long-lived
    runtime environment after seeding. Re-running the seed does not reset users.

`npm run build` does not need a reachable database. Migrations are explicit,
committed SQL files, applied with `prisma migrate deploy`, never `db push`.
After every migration, reapply the runtime grants. Do not give the app role
database ownership, schema creation, DDL, or superuser rights.

For direct systemd deployment, set `EnvironmentFile=/absolute/path/.env`,
`WorkingDirectory=/absolute/path/to/repository`, `ExecStart=/usr/bin/npm start`,
`Restart=on-failure`, `User=plfe`; use a second unit with `npm run worker`.
Use an unprivileged OS account; deny password SSH login and allow only ports
22, 80 and 443 through the firewall.

## Docker Compose deployment

The Docker definition is a **VPS deliverable**; it is not required to develop the
application. The four services are app, worker, postgres and nginx. PostgreSQL has
no published host port, and uploads/database files use named volumes.

1. Install Docker and Compose on the VPS.
2. Copy `.env.example` to `.env`. Set `POSTGRES_DB`, `POSTGRES_USER` and a strong
   `POSTGRES_PASSWORD`; use the same database password in the migration URL.
   Database hostnames in both database URLs must be `postgres`, not localhost.
3. Set `DATABASE_URL` initially to the database-owner URL for bootstrap only,
   `MIGRATION_DATABASE_URL` to the same URL, and fill Owner seed values.
4. Build, migrate and seed explicitly:

   ```sh
   docker compose build
   docker compose up -d postgres
   docker compose run --rm app npm run db:migrate
   docker compose run --rm app npm run db:seed
   ```

5. Create the `plfe_app` login through a private `psql` session:

   ```sh
   docker compose exec postgres psql -U plfe -d plfe
   ```

   Inside psql run `CREATE ROLE plfe_app LOGIN;`, then `\password plfe_app`
   (interactive prompt, not SQL containing a literal password), then apply
   `deploy/runtime-grants.sql`. If using non-default database/user names, replace
   `plfe` accordingly. Change `DATABASE_URL` to this runtime role.
6. The supplied `deploy/nginx.conf` is HTTP bootstrap configuration for ACME
   certificate issuance, **not a working HTTPS login deployment**. Obtain a
   certificate on the VPS with Let's Encrypt/Certbot webroot mode using
   `deploy/acme/` as the challenge directory and `deploy/certificates/` as the
   certificate configuration directory. Start app/nginx for the challenge, then
   replace `deploy/nginx.conf` with the TLS example after substituting your domain.
   Set certificate renewal through the VPS's standard Certbot timer and reload
   Nginx after renewal. Do not commit certificates or private keys.
7. Run:

   ```sh
   docker compose up -d
   docker compose logs --tail=100 app worker nginx
   ```

8. Verify HTTPS and sign in. Remove seed passwords from `.env`, then recreate
   app/worker. Protect `.env` and certificates on disk. Do not expose PostgreSQL.

For updates use `sh deploy.sh`: fast-forward pull, build, migrations, restart.
Apply runtime grants if new tables were added. Review migrations and back up
before updating. Keep database migration access limited to deployment operators.

## Automated Phase 1 checks

Create a **separate test database** whose name ends with `_test`. Tests create and
modify fixture identities, including Owner flags, and must never target live data.
Set `TEST_DATABASE_URL` in `.env`, then run:

```sh
npm run test:phase1
```

The runner rejects database names not ending in `_test`, applies the committed
migrations to that database, then runs the service/database tests. It checks:
company isolation for reads/writes/exports/overview; role permissions; cross-company
foreign keys; global Owner protection; soft-delete uniqueness; immutable and
redacted audits; atomic rollback; session hashing/password policy; date ranges;
concurrent numbering/rollback; exact decimal money; independent approval and
withdrawal. Fixtures are synthetic and are not a substitute for the real-data
acceptance check below.

## Run the exact Phase 1 acceptance test

**“Two companies exist. A user with a role in only one cannot open the other by
changing the URL. Every change shows in the audit log. The app runs on the VPS.”**

1. Log in as Owner and complete the forced password change.
2. Confirm PLFE and ZAHRA HOME exist. Open each company through the company
   switcher. The address includes `/PLFE/admin` or `/ZAHRA-HOME/admin`.
3. In PLFE → Users, create a test administrator with the PLFE Admin role only.
   Use a temporary password known only to the tester. Do not add a ZAHRA HOME role.
   Optional seed variables `SEED_TEST_EMAIL` and `SEED_TEST_PASSWORD` can create
   this account; neither has a default password.
4. In a separate browser/private window, log in as that user, change the temporary
   password, and open `/PLFE/admin/branches`.
5. Change the address to `/ZAHRA-HOME/admin/branches`, then try its users, audit and
   attachments URLs. Access must be denied, not merely hidden from navigation.
   The company switcher must not offer ZAHRA HOME.
6. Attempt a direct GET to `/api/plfe/ZAHRA-HOME/branches`, including
   `?export=xlsx`; both must return 403. Attempt a direct branch create against
   that company with the same signed-in cookie and a valid Origin; it must also
   return 403. Use developer tools without copying session cookies to tickets/logs.
7. As Owner or the PLFE administrator, create/edit a PLFE branch, add a role,
   change a role's permissions, assign/remove a company role, upload/download
   an attachment, and delete a disposable branch. Confirm every business action
   appears in PLFE → Audit trail with actor, timestamp, record and before/after
   values. Owner → Login and system activity shows successful/failed logins.
8. Request an active branch's deactivation. The requester must not approve it.
   A different authorized user approves; the branch becomes inactive and both
   the approval and target change are audited. Repeat with another branch and
   withdraw the request; the branch must remain active.
9. Export a filtered list and open it with Excel. The workbook must contain only
   the company and filters selected. Verify paging/sorting/search after reload.
10. Try to demote/deactivate the last active Owner: the system must reject it.
    Check that sessions show no raw token or token hash.
11. Repeat steps 1–10 on the VPS using HTTPS after a fresh build, migration and
    restart. Confirm `npm start` and `npm run worker` work with no development
    tooling running, or perform the equivalent Compose check.
12. Obtain the planned independent code/security review before production use.
    Record the date and sign-off people; these are not decided yet.

Phase 1 is not operationally signed off until the VPS and real-data checks are
performed. No production host/domain or credentials were supplied during this
implementation; do not infer a completed deployment from a local passing build.

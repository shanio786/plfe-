# PLFE Business System

Portable multi-company administration foundation. Read `docs/PLAN.md` and the
approved overrides in `docs/phase1-decisions.md` before changing business rules.
Phase 1 passed the user's manual acceptance and is complete. Phase 2 Accounts
core is now authorized; do not start Phase 3 without approval. VPS deployment is
deferred to Phase 9. Keep Docker/Compose and `npm start` working, but do not ask
for server details before Phase 9. See `docs/phase2-decisions.md`.

## Required progress and GitHub workflow

After every completed step, commit with a clear message and push to GitHub.
Update `docs/progress.md` before every push with what is done, what is half-done,
and what is next. Make sure `.env` and secrets are in `.gitignore` and never
pushed. If a push is blocked, report the blocker rather than claiming it succeeded.

## Run and verify

- `npm run build` / `npm start` — build and run the single Next.js application.
- `npm run worker` — run the foundation session-cleanup worker.
- `npm run db:migrate` / `npm run db:seed` — explicit Prisma migrations and seed.
- `npm run test:phase1` — isolated PostgreSQL service/database tests.
- Tests require a dedicated `TEST_DATABASE_URL` ending in `_test`, never live data.
- Application settings are documented in `.env.example`.

## Application structure

`artifacts/plfe/` is the portable app root: `app/`, `modules/core/`, `lib/`,
`components/`, `prisma/`, `scripts/`. Root npm commands delegate there.
Deploy only that app with the supplied Docker definition, or use root npm scripts
directly. The earlier API/mockup scaffolds are not part of this business
application and are not runtime dependencies.

## Stack and invariants

Next.js 15 App Router, TypeScript, PostgreSQL 16, Prisma 6 with committed SQL
migrations, Zod, Tailwind/shadcn, TanStack Table and ExcelJS.
Custom opaque database sessions were approved instead of Auth.js; only SHA-256
token hashes are stored. Passwords use bcrypt. Private files use `UPLOAD_DIR`.
No platform-specific authentication, storage, database client or runtime.
Money uses database numeric(18,4), Prisma Decimal and decimal.js, never JS numbers.
Business reads are company-scoped. Writes authorize, transact and audit through
services. Owners are global flags, not merely a company role named Owner.

See `docs/setup.md`, `docs/modules.md` and `docs/backup.md` for deployment,
acceptance, implementation boundaries and operations.

## Authorized fresh-start Accounts revision

Use only this application's own empty database. Do not restore/connect another
database or import Odoo data. The latest five-part Accounts revision supersedes
the old identity/data-preservation blocker. Implement in order: data-driven
companies/enrollment; tax; payment controls; guided opening/imports; intercompany,
cash counts and guarded non-destructive demo reset. These are explicitly Accounts
scope; unrelated Phase 3 work and VPS deployment are not authorized.

The six starting companies are initial configuration, not a runtime allowlist.
Events/Retail behavior follows company-owned business-type data, never its code.
PLFE, SE and LPE close in June; LEV, PFE and Zahra Home close in December.
The UI shows year-end month while storage retains the following start month.
Counterparty links and allocated child codes are permanent.

### Latest pre-Tax additions

Outlets are ordinary company-owned records for **any** company and any number
of locations, not a retail-only list or a fixed showroom count. The operator
chooses their codes, names and types (showroom/counter/gate/office). Creating
one through the back office provisions permanent linked POS cash and inventory
accounts under the respective parents. Templates contain no outlet-specific
accounts before outlets exist. Deactivation retains posted history, links and
numbers. Outlet dimensions now refer to those records; event remains reserved.
This authorizes outlet/location support, not a full POS or inventory application.

Keep the accepted shell and apply the user's accounting interface standard across
all screens: dense neutral information-first surfaces, one restrained accent,
quiet text status badges, consistent dates, and right-aligned tabular amounts as
`Rs 1,234,567.00` with negatives in brackets. Use sortable tables, sticky headers,
filters and clearly labelled totals. Keep important columns accessible on tablets.
Use compact two-column forms where practical, actionable errors beside fields,
visible keyboard focus, Enter to save, Escape to close and a new-document shortcut.
Keep the company switcher visible and the posting company unmistakable.
All interface text is English. Inspect every signed-in Accounts screen at desktop
and tablet widths before moving to Tax, using disposable test data, not live books.
After each completed part, commit/push and record the verified remote revision.
If pushing fails, stop and report the failure rather than continuing.

First-run `/enroll` requires a private random operator credential configured as
`BOOTSTRAP_ENROLLMENT_TOKEN` (32 random bytes / at least 43 base64url characters).
The operator chooses their name, email and login password there. No seed/default
password or invented Owner identity. Enrollment and six-company provisioning are
atomic; reruns never create another initial Owner. Remove the enrollment secret
afterward. `db:seed` only initializes configuration after enrollment.

`npm --prefix artifacts/plfe run test:provisioning` requires a **fresh** dedicated
`_test` database and refuses to erase existing identities. Other test suites can
share a different disposable `_test` database. Never use application books for tests.

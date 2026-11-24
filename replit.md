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

## Authorized Phase 2 correction

The group has six companies and two chart templates. PLFE, SE and LPE close in
June; LEV, PFE and Zahra Home close in December. Zahra Home is the only retailer
and has two showrooms. Keep its existing `ZAHRA-HOME` code; `ZH` is shorthand.
Read the correction in `docs/phase2-decisions.md`. Do not begin Phase 3.

`npm run db:seed:accounts` initializes all six without financial demo documents.
An existing condensed chart/calendar requires explicit, guarded
`npm run db:seed:accounts -- --correct-demo-chart`; add `--demo` only to reseed
the original two companies. This reverses TEST-P2 postings and retains old history;
it never hard-deletes books or resets document counters.

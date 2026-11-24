# PLFE progress

## Five-part fresh-start Accounts revision — 2026-11-24

This supersedes the old missing-original-database blocker below. The operator
authorized only this application's own empty database, without any restore,
external connection or Odoo import.

### Part 1 — implemented; operator enrollment and screen acceptance outstanding

- Added an operator-gated `/enroll` flow. A private, random, app-only enrollment
  credential is required; the operator supplies their own name/email/password.
  Five failed attempts lock enrollment for fifteen minutes. A global identity
  lock serializes enrollment; Owner creation and six-company configuration commit
  together. Enrollment permanently closes afterward. Seeds cannot create/reset
  credentials or add an initial Owner on rerun.
- Added data-owned business types (initial Events/Retail templates), with a
  back-office selection. Business/chart behavior no longer branches on company
  codes. The six names/codes remain initial configuration only.
- Creating a company through the existing screen's service now transactionally
  creates Head Office, roles/grants, the first year/twelve periods, numbering,
  approval defaults, posting settings and business-type chart. Retail receives
  two showrooms. The screen displays the year-END month while submitting the
  following stored year-start month. Type/calendar/currency changes after
  provisioning require controlled conversion rather than silently changing books.
- Delegated company creators require an explicit grant in their source company
  and receive no stronger access in the new company than they held there.
- Group accounts explicitly reference counterparties. A provisioning lock,
  parent locks and database uniqueness prevent duplicate allocations. Both sides
  are created together against active companies; allocated codes/links and
  classifications cannot be changed or deleted, even if unused. Deactivation
  retains all links/numbers. Child numbering is not based on company codes or
  list positions and can extend beyond single-digit suffixes.
- Added four disposable-database regression cases covering gated/concurrent
  enrollment, six complete setups, seventh-company service creation, duplicate
  requests, repeat-safe linking, permanent codes, deactivation, Events/Retail
  behavior, delegated authorization and transactional rollback. First run passed
  **4/4**. Existing suites passed **24/24 foundation** and **22/22 accounting**;
  the optimized production build passed. After the final guards and app-only
  enrollment environment changes, reran all three suites on two newly created
  isolated databases: **4/4**, **24/24** and **22/22** passed again.
- Applied the migration only to this application's own empty local database.
  Rebuilt and restarted the PLFE web server and foundation worker once after the
  changes. Both start cleanly. Preview health returns `{"status":"ok"}` and the
  enrollment endpoint correctly returns available but not configured. A screenshot
  confirmed the enrollment setup-gate page, not authenticated company-screen
  acceptance. The old unrelated API/Canvas scaffolds remain outside this work.
- The application's own `plfe` database was read-only checked: **0 users,
  0 companies, 0 journal entries**. No business data, fabricated opening amounts,
  substitute Owner identity or default password was initialized.

### Half-done / not yet verified

- The operator has not supplied `BOOTSTRAP_ENROLLMENT_TOKEN`; actual enrollment
  and initial company creation remain intentionally gated. No identity was
  invented to bypass this. The actual seventh-company screen and final browser
  financial journeys remain unverified; service/database tests are not claimed
  as screen acceptance.
- Parts 2–5 are **not implemented by this revision yet**. Tax, new payment
  controls, guided opening/imports, intercompany posting/cash counts/reset and
  their requested acceptance coverage remain outstanding.
- Part 1 implementation was committed as
  `a5c25f93fb8dc097b2a3001a3349f3f8de7cb93f` and successfully pushed to
  `origin/main`. `git ls-remote origin refs/heads/main` matched that full local
  revision. This records the code checkpoint, not completion of Part 1's
  outstanding operator/screen acceptance or the overall five-part task.

### Next, in authorized order

1. Finish Part 1 operator enrollment and actual-screen acceptance using the
   private enrollment flow; never share the login password in chat/logs.
2. Continue Tax, then payment controls, guided opening/imports and Part 5.
3. Commit/push each part with honest progress; finish all regression coverage,
   one final disposable-data browser pass, clean app/worker startup and handover.

## Current Phase 2 correction — 2026-11-24

### Implemented and verified

- Added repeat-safe six-company initialization: PLFE, SE, LPE, LEV, PFE and
  Zahra Home. The existing `ZAHRA-HOME` code is preserved (`ZH` is shorthand).
  Initialization preserves existing users, password hashes and memberships.
  Each company has its own roles, Head Office, year/twelve periods, numbering,
  approval defaults, accounting settings and chart; Zahra has two showrooms.
- Added separate agreed Events and Retail templates, stable group-company
  due-from/to children, separate cash/bank/location accounts, retained earnings
  at 3900 and opening-balance equity at 3990. Group accounts remain non-posting.
- Added the explicit Owner-only `--correct-demo-chart` maintenance operation.
  It refuses non-TEST-P2 financial history and opening balances, preserves
  immutable entries/lines, cancels sources and posts linked reversals through
  shared services, and retains zero-balance inactive legacy chart rows.
  Number counters, normal approval defaults and database protections stay intact.
  The narrow demo-calendar correction refuses locked/closed or multi-year books.
- Kept replacement demos behind the separate `--demo` option. They use the
  correct chart for each original company; the four new companies receive no
  demo documents during ordinary initialization or demo reseeding.
- Added optional nullable province, database/service validation, create/edit
  selection with None to clear, list/detail display and Excel export. Existing
  records are not backfilled. No tax rules, POS workflow or Phase 3 work started.
- Installed the existing standalone npm dependencies without stack changes.
  Prisma generation/type checking and the optimized production build passed.
- Ran both complete automated suites on a newly created isolated
  `plfe_correction_test` database: **24/24 Phase 1** and **22/22 Phase 2** checks
  passed. The six added correction tests cover preserved identities/memberships,
  immutable originals, sequence preservation, six calendars/setups, repeat-safe
  seeding, chart structure, province persistence/clearing/export, real-data
  refusal, Owner enforcement and lock-date rollback.
- Both reconstructed legacy-company fixtures balance after correction and
  twenty replacement postings each: **PLFE debit/credit PKR 3,818,900.0000**;
  **ZAHRA-HOME debit/credit PKR 3,818,900.0000**. These are isolated test
  results, not a claim that the unavailable original books have been converted.
- Created the missing local PostgreSQL cluster and applied the four committed
  schema migrations to its empty `plfe` database. The web server and cleanup
  worker start cleanly. The sign-in page was visually verified; authenticated
  party screens were not browser-verified. Foundation HTTP authentication,
  company-scope and session checks passed against isolated test identities.

### Blocked / not done

- The GitHub import did not include the original local PostgreSQL files or the
  original Owner/company data. The configured local `plfe` database is newly
  initialized and empty of business identities/data; it is **not** the earlier
  seeded development database. No replacement Owner credential was invented,
  and no existing user's credential or membership was changed.
- Therefore applying the six-company/chart correction and reseeding to the
  user's actual original two companies remains blocked until their database
  is restored or connected. No production or original-data trial balance has
  been claimed as verified.
- This progress update precedes the correction commit/push; the final handover
  reports the actual GitHub push outcome.

### Next within authorized scope

1. Restore/connect the original database without replacing its identities.
2. Apply committed migrations, then explicitly run
   `npm run db:seed:accounts -- --correct-demo-chart --demo`.
3. Confirm all six setups and both original-company trial balances against that
   database, and finish signed-in party-screen acceptance.
4. Stop within Phase 2. Phase 3 and VPS deployment remain unauthorized/deferred.

## Historical progress before the import

## Done

- **Phase 1 complete:** the user manually tested the foundation and confirmed it
  passes. VPS deployment is no longer a Phase 1 acceptance gate.

- Phase 1 foundation implemented in Next.js 15, TypeScript and PostgreSQL 16,
  using Prisma migrations and portable npm commands.
- Company and branch administration; global users and Owners; company-specific
  roles, permissions and memberships.
- Opaque hashed sessions, password policy and forced initial password change.
- Financial years and periods, transaction-safe numbering, approval rules and
  the Phase 1 branch-deactivation approval flow.
- Protected private-disk attachments, company-scoped Excel exports and audit logs.
- Initialized PLFE and ZAHRA HOME, each with eleven roles, a Head Office, one
  financial year with twelve periods, approval defaults and invoice numbering.
- Initialized one active Owner and confirmed the first-login password change
  was completed.
- Production build, standard `npm start`, worker startup and database health checks
  passed locally. All twenty-four automated checks passed, including an isolated
  production HTTP authentication/profile/session journey.
- Added Docker Compose, Nginx templates, deployment and backup guidance, the
  schema diagram and the Phase 1 acceptance checklist in `docs/setup.md`.
- Documented the requirement to update this file, commit clearly and push to
  GitHub after each completed step. Environment files and private credentials
  are excluded from version control; only placeholder `.env.example` files belong
  in Git.
- Configured `origin` for `https://github.com/shanio786/plfe-`, targeting `main`,
  without replacing the workspace backup remote. The GitHub repository is public;
  only source code, documentation and non-secret example configuration belong there.
- Completed the in-workspace pre-deployment review and fixed approval bypasses,
  delegated account takeover, concurrent audit snapshots and runtime credential
  exposure. See `docs/phase1-review.md` for evidence and remaining gates.
- Patched dependency findings while retaining the agreed stack. The follow-up
  dependency scan reported zero findings. Static analysis's dummy bcrypt-hash
  match was reviewed as a false positive; the privacy scan reported no findings.
- Added the operator-only maintenance environment and Compose profile, and
  updated deployment commands to build the migration image before use.
- Fixed workspace-linked npm lock entries and added isolated lock generation.
  A clean source copy with no pnpm modules passed `npm ci`, `npm run build`,
  `npm start` and database health checks. The final dependency scan remained clear.
- Matched the form resolver to patched Zod 4 and added a shared-form regression
  covering both invalid field errors and valid submissions.
- **Phase 2 step 1 complete:** added the Accounts-only migration (thirteen new
  tables), accounting departments and nullable event/outlet/department ledger
  tags. Company-composite foreign keys protect accounting references.
- PostgreSQL now has initially deferred parent/line balance constraint triggers,
  posted-entry/line protection, exact reversal matching and posted-document
  protection. Prisma validation/generation and migration deployment passed on
  both local development and isolated test databases; deferred-trigger metadata
  and the three dimension columns were verified.
- **Phase 2 step 2 complete:** implemented the shared `/lib/posting` boundary,
  draft/post/reversal workflows, permission-checked company-scoped services,
  transaction-safe numbering, allocation/advance handling and audit snapshots.
- Added accounting master/settings services, first-install chart initialization,
  company provisioning integration and Phase 2 permission templates. Financial
  approvals execute in the existing approval transaction; posted source documents
  retain their originals and link their reversals.
- Added the accounting API, scoped document attachments/exports, SQL trial balance,
  general/account/party ledgers and posted-entry overview. High-value net cash/bank
  outflows through vouchers use the payment approval rule too. Application and
  shared-library type checks passed; automated runtime checks are recorded in
  Phase 2 step 5 below.
- **Phase 2 step 3 complete:** added the Accounts workspace in the accepted shared
  shell, with chart/party/department/journal management, invoices/credit notes,
  bills/debit notes, receipts/payments and advance allocation, manual vouchers,
  company posting mappings, trial balance and ledgers.
- The Accounts screens reuse the Phase 1 table/forms, keep money as decimal
  strings, support source/reversal drill-through and scoped attachments, and
  show independent-approval requests without pretending they have executed.
  Static integration passed; signed-in browser acceptance remains unverified below.
- **Phase 2 step 4 complete:** initialized both companies from the same thirty-seven
  account expo template, with five journals, three departments, thirteen number
  series and independent posting mappings. Existing credentials were not changed.
- Added an explicit `--demo` seed, separate from ordinary initialization/startup.
  Both PLFE and ZAHRA HOME now have twenty clearly marked `TEST-P2` mixed posted
  documents, including notes, partial payments, an advance application, vouchers
  and an expense with a private attached test bill. Both trial balances agree;
  automated cancellation/reversal acceptance passed in step 5.
- **Phase 2 step 5 complete:** sixteen automated accounting tests pass against
  the isolated `plfe_test` database; all twenty-four Phase 1 regression tests
  pass, and the optimized production build succeeds. Tests cover the Build-order
  books, database-enforced commit-time balance, no-repeat numbers, company
  isolation, allocation/advance handling and independent invoice reversal.
- Added a dedicated `npm run test:phase2` guard that refuses non-`_test`
  databases. No Owner password or real credential was used or reset.
- **Phase 2 step 6 complete:** documented module responsibilities, phase limits,
  seed safety, automated and manual acceptance, and the root test command in
  `docs/modules.md` and `docs/phase2-acceptance.md`.
- Phase 2 implementation steps 1–6 are complete and pushed to GitHub. The final
  browser view remained at sign-in; signed-in screens were not browser-verified
  because the available automated-browser testing service was unavailable.

## Half-done

The historical Phase 2 implementation below predates this import. The current
correction and missing-original-database blocker are recorded above. Signed-in
browser acceptance remains unverified, not a passed test.

## Deferred to Phase 9

- VPS configuration/deployment, server details, HTTPS, operational backups and
  on-server acceptance. Keep Docker and standard npm operation portable meanwhile;
  do not request server details before Phase 9.
- The separate external pre-deployment Claude Code sign-off remains pending; it
  is not represented as completed by the in-workspace review.

## Next

1. Stop here. Wait for authorization before starting Phase 3.

## Workflow for each completed step

1. Record the actual outcome here under Done, Half-done and Next. Do not list
   unverified work as completed.
2. Check the staged changes for environment files, secrets, private keys, uploaded
   business data and generated build outputs. Never commit or push them.
3. Commit the completed step with a clear message.
4. Push to `origin` (`https://github.com/shanio786/plfe-`) and verify that its
   `main` commit matches the local commit before reporting success.
   If blocked, keep the local commit and report the exact outstanding requirement.

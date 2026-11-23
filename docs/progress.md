# PLFE progress

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
  shared-library type checks passed; runtime accounting acceptance is still pending.
- **Phase 2 step 3 complete:** added the Accounts workspace in the accepted shared
  shell, with chart/party/department/journal management, invoices/credit notes,
  bills/debit notes, receipts/payments and advance allocation, manual vouchers,
  company posting mappings, trial balance and ledgers.
- The Accounts screens reuse the Phase 1 table/forms, keep money as decimal
  strings, support source/reversal drill-through and scoped attachments, and
  show independent-approval requests without pretending they have executed.
  Static integration passed; live seeded-data/browser checks are scheduled below.
- **Phase 2 step 4 complete:** initialized both companies from the same thirty-seven
  account expo template, with five journals, three departments, thirteen number
  series and independent posting mappings. Existing credentials were not changed.
- Added an explicit `--demo` seed, separate from ordinary initialization/startup.
  Both PLFE and ZAHRA HOME now have twenty clearly marked `TEST-P2` mixed posted
  documents, including notes, partial payments, an advance application, vouchers
  and an expense with a private attached test bill. Both trial balances agree.
- **Phase 2 step 5 complete:** sixteen automated accounting tests pass against
  the isolated `plfe_test` database; all twenty-four Phase 1 regression tests
  pass, and the optimized production build succeeds. Tests cover the Build-order
  books, database-enforced commit-time balance, no-repeat numbers, company
  isolation, allocation/advance handling and independent invoice reversal.
- Added a dedicated `npm run test:phase2` guard that refuses non-`_test`
  databases. No Owner password or real credential was used or reset.
- Final browser login and signed-in Accounts pages could not be verified in this
  run because the available automated-browser testing service was unavailable.

## Half-done

- Phase 2 documentation and final handover are being finalized in
  `docs/modules.md` and `docs/phase2-acceptance.md`. Automated checks and build
  are complete; signed-in browser acceptance remains unverified.

## Deferred to Phase 9

- VPS configuration/deployment, server details, HTTPS, operational backups and
  on-server acceptance. Keep Docker and standard npm operation portable meanwhile;
  do not request server details before Phase 9.
- The separate external pre-deployment Claude Code sign-off remains pending; it
  is not represented as completed by the in-workspace review.

## Next

1. Commit and push the completed Phase 2 automated-test step.
2. Finish/update module and acceptance documentation, then commit and push that
   documentation step. Stop before Phase 3.

## Workflow for each completed step

1. Record the actual outcome here under Done, Half-done and Next. Do not list
   unverified work as completed.
2. Check the staged changes for environment files, secrets, private keys, uploaded
   business data and generated build outputs. Never commit or push them.
3. Commit the completed step with a clear message.
4. Push to `origin` (`https://github.com/shanio786/plfe-`) and verify that its
   `main` commit matches the local commit before reporting success.
   If blocked, keep the local commit and report the exact outstanding requirement.

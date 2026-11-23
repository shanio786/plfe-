# Phase 2 Accounts core acceptance

Phase 1 was manually accepted. VPS deployment is deferred to Phase 9; no server
details are needed for these tests. Docker/Compose and standard npm startup remain
supported, but actual VPS/Docker operation has not been represented as tested.

## Automated Build-order test

Use PostgreSQL 16 and Node.js 22 with the application's dependencies installed.
Create a separate disposable database whose name ends in `_test`, and put its
connection URL in the untracked `.env` as `TEST_DATABASE_URL`.

Example placeholder only:

```dotenv
TEST_DATABASE_URL=postgresql://test_operator:CHANGE_ME@127.0.0.1:5432/plfe_test?schema=public
```

The test role needs migration/schema privileges **in this disposable database**.
Do not use the runtime production role or point this setting at real books.

From the repository root:

```bash
npm run test:phase2
```

Or from a standalone application copy:

```bash
cd artifacts/plfe
npm ci
npm run test:phase2
```

The command validates the `_test` suffix, generates Prisma, applies the committed
migrations to that database, creates unique synthetic companies/users, seeds
twenty mixed documents per company and runs sixteen assertions. It does not use
the development `PLFE_DATABASE_URL` for test writes. Test uploads go to a separate
ignored `var/test-uploads/accounts` directory. No real Owner credential is read,
reset or printed. The separate foundation regression command is:

```bash
npm run test:phase1
```

The three Build-order outcomes are explicitly tested:

1. Twenty mixed documents post, and the trial balance's debit and credit agree.
2. A PKR 100,000 invoice with a PKR 40,000 receipt shows PKR 60,000 outstanding.
3. Cancelling a separate invoice requires independent approval, retains the
   original posted entry and creates one exact, linked reversal dated on the
   cancellation day inside an open period.

Other checks bypass the app deliberately to prove PostgreSQL rejects unbalanced
entries at **commit**, empty posted entries and changes/deletion/truncation of
posted history. Expected rejection messages in PostgreSQL logs during this suite
are evidence of those negative tests, not an application startup failure.

## Initialization versus demo data

After foundation initialization and the Owner's first password change:

```bash
npm run db:migrate
npm run db:seed:accounts
```

This creates the shared-template chart independently in PLFE and ZAHRA HOME,
journals, departments, numbering, posting settings and module permission grants.
It does **not** add financial test documents. Re-running initialization does not
reset company edits. New companies initialize their own chart automatically.

Only in empty development books:

```bash
npm run db:seed:accounts -- --demo
```

This explicit option adds twenty posted documents per company, narrated
`TEST-P2/…`, plus two clearly named test parties and an attached synthetic expense
bill. It refuses to mix with non-demo posted history. Both current development
companies already have this fixture; do not treat it as migrated Odoo data.
Never delete posted demo entries to clean real books; use a fresh database for
go-live or reverse appropriate documents with an audit trail.

## Manual Build-order walkthrough

Use two separate users in the same company: an Accountant/requester and another
user with `accounts.approval.approve`. They must finish any forced first password
change. Even an Owner cannot approve their own request.

1. Select PLFE, open **Accounts → Trial balance**, and confirm that it agrees.
   Switch to ZAHRA HOME and confirm its independent chart and balance.
2. In PLFE invoices, find the `TEST-P2/03-invoice` document for **TEST DATA — Expo
   exhibitor**. Its total is PKR 100,000, paid is PKR 40,000 and outstanding is
   PKR 60,000, with **Part paid** status. Its linked receipt is
   `TEST-P2/10-part-receipt`.
3. Inspect `TEST-P2/11-receipt-with-advance`: PKR 25,000 received, PKR 20,000
   allocated and PKR 5,000 left as an advance. `TEST-P2/20-advance-applied` shows
   a later PKR 10,000 advance application to the showroom invoice.
4. Open `TEST-P2/05-cancellation-candidate`, an unallocated PKR 25,000 invoice.
   Follow its journal link and note the original entry number. Request
   cancellation with a reason. The invoice remains posted pending approval.
5. In the second user's **Admin → Approvals**, approve that request. Reload the
   invoice: it is cancelled, its original entry still exists and it links to a
   new reversal. The original entry remains POSTED and read-only; the reversal
   has the opposite debit/credit on the same accounts/dimensions.
6. Return to the trial balance and ledger. Both original and reversal appear;
   the trial balance still agrees. Export the report to Excel and drill through
   a ledger row back to its entry/source.

Posting/cancellation needs an open fiscal year and monthly period covering the
date. If time has advanced beyond the seeded year, create the next year through
the existing financial-year screen; do not alter historical posted dates.

## Scope limits

No tax calculations, cheque clearing, petty-cash boxes, budgets, full statements,
PDF printing or period-close workflow are claimed for Phase 2. These belong to
Phase 3. Event/outlet tags are reserved and remain null until their modules exist.
Do not start Phase 3 or VPS deployment without the user's authorization.

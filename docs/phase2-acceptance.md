# Phase 2 Accounts core acceptance

Phase 1 was manually accepted. VPS deployment is deferred to Phase 9; no server
details are needed for these tests. Docker/Compose and standard npm startup remain
supported, but actual VPS/Docker operation has not been represented as tested.

## Automated Build-order test

Use PostgreSQL 16 and Node.js 20 or later with the application's dependencies installed.
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
twenty mixed documents per company and runs the existing sixteen accounting
checks plus six company/chart/province correction checks. It does not use
the development `PLFE_DATABASE_URL` for test writes. Test uploads go to a separate
ignored `var/test-uploads/accounts` directory. No real Owner credential is read,
reset or printed. The separate foundation regression command is:

```bash
npm run build
npm run test:phase1
```

The foundation HTTP checks start an isolated production server, so build first.

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

This initializes all six group companies with independent roles, Head Office,
their current financial year and twelve monthly periods, journals, departments,
numbering and posting settings. PLFE/SE/LPE close in June; LEV/PFE/Zahra Home
close in December. Zahra Home retains its existing `ZAHRA-HOME` code and gets two
showroom branches. The five events companies use the agreed Events chart; Zahra
Home uses Retail. It does **not** add financial test documents. Re-running
initialization does not reset credentials, memberships, edited charts, posting
settings or counters. Existing wrong charts/calendars require the explicit
correction below; ordinary initialization never silently replaces them.

For the already-authorized replacement of the old condensed TEST-P2-only books:

```bash
npm run db:seed:accounts -- --correct-demo-chart --demo
```

The correction refuses non-demo financial history (including drafts), party
opening balances, locked posting dates and closed periods. It is an Owner-only
operator maintenance service, not an HTTP cancellation path. It retains original
posted entries and source documents and uses shared reversal/cancellation
services to zero old accounts. Old chart rows remain inactive with `LEGACY-`
codes; original entries and lines remain unchanged. Unposted demo drafts are
archived, not hard-deleted. Existing approval defaults remain unchanged; ordinary
document cancellation still requires the independent approval workflow.

The limited old Zahra July-calendar correction preserves the fiscal ID and all
number counters, archives old period configuration and creates twelve calendar
months. It refuses multi-year demo histories or postings outside the replacement
calendar year rather than changing any posted entry.

Only in empty development books:

```bash
npm run db:seed:accounts -- --demo
```

This explicit option adds twenty posted documents to each of the original two
companies, narrated `TEST-P2/CORRECTED/…`, plus two clearly named test parties and an
attached synthetic expense bill. The four new companies remain free of demo
financial documents. It refuses to mix with non-demo financial history. Do not
treat these synthetic fixtures as migrated Odoo data. A corrected demo company
retains original/reversal entries in addition to the twenty replacement postings;
its trial balance therefore includes those historical debit/credit movements.
Never delete posted demo entries to clean real books; use a fresh database for
go-live or reverse appropriate documents with an audit trail.

## Manual Build-order walkthrough

Use two separate users in the same company: an Accountant/requester and another
user with `accounts.approval.approve`. They must finish any forced first password
change. Even an Owner cannot approve their own request.

1. Select PLFE, open **Accounts → Trial balance**, and confirm that it agrees.
   Switch to ZAHRA HOME and confirm its independent chart and balance.
2. In PLFE invoices, find the `TEST-P2/CORRECTED/03-invoice` document for the
   **TEST DATA** customer. Its total is PKR 100,000, paid is PKR 40,000 and outstanding is
   PKR 60,000, with **Part paid** status. Its linked receipt is
   `TEST-P2/CORRECTED/10-part-receipt`.
3. Inspect `TEST-P2/CORRECTED/11-receipt-with-advance`: PKR 25,000 received, PKR 20,000
   allocated and PKR 5,000 left as an advance. `TEST-P2/CORRECTED/20-advance-applied` shows
   a later PKR 10,000 advance application to a sales invoice.
4. Open `TEST-P2/CORRECTED/05-cancellation-candidate`, an unallocated PKR 25,000 invoice.
   Follow its journal link and note the original entry number. Request
   cancellation with a reason. The invoice remains posted pending approval.
5. In the second user's **Admin → Approvals**, approve that request. Reload the
   invoice: it is cancelled, its original entry still exists and it links to a
   new reversal. The original entry remains POSTED and read-only; the reversal
   has the opposite debit/credit on the same accounts/dimensions.
6. Return to the trial balance and ledger. Both original and reversal appear;
   the trial balance still agrees. Export the report to Excel and drill through
   a ledger row back to its entry/source.
7. Open Parties, create or edit a party, select any of the five Pakistani
   provinces and save. Reopen and verify the selection; choose None to clear it.
   Verify the province in the list, details and Excel export. Existing records
   remain blank until explicitly edited; province is not mandatory.

Posting/cancellation needs an open fiscal year and monthly period covering the
date. If time has advanced beyond the seeded year, create the next year through
the existing financial-year screen; do not alter historical posted dates.

## Scope limits

No tax calculations, cheque clearing, petty-cash boxes, budgets, full statements,
PDF printing or period-close workflow are claimed for Phase 2. These belong to
Phase 3. Event/outlet tags are reserved and remain null until their modules exist.
Do not start Phase 3 or VPS deployment without the user's authorization.

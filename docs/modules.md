# Module status

## Phase 1 — Foundation

Implemented in the single Next.js 15 application under `artifacts/plfe/`.

### Core model, queries and service

`modules/core/model.ts` defines the actor and supported resources.
`schema.ts` contains shared Zod schemas for forms and server input.
`queries.ts` scopes business reads to an authorized company and implements
database-side search, sorting, filtering, paging, overview counts and exports.
`service.ts` performs permission checks, writes in one Prisma transaction and
adds redacted audit records in that same transaction.

No React component owns business rules. Client components collect form values
and call the same-origin API under `/api/plfe`; routes invoke these services.

### Screens

Login, forced password change, company selection/switcher, overview, companies,
branches, users with company-access assignment and password reset, roles and
permissions, numbering, fiscal years/periods, approval rules/inbox/detail,
attachments, audit log including Owner-only authentication/system scope, profile
editing and session revocation. Shared TanStack Table lists export real Excel
workbooks through ExcelJS.

### Authentication

Custom database sessions were explicitly approved instead of Auth.js.
Random 256-bit tokens are hashed with SHA-256 in the sessions table. Cookies
are always Secure/httpOnly/SameSite=Lax. Idle and absolute expiration are checked
on requests. Forced-password users cannot access business services. Password
change/reset revokes other/all sessions respectively. Failed logins are counted
under a database lock and audited, without password/token data.

### Authorization

Global active-Owner flag, exact permission codes, company role membership and
multi-role union. Every business read/write resolves its company in the data
layer. Composite foreign keys also prevent cross-company role/fiscal references.
Only an Owner can alter global identity fields belonging to another Owner or a
user assigned to multiple companies. Company Admins can manage their own company
memberships but cannot change their own grants or grant permissions they lack.

### Audit and database integrity

The committed Prisma migration history includes foreign keys, active-only unique
indexes, numeric/date/status checks, non-overlap validation, append-only audit
triggers and last-Owner safeguards. Request/application credentials must use a
limited role, not the schema owner. `deploy/runtime-grants.sql` documents grants.
User/role assignment changes retain their audit history after link deletion.
Technical session touches do not generate a business-change audit entry.

### Numbering

`lib/numbering.ts` accepts the caller's transaction and locks the company/type/year
counter. Numbers are strings; counters are BigInt. A rollback restores the
counter. The configured number series becomes immutable once consumed.
There is no UI action to consume business numbers without a document.

### Approvals

Company-specific rules, decimal-string payment thresholds and immutable request
snapshots. Branch deactivation is the working Phase 1 handler, allowing the
foundation workflow to be exercised without pretending later modules exist.
Approval locks and checks the target version; decision, action and audits commit
together. Phase 2 attaches typed financial cancellation and high-value-payment
handlers. POS returns and refunds remain future-module handlers; their seeded
rules do not execute nonexistent business actions.

### Attachments

Private disk bytes under `UPLOAD_DIR` with UUID storage names and metadata in
PostgreSQL. Company, branch and user-photo targets are validated against the
authorized company. Upload limits and file signatures are checked; downloads
require authentication, company scope, attachment permission and a valid target.
Soft-deleted attachment bytes are retained for backup/audit retention but become
unavailable through the API. If the DB transaction fails, the new disk file is
removed. A process crash between writing bytes and committing metadata can leave
an unreferenced file; reconcile against metadata during maintenance, never delete
based solely on modification time.

### Worker/deployment

node-cron session cleanup worker; direct npm operation; Docker/Compose and Nginx
HTTP-bootstrap/TLS examples; `.env.example`; setup, acceptance and backup guides.
The Docker/VPS definitions require verification on the actual target host.

## Phase 2 — Accounts core

Implemented in the same portable application. Accounts and Admin share the
authenticated shell, company switcher, permission context, list table and form
components. No separate runtime, hosted database, authentication SDK or object
storage was introduced.

### Data and posting boundary

Company-owned chart accounts, parties, departments, journals, entries/lines,
invoices/lines, bills/lines, payments/allocations and posting mappings. Departments
are the shared identity HR will reuse. `journal_lines` includes nullable event,
outlet and department IDs from its first migration. Department references use
company-composite foreign keys; event/outlet foreign keys wait for their tables.
Invoice/bill line tax IDs are reserved, without a premature tax-table dependency.

`lib/posting` is the only writer of journal lines, including manual draft edits.
`modules/accounts/service.ts` is the public financial-write boundary; its helpers
accept the caller's transaction. Permissions, target-company validation, document
number, document mutation, entry/lines and redacted audit records commit together.
Money is numeric(18,4)/Decimal throughout; API and form amounts are strings.

The migration adds **initially deferred PostgreSQL constraint triggers on both
entries and lines**. Commit rejects empty/unbalanced posted entries, even through
direct SQL. Row locks serialize line mutation against posting. Posted entries
and lines cannot be updated, deleted, soft-deleted or truncated. Reversals must
mirror the original account, party, dimensions and amounts exactly. Original
entries stay POSTED; their reversal relation indicates that they were reversed.
Posted source financial fields/lines are also protected. Cancelled documents keep
their original entry link and gain a reversal-entry link.

### Documents and allocations

Sales invoices and linked credit notes; purchase bills and linked debit notes;
receipts/payments; journal, cash, bank, transfer and expense vouchers. Drafts can
be edited or archived; posted documents can only be cancelled by reversal. Posting
and reversal dates must belong to an open financial year/period.

A payment can cover several same-party invoices/bills, or only part of one.
Unallocated money remains a party advance; applying it changes allocations,
not the immutable posted entry. Receipts credit receivables and payments debit
payables, so unapplied amounts remain visible in the party ledger. Credits/debits
reduce their linked original document's outstanding. Over-allocation and
cross-party/company allocation are rejected under a company accounting lock.

Default cancellation and above-threshold outgoing-payment rules require an
independent approver, including Owners' own requests. Net outgoing cash/bank
voucher amounts use the payment rule too, preventing a voucher workaround.
Transfers between bank and cash have no net external outflow. Approval rechecks
the target version and executes with the decision/audit in one transaction.
Cancel/reallocate settled payments and reverse related notes before cancelling
an original invoice/bill. Supporting bills for posted expense vouchers are kept.

### Chart, settings and roles

The agreed Events/Retail templates create **separate** charts for each company,
with aligned shared codes, five journals, three initial departments and thirteen
number series. PLFE/SE/LPE have July–June financial years; LEV/PFE/Zahra Home
have January–December years. Zahra Home retains its original company code and
has two showroom branches, cash accounts and inventory-location subaccounts.
Group accounts are non-posting; each company gets five due-from and five due-to
posting children using stable group-company suffixes. Retained earnings is 3900,
while the required opening-equity mapping uses 3990.
First initialization adds the new module grants to named system roles, but later
runs do not reset edited mappings, charts or grants. New companies initialize
their chart during authorized company provisioning.

Accountant receives full Phase 2 Accounts access; Viewer receives report/source
read access only. Other operational roles gain no premature Accounts powers.
Company settings map receivable, payable and opening-equity accounts plus sales,
purchase, general, bank and cash journals. Control-account remapping requires a
settled old balance; historical posting classifications cannot be rewritten.
Nonzero party opening balances post an audited opening journal, not a floating
number outside the ledger.

Province is an optional party field constrained in both the schema/service and
PostgreSQL to the five agreed Pakistani province/territory values. Existing
parties remain null; create/edit, list, detail and Excel export carry the field.
It does not activate any tax calculation.

The explicit `--correct-demo-chart` maintenance operation requires a live Owner,
company accounting permissions and the ledger transaction lock. It rejects
non-demo financial history, then reverses/cancels TEST-P2 documents with shared
posting services and retains the original entries, lines, source records and
zero-balance inactive legacy accounts. No constraints or document counters are
disabled/reset. The narrow demo calendar correction preserves fiscal IDs,
archives old periods and refuses locked/closed or multi-year histories.
Ordinary initialization/startup never executes this operation or demo seeding.

### Screens and reports

`/[company]/accounts/overview`, `chart`, `parties`, `departments`, `journals`,
`invoices`, `bills`, `payments`, `vouchers`, `settings`, `trial-balance`, `ledger`
and `party-ledger`. Lists support scoped search, sorting, paging, filters and Excel
export. Documents, source entries and reversals link to each other. Documents
support private-disk attachments with target-level Accounts read permission.

SQL-derived trial balance, general/account ledger and party ledger support date
ranges and account/party/department dimensions. Ledger opening/running/closing
balances include prior activity. General ledger running balances partition by
account; party ledger shows the selected party's net balance. Reports include
originals **and** reversals, never omit history to make a cancellation disappear.
The overview reads posted liquidity, invoice/bill outstanding and recent entries.

### Seed and verification

Ordinary Accounts initialization creates masters/settings only. An explicit
`npm run db:seed:accounts -- --demo` adds clearly marked `TEST-P2` documents and
private synthetic expense bills; never run it in real books. It refuses to mix
with non-demo posted activity. Both development companies were seeded with
twenty mixed posted documents and balanced trial balances.

`npm run test:phase2` uses only a dedicated `_test` database. Its sixteen automated
checks cover the build-order scenario, commit-time balance rejection, immutable
history, exact money, concurrency/rollback, isolation, allocations, approvals and
cancellation reversal. See [Phase 2 acceptance](phase2-acceptance.md) for commands
and the manual accounting test.

### Intercompany, cash counts and reset

`modules/accounts/intercompany.ts` owns every movement between two group
companies. It writes both companies' journal entries inside one transaction and
links them permanently to the movement, using the paired due-from/due-to accounts
that `counterparties.ts` allocates at provisioning. No other module may post to a
group company account. Posting requires the intercompany posting right in both
companies; without it the request becomes an independent approval in the
initiating company and nothing is written. Cancelling reverses both sides
together. The group balances report reads each company's own books separately and
states whether the two agree; it spans companies and is the Owner's.

`modules/accounts/cash-count.ts` owns the daily count of one cash account. It
computes the book balance from posted lines up to that date, recomputes it at
posting time, and refuses a count whose book balance moved since it was saved. A
difference needs a written explanation and posts to the company's cash difference
account through the shared posting boundary; a count that agrees posts no entry
and still takes a number from the same series. Bank accounts are not counted.

`prisma/reset-company.ts` is operator-only maintenance, never reachable over
HTTP. It deletes a company's demo documents and restarts its numbering so the
company is handed over exactly as a new one. It lifts the protective triggers for
the length of its own transaction, which is why it refuses any database that is
not development or test and refuses a company whose books have been declared
open. It keeps the append-only audit log and warns when another company still
holds the other half of an intercompany movement.

The screens for these three are not built yet; the services, database rules, API
routes and automated checks are.

## Deferred beyond Accounts core

Phase 3: cheque/petty-cash operations, sales/withholding tax calculations and
returns, budgets, P&L, balance sheet, aging, cash/bank/day books, PDF printing and
period lock/reopen UI. Seeded tax-related accounts are not tax functionality.

Later phases: Events, POS, HR, CMS, Odoo opening-balance import and Owner group
summary. VPS deployment, operational backup scheduling/restore drills, monitoring
and training remain Phase 9; do not ask for server details before then.

## Historical Phase 1 boundary

Accounts/ledger/posting, fiscal close/reopen, PDFs of money documents, Events,
visitor registration, POS, HR, CMS, Odoo import and Owner group financial summary.
Automated off-server backup/restore scheduling, monitoring and training are
go-live work, not falsely represented as operational here.

## Verification

The automated foundation suite exercises 24 checks. See
`docs/setup.md` for the safety-isolated test command and the exact manual Phase 1
acceptance procedure. Synthetic fixtures do not count as real-data sign-off.

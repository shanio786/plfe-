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
together. Posted-document cancellations, POS returns, refunds and payments attach
their own typed handlers in later phases. Their seeded rules do not execute
nonexistent business actions.

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

## Not implemented in Phase 1

Accounts/ledger/posting, fiscal close/reopen, PDFs of money documents, Events,
visitor registration, POS, HR, CMS, Odoo import and Owner group financial summary.
Automated off-server backup/restore scheduling, monitoring and training are
go-live work, not falsely represented as operational here.

## Verification

The automated foundation suite exercises 17 service/database checks. See
`docs/setup.md` for the safety-isolated test command and the exact manual Phase 1
acceptance procedure. Synthetic fixtures do not count as real-data sign-off.

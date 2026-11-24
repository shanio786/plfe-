# Approved Phase 2 scope

## Latest override: five-part fresh start

Use this app's own empty database, without external restoration/connection or
Odoo import. Prior instructions below to preserve original company identities
and assign fixed group suffixes are superseded. Initial companies are fixture
configuration; behavior follows extensible business-type data. Allocate linked
counterparty children once, permanently, under locks; never derive their codes
from company codes or seed ordering.

The latest authorized Accounts work is five ordered parts: (1) gated first-run
Owner enrollment and data-driven company provisioning, (2) effective-dated tax,
(3) payment controls, (4) guided opening and validated preview-confirmed imports,
(5) linked intercompany postings, cash counts and non-destructive demo reset.
Each part needs full services/screens/regressions, progress documentation and a
verified commit/push before the next part. No unrelated Phase 3 work or VPS
deployment is authorized. No real opening amounts or legal tax rates may be
invented. Historical approval/financial protections below remain mandatory.

The following earlier scope describes the baseline and is historical wherever
it conflicts with this override.

The user approved Phase 1 manual acceptance and authorized Phase 2 Accounts core.
These instructions override conflicting sequencing in the original plan.

- VPS deployment is deferred to Phase 9. Maintain Dockerfile, Compose and
  `npm start`; do not request server details before then.
- Build only Accounts core: the chart, parties, accounting departments, journals,
  journal vouchers, sales invoices/credit notes, purchase bills/debit notes,
  receipts/payments and allocation, cash/bank vouchers, transfers/expenses,
  shared posting, trial balance and ledgers.
- `journal_lines` must have nullable `event_id`, `outlet_id` and `department_id`
  from its first migration. Add event/outlet foreign keys only in the phases
  that create those tables.
- Create departments now as a company-owned accounting dimension. HR reuses it
  later instead of creating a separate department identity.
- A PostgreSQL deferred constraint trigger must reject an unbalanced posted
  journal entry at commit, independently of application validation.
- Posted entries cannot be edited or deleted. Corrections/cancellations use
  visible linked reversing entries.
- `/lib/posting` is the one shared posting service. No other module writes
  journal lines directly.
- Seed each company's own chart from the agreed Events or Retail template,
  according to the six-company correction below.
- Complete and commit/push each step: migration; services; screens; both-company
  test seed; accounting tests; module/progress documentation and handover.
- The Phase 2 acceptance remains: twenty mixed posted documents, balanced trial
  balance, correct partially paid invoice outstanding, cancellation by reversal.

## Authorized six-company correction

This remains Phase 2 Accounts work; Phase 3 is not authorized.

- The group comprises PLFE (Pakistan Lifestyle Furniture Expo), SE (STYLE
  EVENTS), LPE (Lifestyle Property Expo), LEV (Lifestyle Event), PFE (Pak
  Furniture Expo), and Zahra Home. The first three close in June; the last
  three close in December. Five are events businesses; Zahra Home is furniture
  retail with two showrooms.
- Preserve existing company codes, users, credentials and memberships. Zahra
  Home's existing `ZAHRA-HOME` code remains unchanged; `ZH` is its group
  shorthand, not a seventh company. Initialization recognizes an existing `ZH`
  instead, but refuses to guess if both codes exist.
- Use 1000–1999 assets, 2000–2999 liabilities, 3000–3999 equity,
  4000–4999 income, 5000–5999 direct costs, 6000–6999 operating expenses,
  and 7000–7999 other income/expenses. Shared accounts have aligned numbers.
  The user's explicit retail overrides (such as 4100 showroom sales and 5100
  cost of goods sold) take precedence over event-specific meanings at those codes.
- Groups are non-posting. Cash, bank, inventory-location and group-company
  subaccounts are separate posting accounts. Group-company suffixes are stable:
  1 PLFE, 2 SE, 3 LPE, 4 LEV, 5 PFE, 6 Zahra Home; omit the company's own
  due-from/to child. `3990` is opening-balance equity; `3900` is retained earnings.
- Demo conversion is explicit, Owner-only maintenance, not startup logic.
  Refuse non-TEST-P2 financial documents, journal history and party opening
  balances. Retain original entries and source documents, cancel/reverse
  demo postings using the shared posting services, and retain inactive legacy
  chart rows at zero balance. Do not disable triggers, delete financial history,
  change credentials/memberships, reset counters or unlock dates/periods.
- The old July-based Zahra demo calendar can be corrected only if its postings
  all fit the replacement calendar year, no dates/periods are locked, and there
  is at most one demo year. Preserve the fiscal ID and numbering counters; retain
  old periods as archived configuration, with twelve replacement monthly periods.
  Anything more complex must stop for accountant review, not silently rewrite.
- Party province is optional and nullable: Punjab, Sindh, Khyber Pakhtunkhwa,
  Balochistan, Islamabad Capital Territory. Do not backfill existing parties.
  This does not authorize tax rules, tax calculations, inventory or POS workflows.

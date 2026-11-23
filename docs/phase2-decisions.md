# Approved Phase 2 scope

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
- Seed each company's expo chart from one shared template.
- Complete and commit/push each step: migration; services; screens; both-company
  test seed; accounting tests; module/progress documentation and handover.
- The Phase 2 acceptance remains: twenty mixed posted documents, balanced trial
  balance, correct partially paid invoice outstanding, cancellation by reversal.

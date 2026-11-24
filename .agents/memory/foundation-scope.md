---
name: Approved foundation scope
description: Non-obvious scope and product decisions to retain across phases.
---

The user's approved clarifications override conflicting text in `docs/PLAN.md`.
Read `docs/phase1-decisions.md` and `docs/phase2-decisions.md`. Phase 1 is manually
accepted and complete; Phase 2 Accounts core is authorized, but later phases are not.

**Why:** The user explicitly accepted the foundation and then authorized Accounts
core. They moved VPS deployment to Phase 9, so deployment must no longer block
earlier phases or trigger requests for server details.

**How to apply:** Read the original plan plus the approved corrections before
changing business rules. The latest fresh-start instructions supersede the
earlier preservation/restore request: use this app's own **empty** database;
do not restore or connect any other database, and do not copy Odoo data.
There is no real business data to preserve. Create one initial Owner whose
password the user sets at first login.

**Why:** The user explicitly said to ignore the earlier preservation instruction
and explained that the old workspace contained only TEST-P2 demo documents.

Companies are unlimited data, not a fixed group encoded in application logic.
Use each company's explicit business type (initially events or retail), not its
code, to choose behavior. Intercompany accounts must reference the facing company
and retain their once-allocated numbers, not derive them from list positions.

**Why:** The Owner may run six companies today and sixteen later and must be able
to create another company through the back office.

The user's five-part revision explicitly authorizes data-driven company setup,
tax, payment controls, guided opening/imports, intercompany posting, cash counts
and a guarded development/test demo reset as **Accounts scope**. Implement them
in the supplied order, updating progress and committing/pushing after each part.
This does not authorize other Phase 3 work.

**How to apply:** Follow the latest fresh-start requirements over older phase
limits or assumptions about preserving existing company identities. Use the
agreed Events/Retail charts without hard-coded company-specific behavior.

Do not introduce hosted-platform runtime dependencies: the user's intended home
is their Linux VPS, with both direct npm/Nginx and Docker Compose delivery.
Keep those paths working without requesting VPS details until Phase 9.

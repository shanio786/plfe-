---
name: Approved foundation scope
description: Non-obvious scope and product decisions to retain across phases.
---

The user's approved clarifications in `docs/phase1-decisions.md` override conflicting
text in `docs/PLAN.md`. Keep development phase-by-phase; completing the foundation
does not authorize building Accounts or another later phase.

**Why:** The user explicitly approved only Phase 1 and supplied corrections after
reviewing the proposed schema/screens. Later go-live order and sign-off people are
undecided, not blockers to development.

**How to apply:** Read the original plan plus the approved corrections before
changing business rules. Odoo migration is opening balances only; each company
will have a separate chart seeded from one template when Accounts is authorized.
Do not introduce hosted-platform runtime dependencies: the user's intended home
is their Linux VPS, with both direct npm/Nginx and Docker Compose delivery.

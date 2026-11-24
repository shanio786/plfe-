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
changing business rules. Odoo migration is opening balances only. The authorized
six-company correction replaces the earlier single-chart assumption with
separate Events/Retail templates; see `docs/phase2-decisions.md` for the overrides.
Do not introduce hosted-platform runtime dependencies: the user's intended home
is their Linux VPS, with both direct npm/Nginx and Docker Compose delivery.
Keep those paths working without requesting VPS details until Phase 9.

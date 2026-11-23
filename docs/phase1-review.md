# Phase 1 pre-deployment review

## Scope and status

Reviewed the existing foundation against `PLAN.md` and the approved overrides:
authorization, company separation, approvals, audit consistency, private files,
authentication, dependencies and portable deployment.

This is the in-workspace review and remediation record. It is **not** the
separately requested external Claude Code sign-off, real-data acceptance, or a
claim that the system has been deployed to a VPS.

## Confirmed findings and remediation

| Severity | Finding | Remediation |
| --- | --- | --- |
| High | Editing `active:false` bypassed branch-deactivation approval. Archiving an active branch was another bypass. | The service rejects both paths while an active rule requires independent approval, including for Owner. The approved handler remains the only protected transition. The screen offers Request deactivation and an explicit Activate action, rather than an edit-time disable switch. |
| High | A delegated password-reset operator could take over a stronger company-only administrator. Identity/email edits offered a related takeover path. | User management checks the target's effective company permissions against the operator's own grants. Existing Owner and cross-company identity restrictions remain. Valid resets revoke sessions and require a password change. |
| Medium | App/worker inherited migration and database-owner credentials through the whole host environment file. | Compose now passes an explicit runtime allowlist. A one-shot maintenance profile receives operator credentials. Direct npm operations use a separate, operator-owned `.env.maintenance`, which app/worker do not load and must not be able to read. |
| Medium | Concurrent edits could record stale audit before-images. | Mutable record services lock rows before reading snapshots. Identity writers use consistent Owner-guard/row-lock ordering. Profile writes now use a service; attachment deletion and image references coordinate their locks. |
| Medium | A maintenance image could otherwise remain stale on later deploys. | `deploy.sh` and setup instructions build with the maintenance profile before running migrations. |

No changes to Accounts or any later module were made. Existing business data
was not re-seeded, erased or migrated.

## Dependency findings

The initial audit reported seven High and two Moderate findings across Zod,
PostCSS, Prisma configuration dependencies and ExcelJS's UUID dependency.

- Upgraded the application's shared validation library to patched Zod 4.
- Kept Next.js 15, Prisma 6 and ExcelJS as agreed. Their latest compatible parents
  still selected affected transitive packages, so applied targeted patched
  dependency overrides in both the workspace and standalone app manifests.
- Updated both lockfiles. Verified Prisma generation, production compilation,
  shared schemas, workbook generation and the HTTP authentication flow.
- The follow-up dependency scan reported **zero** Critical, High, Moderate,
  Low or informational findings.

Static analysis reports one High-labelled bcrypt-literal match in the unknown-user
login timing fallback. It is a dummy comparison hash, not an account credential:
it is used only when no user exists, and that branch cannot authenticate anyone.
This was manually triaged as a false positive, not suppressed or represented as
a real credential leak. The privacy/dataflow scan reported no findings.

Scanner results are point-in-time evidence, not a guarantee against future issues.

## Verification performed

- Production `npm run build`, Prisma client generation and TypeScript checks passed.
- **23 automated checks passed** in the isolated `_test` database, including new
  approval-bypass, delegated-account ceiling, concurrent-audit and environment
  allowlist regressions, plus real XLSX output.
- The HTTP check starts the production app against that test database and checks
  CSRF rejection, cookie security flags, forced password change, company denial,
  profile persistence, reset/session revocation and logout. It uses synthetic
  credentials held only in memory and never prints tokens/passwords.
- Fixture setup itself rejects non-`_test` databases before writing any records.
- Shell syntax and secret-file ignore rules were checked.
- Production app and worker were restarted after the code/package changes.

## Still required before production use

1. Review the Phase 1 screens and perform the documented manual/real-data checks.
2. Obtain the separately requested external Claude Code review and resolve its findings.
3. Supply/configure the VPS and domain; exercise Compose, HTTPS, limited database
   roles, private uploads and backups on that server.
4. Run the Phase 1 VPS acceptance checklist and record the responsible sign-off.

Docker containers were not launched here. Runtime environment allowlisting was
checked from the deployment definition, not by inspecting a real VPS container.

# Approved Phase 1 decisions

These decisions were explicitly approved after review of the proposed schema and
screens. They supersede conflicting passages in the original plan.

- Opaque database-backed sessions; Auth.js may be omitted. Use bcrypt for
  passwords, SHA-256 hashes for random session tokens. Raw session tokens live
  only in httpOnly, Secure, SameSite=Lax cookies. No JWT-only sessions.
- Global users, sessions and permission catalogue; company-root records have
  no self-referencing company column. Business records are company-owned.
  Company-null audit records are only authentication/system events.
- Users have a global `is_owner` flag. Owners automatically see new companies.
  Only an Owner may change ownership; the last active Owner cannot be removed.
- Roles are company-specific copies of one code template. Seed all eleven roles
  from the detailed role table. Several roles per user/company combine grants.
  The company role named Owner does not itself confer global ownership.
- Active-only partial unique business indexes use `deleted_at IS NULL`.
  Role-permission and user-company-role links are hard-deleted with audited
  history. Identity/foreign-key UUIDs remain unique even for archived rows.
- `.env` contains deployment/security settings, not editable business settings.
- Password defaults: 10 characters, one letter and one number; lock for 15 minutes
  after 5 failures; session idle timeout 4 hours; maximum session length 14 hours.
  These defaults are configurable through environment variables.
- One independent approver; never self-approval. Requesters may withdraw a
  pending request. Payment approval default PKR 500,000 per company.
- Seed test companies PLFE and ZAHRA HOME. Real go-live order and sign-off people
  remain undecided and do not block development.
- Independent company charts seeded from one template arrive in Phase 2.
  Odoo migration is opening balances only and is outside Phase 1.
- Biometric machine and websites will be decided before their relevant phases.
- Deliver direct npm/Nginx operation and Dockerfile/Compose with app, worker,
  PostgreSQL 16 and Nginx in Phase 1.
- No hosted-platform-specific authentication, database, storage or business runtime.

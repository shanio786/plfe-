# Backup and restore requirements

The deployment uses ordinary PostgreSQL 16 and a private uploads directory.
No hosted-platform backup service is required.

Before live business data is entered:

- Back up the PostgreSQL database and uploads together. Record the matching
  application version/migration state with each backup.
- Store 14 daily and 8 weekly copies on the VPS and a separate off-server copy.
- Encrypt off-server copies and restrict database dumps, uploads and `.env` to
  authorized operators. Never commit any of these files.
- Schedule backups on the VPS during the go-live phase; Phase 1's worker currently
  performs session cleanup only. Do not assume that running the worker backs up
  the database.
- Test a restore at least monthly onto an isolated PostgreSQL 16 server, restore
  the matching uploads, apply the proper runtime grants, and verify company
  isolation, document/attachment access and audit history.
- In Compose, never use `docker compose down -v` on a live installation: it
  removes the database and uploads volumes.

For a manual PostgreSQL backup, use the standard PostgreSQL 16 `pg_dump` tool with
custom format and a private `.pgpass` or operator-managed environment. For a
restore use `pg_restore` against a newly created isolated database. On Compose,
run these tools through the `postgres` service and export/import the named uploads
volume separately. Do not place raw connection strings or passwords in shell
history.

Restore acceptance: start the same application version against the restored
database, log in, select both companies as Owner, repeat the company-isolation
test as a single-company user, open audit records and download an attachment.
Record the restore date, duration, backup ID and operator sign-off.

The first production deployment and restore exercise require the actual VPS.
Neither was claimed completed during local implementation.

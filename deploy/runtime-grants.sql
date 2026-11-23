-- Run as the migration/database owner, substituting your pre-created runtime
-- role name if not plfe_app. Create its password securely outside source control.
GRANT CONNECT ON DATABASE plfe TO plfe_app;
GRANT USAGE ON SCHEMA public TO plfe_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO plfe_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM plfe_app;
REVOKE ALL ON _prisma_migrations FROM plfe_app;
-- Reapply these grants after each deployment migration.

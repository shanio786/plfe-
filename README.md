# PLFE Business System — Phase 2 Accounts

Portable Next.js 15 / TypeScript / PostgreSQL 16 / Prisma foundation.
No platform-specific runtime, authentication or storage.

Six independently scoped group companies use the agreed Events/Retail charts and
June/December financial years. Existing company codes and identities are retained.
Phase 3 is not authorized. See [Phase 2 decisions](docs/phase2-decisions.md) and
[Accounts initialization/correction](docs/phase2-acceptance.md) before changing or
re-seeding any accounting data.

```sh
cp .env.example .env
# Configure database URLs, HTTPS origin, upload directory and first Owner.
npm install
npm run build
npm run db:migrate
# Apply limited runtime DB grants as described in docs/setup.md.
npm run db:seed
npm start
# In a separate process:
npm run worker
```

HTTPS is required for session cookies. The application is in `artifacts/plfe/`;
root npm commands delegate to that standalone package. It can also be installed
and run directly from that folder with no other workspace packages.

- [Full plan](docs/PLAN.md)
- [Approved Phase 1 decisions](docs/phase1-decisions.md)
- [Setup and exact Phase 1 acceptance test](docs/setup.md)
- [Implemented modules and boundaries](docs/modules.md)
- [Backup and restore requirements](docs/backup.md)

Set a dedicated `TEST_DATABASE_URL` ending in `_test`, then run
`npm run test:phase1`. Never point tests at production.

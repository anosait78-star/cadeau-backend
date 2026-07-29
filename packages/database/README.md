# @cadeau/database

Database infrastructure: the Prisma client, migrations, the multi-tenant **RLS
tenant context**, transaction and health helpers, and an idempotent seed
framework. Every data-owning epic builds on this package.

Prisma is pinned to **6.x** as a deliberate stability/compatibility decision — see
[docs/upgrade-paths.md](../../docs/upgrade-paths.md). The full workflow (local
Docker Postgres, migration/seed/rollback strategy) is in
[docs/database.md](../../docs/database.md); rollback runbook in
[docs/runbooks/rollback.md](../../docs/runbooks/rollback.md).

EPIC-3 adds the **security/data-layer foundation**: two-layer tenant isolation
(repository scoping + Postgres RLS), keyset pagination, the reusable
`app.touch_updated_at()` trigger, and the append-only `audit_log`. See
[docs/core-data.md](../../docs/core-data.md).

> **Scope:** foundation + security only — no tenant tables (companies/members —
> EPIC-4) or domain tables (EPIC-7+); each is owned by its epic (Roadmap).

## Usage

```ts
import { getPrismaClient, withTenantTransaction, checkDatabaseHealth } from "@cadeau/database";

// All tenant-scoped work runs inside a transaction that sets app.company_id (RLS).
await withTenantTransaction(companyId, async (tx) => {
  /* ... */
});
```

## Scripts

```bash
docker compose up -d db                               # local Postgres
pnpm --filter @cadeau/database db:migrate:deploy       # apply migrations
pnpm --filter @cadeau/database db:seed                 # system seed (idempotent)
pnpm --filter @cadeau/database test                    # Vitest + coverage
```

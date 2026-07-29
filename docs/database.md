# Database Infrastructure (M1.4)

The `@cadeau/database` package is the foundation every data-owning epic builds on:
a local PostgreSQL via Docker, Prisma (client + migrations), the multi-tenant RLS
context, transaction and health helpers, and an idempotent seed framework.

> **Scope of M1.4:** infrastructure only. There are **no domain tables and no
> reference data** yet — every reference table (currencies, feature catalog,
> permission templates, …) is owned by its dedicated epic per the Implementation
> Roadmap and is added there, never front-run here.

## Stack

| Concern      | Choice                                                              |
| ------------ | ------------------------------------------------------------------- |
| Database     | PostgreSQL 17 (Alpine), pinned by digest (ADR-001)                  |
| Local dev DB | Docker Compose + a named volume (`cadeau-db-data`)                  |
| ORM          | Prisma `6.19.3` (`prisma-client-js`), stable-only (ADR-001)         |
| Migrations   | Prisma Migrate, forward-only in staging/prod                        |
| Config       | Connection details come from `@cadeau/config` (never `process.env`) |

## Local development

Prerequisite: Docker Desktop (Compose v2).

```bash
docker compose up -d db                       # start Postgres (data persists in the volume)
cp .env.development.example .env.development   # DATABASE_URL already points at the container
pnpm --filter @cadeau/database db:migrate:deploy   # apply migrations
pnpm --filter @cadeau/database db:seed             # system seed (idempotent; no data at M1.4)
```

Stop the database with `docker compose down` (data is kept) or `docker compose down -v`
(data is destroyed — the volume is removed).

## Package scripts (`@cadeau/database`)

| Script              | Purpose                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `db:generate`       | Generate the Prisma client.                                        |
| `db:migrate:dev`    | Create + apply a migration in **local development only**.          |
| `db:migrate:deploy` | Apply pending migrations forward-only (staging/prod, CI).          |
| `db:migrate:status` | Show applied/pending migrations.                                   |
| `db:seed`           | Run the **system** seed (idempotent; safe on every deploy).        |
| `db:seed:dev`       | Run the **dev** seed (sample data; refuses to run in production).  |
| `db:reset`          | Drop, re-create, re-migrate, re-seed — **local development only**. |

## Migrations

- **Prisma Migrate is the single source of truth** for schema change; migration SQL
  is committed and reviewed under `packages/database/prisma/migrations/`.
- **Forward-only in staging/production** via `prisma migrate deploy`. `migrate dev`
  is for local development only.
- **Expand → Migrate → Contract** for zero-downtime change: add the new shape
  (nullable column / new table) in one migration, backfill and switch reads/writes,
  then remove the old shape in a **later** migration — never rewrite history.
- Infrastructure objects Prisma does not model (extensions, functions, the `app`
  schema) are managed by hand-written SQL inside a migration.

The first migration (`20260728000000_init_infrastructure`) enables the `pgcrypto` and
`citext` extensions and installs the RLS context (below). It creates no tables.

## Multi-tenant RLS context

Tenant isolation is enforced in two layers (ADR-001 / Roadmap §1):

1. **Application layer:** the BFF binds the active tenant per transaction.
2. **Database layer:** PostgreSQL Row-Level Security policies (added in EPIC-3)
   read that binding.

The binding is a transaction-local GUC, `app.company_id`, set through
`set_config('app.company_id', $companyId, true)` (the `true` = `SET LOCAL`, so it
cannot leak across pooled connections). The migration installs the primitive every
future policy uses:

```sql
app.current_company_id()  -- returns the current tenant uuid, or NULL when unset
```

In application code, always go through the helper so the context is set correctly:

```ts
import { getPrismaClient, withTenantTransaction } from "@cadeau/database";

const db = getPrismaClient();
await withTenantTransaction(db, companyId, async (tx) => {
  // Every statement here runs with app.company_id bound → RLS applies.
});
```

`withTenantTransaction` validates that `companyId` is a UUID before it reaches the
database (defence in depth), and the value is always a **bound parameter** — never
string-interpolated into SQL.

## Health & connection

`checkDatabaseHealth(client)` runs `SELECT 1` and returns `{ status, latencyMs, error? }`
without throwing — the BFF health endpoint (M1.5) surfaces it directly. The client is a
process-wide singleton (`getPrismaClient()` / `disconnectPrisma()`) configured from
`@cadeau/config` (`database.url`, log level).

## Seed framework

Two idempotent seed sets share one atomic engine (`runSeeders`):

- **System seed** (`runSystemSeed`) — deterministic reference data that ships with the
  product and runs in **every** environment including production. Safe on every deploy.
- **Dev seed** (`runDevSeed`) — throwaway sample data for local dev and tests; **refuses
  to run when `NODE_ENV=production`**.

Both seeder registries are **empty at M1.4** by design. A seeder is any object with a
`name` and an idempotent `run(tx)` (upsert semantics); domain epics register theirs.
Because each seeder is idempotent and the whole run is one transaction, re-running a
seed is a no-op (`totalChanged: 0`) and a failure rolls the entire run back.

## Rollback

See the [Rollback Runbook](runbooks/rollback.md).

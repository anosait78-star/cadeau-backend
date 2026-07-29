# Cadeau CRM

Secure, multi-tenant CRM/OMS + light ERP for COD social-commerce merchants.

Built strictly against the project's Single Source of Truth: `Cadeau_CRM_Master_Product_Plan.md`,
`Cadeau_CRM_Engineering_Standards.md`, the `00–22` knowledge base, and the four binding ADRs
(Security First · Dual UX · Three-Layer Access · AI-Out/Extensible).

## Tech stack (locked)

- **Frontend:** React + Vite + shadcn/Radix + Tailwind (TypeScript strict)
- **BFF:** NestJS (Node LTS) · REST + OpenAPI (`/v1`)
- **Data:** PostgreSQL + Prisma ORM (self-hosted — no external auth/permission service)
- **Auth:** self-built JWT + 2FA
- **Tooling:** pnpm · Turborepo · Vitest · Playwright

## Repository layout

```
apps/web            React + Vite SPA — shared frontend foundation (docs/frontend-foundation.md)
apps/api            NestJS BFF — REST + OpenAPI /v1 (docs/backend-foundation.md)
packages/config     Validated, typed environment configuration (docs/configuration.md)
packages/database   Prisma client, migrations, RLS context, seeds, health (docs/database.md)
```

Cross-cutting references: [API conventions](docs/api-conventions.md) ·
[API contracts](docs/api/README.md) · [architecture tests](docs/architecture-tests.md) ·
[ADRs](docs/adr/README.md) · **[execution plan / continuation guide](docs/execution-plan.md)**.

## Prerequisites

- Node `24.x` (see `.nvmrc`)
- pnpm `10.x` (`corepack use pnpm@10.15.0`)
- Docker Desktop (Compose v2) — for the local PostgreSQL database

## Getting started

```bash
pnpm install       # install workspace dependencies
pnpm lint          # ESLint across the workspace
pnpm type-check    # strict TypeScript checks
pnpm test          # unit + integration tests
pnpm build         # build all packages
pnpm arch:check    # architecture tests (boundaries · layers · cycles)
pnpm perf:bundle   # bundle-size budget (≤200KB gzip, §2.4) — after building web
```

## Database (local)

```bash
docker compose up -d db                             # start PostgreSQL (persists in a volume)
cp .env.development.example .env.development         # DATABASE_URL points at the container
pnpm --filter @cadeau/database db:migrate:deploy     # apply migrations
pnpm --filter @cadeau/database db:seed               # system seed (idempotent)
```

See [docs/database.md](docs/database.md) for the full workflow and
[docs/runbooks/rollback.md](docs/runbooks/rollback.md) for rollback procedures.

## Contribution rules

- Protected `main`; every change via PR with green CI (incl. security & performance gates).
- Conventional Commits (`feat: …`, `fix: …`, …) — enforced by commitlint.
- No secrets in the repository (enforced by secret scanning).

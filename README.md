# Cadeau Backend

Standalone snapshot of the Cadeau CRM backend, extracted from the main `cadeau-crm` monorepo.

## Contents

- `apps/api` — NestJS API (`@cadeau/api`)
- `packages/config` — validated, typed environment configuration
- `packages/crypto` — password hashing, PII encryption, JWT
- `packages/database` — Prisma client, migrations, RLS tenant context

## Setup

```bash
pnpm install
cp .env.development.example .env.development
pnpm --filter @cadeau/database db:generate
pnpm --filter @cadeau/api dev
```

## Notes

This repo was extracted as a snapshot (no shared git history with the monorepo). Secrets and `.env*` files were not copied — only `.env*.example` templates.

# @cadeau/api

The Cadeau CRM BFF/API — a NestJS application (REST + OpenAPI under `/v1`).

M1.5 establishes the foundation: modular layered structure, configuration via
`@cadeau/config`, structured JSON logging with request correlation, global
validation, a unified error envelope, health checks, and OpenAPI.

See **[docs/backend-foundation.md](../../docs/backend-foundation.md)** for the
full reference (structure, endpoints, error contract, logging, testing).

## Quick start

```bash
pnpm --filter @cadeau/api dev     # watch-mode dev server
pnpm --filter @cadeau/api test    # unit + e2e tests
```

`GET /v1/health` (liveness), `GET /v1/health/ready` (readiness),
`GET /v1/docs` (Swagger UI), `GET /v1/openapi.json` (raw spec).

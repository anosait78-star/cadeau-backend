# Backend Foundation (M1.5)

`@cadeau/api` is the NestJS BFF — the single, server-enforced entry point for the
whole product. M1.5 establishes its foundation: modular structure, configuration,
structured logging, validation, a unified error contract, health checks, and
OpenAPI. No domain endpoints yet — those arrive with their epics.

> **Governed by** ADR-001 (Security First) · ADR-003 (server-side access) ·
> ADR-004 (modular / extensible core). See [architecture-tests.md](architecture-tests.md)
> for the boundaries the CI enforces on this code.

## Stack

| Concern     | Choice                                                             |
| ----------- | ------------------------------------------------------------------ |
| Framework   | NestJS 11 (Express 5 platform), TypeScript `strict`                |
| API style   | REST + OpenAPI under the `/v1` prefix                              |
| Config      | `@cadeau/config` only — never `process.env` (validated at startup) |
| Logging     | Self-built structured JSON logger + async request context          |
| Validation  | Global `ValidationPipe` (whitelist + transform)                    |
| Errors      | One global filter → one error envelope                             |
| Build / dev | `nest build` · `nest start --watch` · tests via Vitest + SWC       |

## Module structure (layered)

Every feature is a vertical slice with an inward-only dependency direction. The
architecture tests fail the build on any violation.

```
apps/api/src/
  main.ts                     bootstrap (composition root)
  app.module.ts               root wiring
  shared/                     cross-cutting: config, logging, http, errors, openapi
  modules/<feature>/
    domain/                   pure: entities, value objects, ports (interfaces)
    application/              use-cases/services orchestrating the domain via ports
    infrastructure/           adapters (e.g. Prisma) — the ONLY place data access lives
    presentation/             controllers + DTOs (HTTP)
    <feature>.module.ts       composition root for the feature
```

`presentation → application → domain ← infrastructure`. The domain depends on
nothing outward; `@cadeau/database` may be imported only from `infrastructure/`.

## Endpoints

| Method & path          | Purpose                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `GET /v1/health`       | **Liveness** — process is up. No dependencies checked. Always 200.                            |
| `GET /v1/health/ready` | **Readiness** — aggregates dependency probes (database). 200 with `status` = `ok`/`degraded`. |
| `GET /v1/docs`         | Swagger UI.                                                                                   |
| `GET /v1/openapi.json` | Raw OpenAPI 3 document.                                                                       |

Readiness reports `degraded` (not an HTTP error) when the database probe is down,
so orchestrators key off the `status` field. The probe never throws.

## Unified error envelope

Every error — thrown `AppException`, built-in Nest exception, validation failure,
or unexpected crash — is rendered by the global filter into exactly one shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "statusCode": 400,
    "requestId": "7260f4f1-…",
    "timestamp": "2026-07-28T08:10:17.244Z",
    "path": "/v1/…",
    "details": [{ "field": "email", "messages": ["email must be an email"] }]
  }
}
```

- `code` is a **stable, machine-readable** [`ErrorCode`](../apps/api/src/shared/errors/error-codes.ts);
  clients switch on it, not on the HTTP status or the human message.
- Unexpected errors collapse to a generic `500 / INTERNAL` — the real error is
  **logged, never returned** (no internal leakage, ADR-001).
- Raise intentional errors with [`AppErrors`](../apps/api/src/shared/errors/app-exception.ts)
  (`AppErrors.notFound()`, `AppErrors.conflict()`, …).

## Logging & correlation

- Structured **JSON lines** to stdout (stderr for error/fatal), filtered by
  `LOG_LEVEL` from config.
- Every request gets a correlation id (honouring a safe inbound `x-request-id`,
  else generated), echoed on the response header and attached to **every** log
  line for that request via `AsyncLocalStorage` — no id threading through calls.
- One access-log line per request: `GET /v1/health 200 3ms`.

## Configuration

All configuration is read through `@cadeau/config` and **validated at startup** —
the process fails fast on an invalid environment. In `production`, `APP_URL` must
be `https` and `DATABASE_SSL` must be `true` (ADR-001); use `development`/`test`
for local `http`. See [configuration.md](configuration.md) and the `.env.*.example`
files for the full variable set.

## Commands

```bash
pnpm --filter @cadeau/api dev          # watch-mode dev server (nest start --watch)
pnpm --filter @cadeau/api build        # nest build → dist/
pnpm --filter @cadeau/api start        # run the built server (node dist/main.js)
pnpm --filter @cadeau/api type-check   # tsc --noEmit
pnpm --filter @cadeau/api test         # Vitest (unit + e2e) with coverage
```

## Testing

Unit tests cover the logger, request context, exception filter, error mapping,
validation flattening, and the health service/adapter. An **e2e** test boots the
real application (database faked) and asserts the acceptance criteria: `GET
/v1/health`, the unified 404 envelope, and the generated OpenAPI document.

NestJS relies on `emitDecoratorMetadata`, which Vitest's default (esbuild/oxc)
transformer does not emit; tests are transformed with **SWC** (`unplugin-swc`) so
dependency injection behaves under test exactly as at runtime. For the same
reason, `@typescript-eslint/consistent-type-imports` is disabled for `apps/api`
(a `type`-only import of an injected class would silently break DI).

# @cadeau/config

The single source of truth for **validated, typed environment configuration**.
Every app and package reads configuration through this package — never
`process.env` directly (enforced by ESLint).

Configuration is loaded once, validated against a schema at startup, and exposed
as a typed, read-only `AppConfig`. Invalid environments fail fast with a clear,
aggregated error. In `production`, stricter rules apply (e.g. `APP_URL` must be
`https`, `DATABASE_SSL` must be `true`) per ADR-001.

See **[docs/configuration.md](../../docs/configuration.md)** for the full variable
reference and the `.env.*.example` files for per-environment templates.

## Usage

```ts
import { getConfig } from "@cadeau/config";

const config = getConfig(); // validated, cached singleton
config.http.port; // typed access; no process.env anywhere else
```

## Scripts

```bash
pnpm --filter @cadeau/config type-check
pnpm --filter @cadeau/config test        # Vitest + coverage
```

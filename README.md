# @cadeau/web

The Cadeau CRM web app — React 19 + Vite 8 (TypeScript strict), Tailwind CSS v4,
and `react-router`. M1.6 established the **shared** frontend foundation: design
tokens, theme (light/dark), text direction (RTL/LTR), i18n scaffolding, a single
base layout, and standard Empty/Loading/Error states.

See **[docs/frontend-foundation.md](../../docs/frontend-foundation.md)** for the
full reference.

## Quick start

```bash
pnpm --filter @cadeau/web dev        # Vite dev server (http://localhost:5173)
pnpm --filter @cadeau/web build      # production build → dist/
pnpm --filter @cadeau/web test       # Vitest + Testing Library (unit/integration)
pnpm --filter @cadeau/web test:e2e   # Playwright smoke (builds + previews)
```

## Performance budget (Roadmap §2.4)

- Initial JS ≤ **200 KB gzip** — enforced by `pnpm perf:bundle` in CI.
- Lighthouse Performance ≥ **90** — enforced by Lighthouse CI.

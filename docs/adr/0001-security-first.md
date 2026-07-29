# ADR-0001: Security First

- **Status:** Accepted (binding)
- **Date:** 2026-07-26
- **Deciders:** Product owner
- **Supersedes / Superseded by:** —

## Context

Cadeau CRM is a multi-tenant system holding merchants' customer PII, orders, and
financial data. Security must not be traded away for delivery speed, and
supply-chain risk is a first-class threat.

## Decision

Security takes precedence over development speed. Concretely:

- **Stable releases only** — no Beta/Alpha/RC in the dependency tree; enforced by
  `scripts/check-stable-only.mjs`.
- **No component with an unresolved Critical/High advisory** — enforced by
  `pnpm audit --audit-level high` in CI; investigate CVEs / GH advisories / OWASP.
- **Secrets only in the environment** (never in code), read through `@cadeau/config`.
- Defense in depth: CSP, rate limiting, input validation, CSRF/XSS/SQLi protection.
- A dependency audit before every release and a security checklist before deploy.
- **Supply-chain hardening:** GitHub Actions pinned by commit SHA, containers by digest.

## Consequences

- **Positive:** predictable, auditable dependency surface; failures caught in CI, not prod.
- **Negative / trade-offs:** we sometimes lag the newest major (documented pins, e.g.
  Prisma 6 — [upgrade-paths.md](../upgrade-paths.md)); more upfront gate work.
- **Follow-ups:** CI gates for stable-only, SCA, secret scanning, SAST; error responses
  must never leak internals ([backend-foundation.md](../backend-foundation.md)).

## Alternatives considered

- **"Move fast", patch later** — rejected: unacceptable for PII/financial multi-tenant data.
- **Allow pre-release for newer features** — rejected: pre-release channels are unstable
  and widen the advisory surface.

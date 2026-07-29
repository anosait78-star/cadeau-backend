# Dependency Security Decisions

Traceable record of dependency-level security decisions (Engineering Standards §2.5, ADR-001).
Every entry documents a real advisory, the authoritative source, and the applied fix.

## 2026-07-28 — brace-expansion DoS (HIGH) — GHSA-mh99-v99m-4gvg

- **Advisory:** brace-expansion — DoS via unbounded expansion length (OOM crash).
- **Authoritative range (GitHub Advisory API):** vulnerable `<= 5.0.7`, first patched `5.0.8`.
- **How it entered:** transitive via `minimatch` (used by ESLint and typescript-eslint).
- **Investigation:** the maintenance lines `1.1.16` / `2.1.2` are **also** in the vulnerable
  range (`<= 5.0.7`); only `5.0.8` fixes it. `brace-expansion@5` changed its CommonJS export
  from a default function to a named `expand`, which is incompatible with `minimatch@3`/`9`.
  Only `minimatch@10.2.6` (which depends on `brace-expansion@^5.0.8` and uses the named export)
  is compatible.
- **Fix applied:**
  - Upgraded ESLint stack to latest stable: `eslint@10.8.0`, `@eslint/js@10.0.1`,
    `typescript-eslint@8.65.0`, `eslint-config-prettier@10.1.8` (removes legacy `minimatch@3.1.5`).
  - pnpm overrides forcing the whole tree onto patched versions:
    `minimatch@<10.2.6 -> >=10.2.6`, `brace-expansion@<5.0.8 -> >=5.0.8`.
- **Verification:** `pnpm audit --audit-level high` → 0 Critical / 0 High; ESLint runs cleanly.

## 2026-07-28 — turbo (MODERATE + LOW) + yaml (MODERATE)

- **turbo** — login callback CSRF/session fixation (MODERATE) + local code execution during
  Yarn Berry detection (LOW); patched `>= 2.9.14`. **Fix:** upgraded `turbo@2.10.7`.
- **yaml** (via `lint-staged`) — Stack Overflow via deeply nested collections (MODERATE);
  patched `>= 2.8.3`. **Fix:** pnpm override `yaml@<2.8.3 -> >=2.8.3`.
- **Verification:** `pnpm audit --audit-level moderate` → No known vulnerabilities found.

> Overrides are re-evaluated whenever the upstream packages adopt patched transitives natively,
> at which point the corresponding override is removed.

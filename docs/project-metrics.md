# Project Metrics — Cadeau CRM

A one-glance dashboard of project state. **Update at the end of every epic** (part
of the §2.5 quality gate). Last updated: **end of EPIC-10** — 2026-07-31.

| Metric                    | Current                           |
| ------------------------- | --------------------------------- |
| Feature modules (NestJS)  | 8                                 |
| Workspace packages / apps | 3 packages + 2 apps               |
| Total API endpoints       | 58                                |
| Total database tables     | 35                                |
| Total tests               | 795                               |
| Overall coverage          | ≥90% (per-package, gate-enforced) |
| Bundle size (web, gzip)   | 153.3 KB / 200 KB                 |
| Prisma migrations         | 9                                 |
| ADRs                      | 4                                 |
| API contracts             | 8 delivered / 13 total            |
| Closed epics              | 10 / 16 (EPIC-1–10)               |
| Open epics                | 6 (EPIC-11–16)                    |

**Notes.** Feature modules = `access`, `auth`, `customers`, `health`, `inventory`,
`master-data`, `products`, `tenancy`. Formal §2.5 quality gates on record: EPIC-5
([epic-5-quality-gate.md](epic-5-quality-gate.md)), EPIC-6
([epic-6-quality-gate.md](epic-6-quality-gate.md)), EPIC-8
([epic-8-quality-gate.md](epic-8-quality-gate.md)), EPIC-9
([epic-9-quality-gate.md](epic-9-quality-gate.md)), EPIC-10
([epic-10-quality-gate.md](epic-10-quality-gate.md)) — EPIC-3 is foundation-only,
and **EPIC-7 has no formal gate doc** (closure was recorded in the contract + plan).
Tests by package: config 40 · web 111 · crypto 35 · database 71 · api 538.
Architecture: 434 modules, 1048 dependencies, 0 violations. See
[execution-plan.md](execution-plan.md) §0 for live state and
[domain-map.md](domain-map.md) for how the delivered modules fit together.

## History

| At end of | Endpoints | Tables | Tests | Bundle       |
| --------- | --------- | ------ | ----- | ------------ |
| EPIC-5    | 24        | 18     | 382   | 141.8 KB     |
| EPIC-6    | 24        | 18     | 391   | 141.8 KB     |
| EPIC-7    | 30        | 26     | 476   | not recorded |
| EPIC-8    | 38        | 28     | 552   | 146.8 KB     |
| EPIC-9    | 49        | 33     | 668   | 150.2 KB     |
| EPIC-10   | 58        | 35     | 795   | 153.3 KB     |

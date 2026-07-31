# Project Metrics — Cadeau CRM

A one-glance dashboard of project state. **Update at the end of every epic** (part
of the §2.5 quality gate). Last updated: **end of EPIC-9** — 2026-07-31.

| Metric                    | Current                           |
| ------------------------- | --------------------------------- |
| Feature modules (NestJS)  | 7                                 |
| Workspace packages / apps | 3 packages + 2 apps               |
| Total API endpoints       | 49                                |
| Total database tables     | 33                                |
| Total tests               | 668                               |
| Overall coverage          | ≥90% (per-package, gate-enforced) |
| Bundle size (web, gzip)   | 150.2 KB / 200 KB                 |
| Prisma migrations         | 8                                 |
| ADRs                      | 4                                 |
| API contracts             | 7 delivered / 13 total            |
| Closed epics              | 9 / 16 (EPIC-1–9)                 |
| Open epics                | 7 (EPIC-10–16)                    |

**Notes.** Feature modules = `access`, `auth`, `health`, `inventory`,
`master-data`, `products`, `tenancy`. Formal §2.5 quality gates on record: EPIC-5
([epic-5-quality-gate.md](epic-5-quality-gate.md)), EPIC-6
([epic-6-quality-gate.md](epic-6-quality-gate.md)), EPIC-8
([epic-8-quality-gate.md](epic-8-quality-gate.md)), EPIC-9
([epic-9-quality-gate.md](epic-9-quality-gate.md)) — EPIC-3 is foundation-only, and
**EPIC-7 has no formal gate doc** (closure was recorded in the contract + plan).
Tests by package: config 37 · web 100 · crypto 25 · database 71 · api 435.
Architecture: 408 modules, 965 dependencies, 0 violations. See
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

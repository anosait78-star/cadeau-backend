# Project Metrics — Cadeau CRM

A one-glance dashboard of project state. **Update at the end of every epic** (part
of the §2.5 quality gate). Last updated: **end of EPIC-13** — 2026-08-01.

| Metric                    | Current                           |
| ------------------------- | --------------------------------- |
| Feature modules (NestJS)  | 11                                |
| Workspace packages / apps | 3 packages + 2 apps               |
| Total API endpoints       | 110                               |
| Total database tables     | 57                                |
| Total tests               | 1405                              |
| Overall coverage          | ≥90% (per-package, gate-enforced) |
| Bundle size (web, gzip)   | 167.6 KB / 200 KB                 |
| Prisma migrations         | 13                                |
| ADRs                      | 4                                 |
| API contracts             | 11 delivered / 13 total           |
| Closed epics              | 13 / 16 (EPIC-1–13)               |
| Open epics                | 3 (EPIC-14–16)                    |

**Notes.** Feature modules = `access`, `auth`, `customers`, `finance`,
`health`, `inventory`, `master-data`, `orders`, `products`, `shipping`,
`tenancy`. Formal §2.5 quality gates on record: EPIC-5
([epic-5-quality-gate.md](epic-5-quality-gate.md)), EPIC-6
([epic-6-quality-gate.md](epic-6-quality-gate.md)), EPIC-8
([epic-8-quality-gate.md](epic-8-quality-gate.md)), EPIC-9
([epic-9-quality-gate.md](epic-9-quality-gate.md)), EPIC-10
([epic-10-quality-gate.md](epic-10-quality-gate.md)), EPIC-11
([epic-11-quality-gate.md](epic-11-quality-gate.md)), EPIC-12
([epic-12-quality-gate.md](epic-12-quality-gate.md)), EPIC-13
([epic-13-quality-gate.md](epic-13-quality-gate.md)) — EPIC-3 is
foundation-only, and **EPIC-7 has no formal gate doc** (closure was recorded in
the contract + plan). Tests by package: config 43 · crypto 47 · database 71 ·
web 160 · api 1084. Architecture: 556 modules, 1538 dependencies, 0
violations. See [execution-plan.md](execution-plan.md) §0 for live state and
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
| EPIC-11   | 72        | 39     | 925   | 162.5 KB     |
| EPIC-12   | 80        | 41     | 1058  | 163.56 KB    |
| EPIC-13   | 110       | 57     | 1405  | 167.6 KB     |

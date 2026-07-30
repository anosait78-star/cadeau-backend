# Project Metrics — Cadeau CRM

A one-glance dashboard of project state. **Update at the end of every epic** (part
of the §2.5 quality gate). Last updated: **end of EPIC-5** — 2026-07-30.

| Metric                    | Current                           |
| ------------------------- | --------------------------------- |
| Feature modules (NestJS)  | 4                                 |
| Workspace packages / apps | 3 packages + 2 apps               |
| Total API endpoints       | 24                                |
| Total database tables     | 18                                |
| Total tests               | 382                               |
| Overall coverage          | ≥90% (per-package, gate-enforced) |
| Bundle size (web, gzip)   | 141.8 KB / 200 KB                 |
| ADRs                      | 4                                 |
| API contracts             | 13                                |
| Closed epics              | 5 / 16 (EPIC-1–5)                 |
| Open epics                | 11 (EPIC-6–16)                    |

**Notes.** Feature modules = `access`, `auth`, `health`, `tenancy`. Formal §2.5
quality gate on record: EPIC-5 ([epic-5-quality-gate.md](epic-5-quality-gate.md)) —
EPIC-3 is foundation-only. Tests by package: config 37 · web 74 · crypto 25 ·
database 67 · api 179. See [execution-plan.md](execution-plan.md) §0 for live state.

## History

| At end of | Endpoints | Tables | Tests | Bundle   |
| --------- | --------- | ------ | ----- | -------- |
| EPIC-5    | 24        | 18     | 382   | 141.8 KB |

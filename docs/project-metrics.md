# Project Metrics — Cadeau CRM

A one-glance dashboard of project state. **Update at the end of every epic** (part
of the §2.5 quality gate). Last updated: **end of EPIC-6** — 2026-07-30.

| Metric                    | Current                           |
| ------------------------- | --------------------------------- |
| Feature modules (NestJS)  | 4                                 |
| Workspace packages / apps | 3 packages + 2 apps               |
| Total API endpoints       | 24                                |
| Total database tables     | 18                                |
| Total tests               | 391                               |
| Overall coverage          | ≥90% (per-package, gate-enforced) |
| Bundle size (web, gzip)   | 141.8 KB / 200 KB                 |
| ADRs                      | 4                                 |
| API contracts             | 13                                |
| Closed epics              | 6 / 16 (EPIC-1–6)                 |
| Open epics                | 10 (EPIC-7–16)                    |

**Notes.** Feature modules = `access`, `auth`, `health`, `tenancy`. Formal §2.5
quality gates on record: EPIC-5 ([epic-5-quality-gate.md](epic-5-quality-gate.md)),
EPIC-6 ([epic-6-quality-gate.md](epic-6-quality-gate.md)) — EPIC-3 is
foundation-only. EPIC-6 (event bus) is backend-only: no new endpoint, table, or
migration; the in-process bus and the `no-ai-imports` guard are internal. Tests by
package: config 37 · web 74 · crypto 25 · database 67 · api 188. See
[execution-plan.md](execution-plan.md) §0 for live state.

## History

| At end of | Endpoints | Tables | Tests | Bundle   |
| --------- | --------- | ------ | ----- | -------- |
| EPIC-5    | 24        | 18     | 382   | 141.8 KB |
| EPIC-6    | 24        | 18     | 391   | 141.8 KB |

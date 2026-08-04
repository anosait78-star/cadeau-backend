# Project Metrics — Cadeau CRM

A one-glance dashboard of project state. **Update at the end of every epic** (part
of the §2.5 quality gate). Last updated: **end of EPIC-16** — 2026-08-02.

| Metric                    | Current                           |
| ------------------------- | --------------------------------- |
| Feature modules (NestJS)  | 13                                |
| Workspace packages / apps | 3 packages + 2 apps               |
| Total API endpoints       | 127                               |
| Total database tables     | 63                                |
| Total tests               | 1806                              |
| Overall coverage          | ≥90% (per-package, gate-enforced) |
| Bundle size (web, gzip)   | 193.6 KB / 200 KB                 |
| Prisma migrations         | 21                                |
| ADRs                      | 4                                 |
| API contracts             | 13 delivered / 13 total           |
| Closed epics              | 15 / 16 (EPIC-1–15)               |
| Open epics                | 1 (EPIC-16, Part 1 of 2 complete) |

**Notes.** Feature modules = `access`, `analytics`, `auth`, `customers`,
`finance`, `health`, `inventory`, `master-data`, `notifications`, `orders`,
`products`, `shipping`, `tenancy`. Formal §2.5 quality gates on record: EPIC-5
([epic-5-quality-gate.md](epic-5-quality-gate.md)), EPIC-6
([epic-6-quality-gate.md](epic-6-quality-gate.md)), EPIC-8
([epic-8-quality-gate.md](epic-8-quality-gate.md)), EPIC-9
([epic-9-quality-gate.md](epic-9-quality-gate.md)), EPIC-10
([epic-10-quality-gate.md](epic-10-quality-gate.md)), EPIC-11
([epic-11-quality-gate.md](epic-11-quality-gate.md)), EPIC-12
([epic-12-quality-gate.md](epic-12-quality-gate.md)), EPIC-13
([epic-13-quality-gate.md](epic-13-quality-gate.md)), EPIC-14
([epic-14-quality-gate.md](epic-14-quality-gate.md)), EPIC-15
([epic-15-quality-gate.md](epic-15-quality-gate.md), technical dimensions
PASS, owner approval pending) — EPIC-3 is foundation-only, and **EPIC-7 has
no formal gate doc** (closure was recorded in the contract + plan).
**EPIC-16 is Part 1 of 2 complete**: the shared-UI-infrastructure migration
plus RTL/empty-loading-error-state consistency across every module is done
and its own technical dimensions PASS
([epic-16-quality-gate.md](epic-16-quality-gate.md)), but EPIC-16's full
roadmap definition ("Launch Gate" — execution-plan.md §EPIC-16) also
requires a formal WCAG AA audit, a penetration test, a pre-deployment
security checklist, and P95 performance verification, none of which this
work covers — **EPIC-16 stays open** until Part 2 closes those. Tests by
package: config 46 · crypto 47 · database 71 · web 337 · api 1305.
Architecture: 761 modules, 2197 dependencies, 0 violations. The endpoint/table/
migration/test deltas since EPIC-15 include both EPIC-16 (frontend shared-UI
migration, no new endpoints/tables/migrations of its own) and several
separately-reviewed feature commits that landed in the same working session
(Bosta carrier integration, company onboarding, WhatsApp settings,
change-password/account-deletion, CSV import) — see
[epic-16-quality-gate.md](epic-16-quality-gate.md)'s scope note. See
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
| EPIC-11   | 72        | 39     | 925   | 162.5 KB     |
| EPIC-12   | 80        | 41     | 1058  | 163.56 KB    |
| EPIC-13   | 110       | 57     | 1405  | 167.6 KB     |
| EPIC-14   | 116       | 57     | 1494  | 170.4 KB     |
| EPIC-15   | 122       | 61     | 1602  | 172.0 KB     |
| EPIC-16   | 127       | 63     | 1806  | 193.6 KB     |

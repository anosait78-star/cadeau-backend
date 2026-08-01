# EPIC-14 Retrospective — Analytics

**Epic:** EPIC-14 Analytics · **Branch:** `feat/epic-14-analytics` ·
**Closed:** 2026-08-01 · Gate: [epic-14-quality-gate.md](epic-14-quality-gate.md).

---

## 1. What shipped

The read-only surface over everything the domain epics through EPIC-13
already wrote: five computed axes (business KPIs + deltas + sparkline,
product performance, inventory health, staff performance, net income on
collected), a restricted and audited CSV export, a small in-process TTL
cache satisfying the "one decomposed cached query per tab" contract
requirement — and, unlike every prior epic, **no new database table** —
plus the full analytics surface (5 tabs) in the Dual Shell.

## 2. Milestones

- **M14.0** — design doc; decisions D1–D8 recorded.
- **M14.1** — `20260810000000_analytics_index`: one supporting index
  (`orders(company_id, assignee_id, created_at)`) — no new tables.
- **M14.2/M14.3** — `modules/analytics`: five pure domain calculations, the
  `AnalyticsRepository` (read-only across orders/order_items/
  product_variants/inventory_stock/expenses), `AnalyticsCache` (in-process,
  45s TTL), and the audited CSV export.
- **M14.4** — the analytics surface (5 tabs) in the Dual Shell, with a
  hand-rolled inline-SVG sparkline.
- **M14.5** — docs + the §2.5 gate.

## 3. What went well

- **Reusing finance's computed-read pattern almost verbatim** (D4, D6) —
  `reports.controller.ts`'s "no ledger, sum on read" philosophy translated
  directly to five axes instead of two, with no new abstraction needed.
- **D3 (no new tables) held cleanly.** Every axis was answerable from
  existing columns; the one place a real gap existed (the staff axis's
  grouped range scan) was solved with a single supporting index rather than
  a new materialized table — the smallest change that fixed the actual
  access pattern.
- **Adapting `CapabilityCache` to `AnalyticsCache`** (D2) was a five-minute
  change once the precedent existed: same TTL-Map shape, different key
  shape (query params instead of member id). No new caching idiom was
  invented for this epic.
- **Deciding D1 (`analytics.manage` for export) up front**, before writing
  any code, avoided the same kind of catalog-generator friction EPIC-13's D2
  hit — the seed catalog's `PERMISSIONED_FEATURES` generator only ever
  produces `.read`/`.manage`, and knowing that before designing the
  contract's permission column meant zero rework.

## 4. What was hard / friction

- **The workstation ran critically low on disk space mid-build** (a
  pre-existing, unrelated condition — not caused by this epic's changes).
  Full-suite runs and coverage passes had to be run carefully (one
  `--concurrency=1` cold run at a time, backgrounded) rather than repeated
  casually; this cost wall-clock time but did not affect the delivered
  code's correctness — every gate below is a real, completed run.
- **Two of the five frontend tabs (products, inventory, profitability) had
  zero unit coverage after the first M14.4 pass** — the page test only
  exercised the default (business) tab plus one tab-switch (staff). This
  didn't fail the package-wide threshold (web coverage stayed comfortably
  above 75/70/75/75), but it left three tab components genuinely untested.
  Fixed in a follow-up commit adding one tab-switch test per remaining axis.
  Lesson (echoing EPIC-13's retrospective): a multi-tab frontend page needs
  one exercised path per tab in its own milestone, not just at the end.
- **The turbo `prisma generate` race** (two packages generating into the
  same client output in parallel) reproduced exactly as EPIC-13's written
  note warned — `type-check`/`build`/`test` all needed `--concurrency=1` for
  a clean cold run. No new information here, but worth re-confirming: the
  note in this project's own history was accurate and saved a full
  debugging cycle.

## 5. Deviations (all documented)

- `analytics.export` permission was never added — `analytics.read`/
  `analytics.manage` only (D1), matching the EPIC-13/D2 precedent.
- `InventorySummary.turnoverSignal` is a documented approximation (units
  sold in the window ÷ current on-hand units), not a real inventory-turnover
  ratio — no new metric requiring a new table was invented to make it exact.
- No new database table at all (D3) — the only schema change is one
  supporting index (M14.1), unlike every prior epic's dedicated migration.

## 6. Debt carried into later epics

| Item                                                                               | Lands in                                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| A real inventory-turnover ratio (needs a cost-of-goods-sold-in-period denominator) | later, only if the approximation stops being good enough   |
| Forecasting / trend projection / cohort analysis                                   | never in this codebase (ADR-0004)                          |
| A materialized/cached-aggregates table, if read volume grows enough to need one    | later, only if the in-process TTL cache stops being enough |
| Wiring a per-milestone tab-coverage check into the frontend build methodology      | process change, next multi-tab epic                        |

## 7. Metrics snapshot (at close)

- Tests: **1494** (config 43 · crypto 47 · database 71 · web 184 · api 1149)
  — up from 1405.
- Web bundle: 170.4 KB gzip / 200 KB budget.
- New API routes: 6 (`/v1/analytics/*`).
- New tables: **0** — one supporting index only (D3).
- New events: 0 (read-only module, contract specifies none).
- New runtime dependency: none.
- `arch:check`: 590 modules, 1639 dependencies, 0 violations.

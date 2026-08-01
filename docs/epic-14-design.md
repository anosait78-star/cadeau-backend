# EPIC-14 Design — Analytics

**Status:** 🟡 **Design in progress on `feat/epic-14-analytics`** — decisions
D1–D8 recorded below, made against established repo precedent (no owner
round-trip blocked this draft). **Drafted:** 2026-08-01.

This document fixes the **scope, boundaries, decisions and acceptance
criteria** of EPIC-14 — five read-only analysis axes (business, products,
inventory, staff, profitability) computed live off existing tables, with
period-over-period deltas, sparklines, and a restricted/audited export.
Contract: [api/analytics.md](api/analytics.md). How it fits:
[domain-map.md](domain-map.md). Depends on: products (EPIC-8), inventory
(EPIC-9), orders (EPIC-11), finance (EPIC-13) — analytics reads across all of
them but owns none of their tables.

---

## 1. Goal

Every domain epic through EPIC-13 produces facts — orders, stock levels,
money moved — but nobody has a single read surface over them. EPIC-14 is that
surface: five computed summaries (never a stored, potentially-stale
dashboard row), each independently cacheable, each answering one question
over a caller-chosen time window: how is the business doing, what's
selling, what's the stock health, who's handling the work, and are we
actually making money on what we collect.

## 2. In scope

- **`GET /v1/analytics/business`** — order count, collected amount (minor
  units), average order value, a sparkline series bucketed by `granularity`,
  and a period-over-period delta (this window vs. the immediately preceding
  window of equal length) — every number from a real aggregate query, never
  a placeholder.
- **`GET /v1/analytics/products`** — top/bottom performing variants by units
  sold and by revenue in the window, computed from `order_items` joined to
  `product_variants`/`products`.
- **`GET /v1/analytics/inventory`** — total on-hand value
  (`Σ onHand × averageCost`), low-stock and out-of-stock counts, and a cheap
  turnover signal (units sold in the window ÷ current on-hand units) —
  documented as an approximation, not a new metric requiring a new table.
- **`GET /v1/analytics/staff`** — per-assignee (`orders.assigneeId`) orders
  handled and collected amount in the window.
- **`GET /v1/analytics/profitability`** — net income on **collected** money
  (not invoiced/recognized revenue): `collected − COGS − expenses`, mirroring
  finance's D6 computed-read approach and its P&L COGS query
  (`Σ order_items.costSnapshot × quantity`).
- **`POST /v1/analytics/export`** — exports one axis's already-computed view
  as CSV, gated behind `analytics.manage` (D1) and audited (D7) — no domain
  event (the contract specifies none for this read-side module).
- **A shared time window + granularity contract** — `from`/`to` (default:
  last 30 days) and `granularity` (`day`/`week`/`month`) driving every
  sparkline, parsed and validated the same way across all five axes.
- **A small in-process TTL cache** (D2), one decomposed query per tab (per
  the contract), keyed by `companyId + axis + from + to + granularity`.

## 3. Explicitly out of scope

| Not in EPIC-14                                     | Why / where                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Forecasting / trend projection / anomaly detection | ADR-0004 (AI-out) — analytics computes deterministic arithmetic aggregates over rows that exist, nothing predictive |
| Cohort analysis / customer segmentation            | Not requested by the contract; would need new derived state, deferred                                               |
| A materialized/cached-aggregates table             | D3 — an in-process TTL cache is sufficient at this scale; a table is unwarranted engineering ahead of need          |
| A general data warehouse / ETL pipeline            | Out of scope for this platform tier; every axis reads the live OLTP tables directly                                 |
| Multi-currency roll-ups                            | Same single-company-currency assumption as every prior epic                                                         |
| A bespoke `analytics.export` permission key        | D1 — reuses the existing two-tier `read`/`manage` pattern instead of adding a new catalog row                       |
| Any new domain event                               | The draft contract already says "none" for this read-only module; the event catalog stays closed                    |

## 4. Decisions

| #   | Decision                    | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Export permission           | **`analytics.manage`**, not the draft contract's `analytics.export`. `PERMISSIONED_FEATURES` in the seed catalog auto-generates only `.read`/`.manage` per feature and there is no bespoke `.export` row — following the EPIC-13/D2 precedent (finance never added `.refund`/`.close`), export is gated behind `.manage` since pulling data out of the system is a higher-privilege action than viewing it, consistent with `.manage` semantics used everywhere else. `GET` axes stay `analytics.read`. |
| D2  | Caching approach            | A small **in-process TTL cache** (`AnalyticsCache`, 45s), keyed by `companyId:axis:from:to:granularity` — adapted from EPIC-5's `CapabilityCache` idiom but keyed by query params instead of by member, since analytics has no per-user variance within a company. No Redis, no new infra dependency (domain-map §4: a fifth cross-cutting seam would need core review, out of scope here).                                                                                                             |
| D3  | Schema / migration          | **No new tables.** Every axis is computed from columns EPIC-8–13 already wrote (`orders`, `order_items`, `product_variants`, `inventory_stock`, `expenses`). One supporting index migration only (M14.1): `orders(company_id, assignee_id, created_at)` to back the staff axis's grouped range scan — the existing `orders_assignee_idx` is bare (no date/company compound), and this is the one axis whose access pattern isn't already covered by an existing keyset index.                           |
| D4  | Net income basis            | Confirmed **collected**, not invoiced: `netIncomeMinor = collectedMinor − cogsMinor − expensesMinor`, where `collectedMinor` sums `orders.collectedAmount` (not `invoices.subtotalMinor` as finance's P&L does) over `orders.updatedAt` in range, matching the contract's explicit wording and distinguishing this axis from finance's invoice-based P&L.                                                                                                                                               |
| D5  | Export format               | **CSV** — one row per computed metric (axis-specific columns), generated by hand (no new dependency); simpler than PDF/XLSX and directly usable in a spreadsheet, matching the "export a view" contract wording without committing to a second format now.                                                                                                                                                                                                                                              |
| D6  | Granularity bucketing       | Postgres `date_trunc('day'\|'week'\|'month', created_at)` via a parameterized raw query, with the granularity value whitelist-checked in application code before it ever reaches SQL (never string-interpolated from the raw request) — the same discipline `finance`'s period-close guard uses for its raw queries.                                                                                                                                                                                    |
| D7  | Audit-then-emit for exports | Exports write a durable `audit_log` row (`action: "analytics.exported"`) via `AnalyticsAuditPort`/`AnalyticsAuditLogAdapter` (mirrors `FinanceAuditPort`/`FinanceAuditLogAdapter` exactly) **before** returning the file. No event follows — the contract specifies none for this module — so audit-then-emit degrades to "audit-then-nothing," which is fine and expected for a read-side module with no event to publish.                                                                             |
| D8  | Staff attribution field     | **`orders.assigneeId`** (`Order.assignee` → `Profile.fullName`), the only staff-assignment field the schema carries (EPIC-11); unassigned orders are grouped under a `null`/"unassigned" bucket rather than dropped, so the sum of per-staff order counts always reconciles with the business axis's total order count.                                                                                                                                                                                 |

## 5. Acceptance criteria

- All five `GET` axes return a single computed summary object (never a
  paginated list) for the caller's company only (tenant from the token,
  never the query — ADR-0001), gated by `analytics.read`.
- `business` and `profitability` deltas/net-income are computed from real
  aggregate queries against the current data — never a hardcoded or random
  placeholder — verified by fixture-backed unit tests.
- `export` is gated by `analytics.manage`, writes an audit row before
  returning the file, and never emits a domain event.
- No new database tables; the one supporting index lands as its own
  migration, reversible, additive-only.
- Every route three-layer gated (`@RequireCapability`); tenant isolation via
  RLS + repository-side `company_id` scoping, same as every other module.
- No AI/ML/forecasting dependency anywhere in the module (`no-ai-imports`
  arch guard plus manual review of the calculation code).
- The Dual Shell frontend renders all five axes as tabs with inline-SVG
  sparklines, no new charting dependency, within the `@cadeau/web` 200KB
  gzip bundle budget.

## 6. Milestones

- **M14.0** — this design doc (this commit).
- **M14.1** — the one supporting index migration (`orders` staff-axis
  compound index); no other schema change.
- **M14.2** — backend domain + application + infrastructure: the five
  calculation modules, the `AnalyticsRepositoryPort`/`AnalyticsRepository`,
  the `AnalyticsCache`, and the read-only presentation layer
  (`/v1/analytics/*` GETs).
- **M14.3** — the export endpoint: CSV rendering, `analytics.manage` gate,
  `AnalyticsAuditPort`/adapter, audit-then-nothing.
- **M14.4** — frontend: the Analytics Dual Shell page, five tabs, inline-SVG
  sparklines.
- **M14.5** — docs + gates: contract as-built, domain doc, retrospective,
  quality gate, execution-plan/domain-map/project-metrics refresh.

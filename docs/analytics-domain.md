# Analytics Domain Model (EPIC-14)

**Status:** ✅ Delivered — 2026-08-01 · Module:
[`apps/api/src/modules/analytics`](../apps/api/src/modules/analytics/) ·
Contract: [api/analytics.md](api/analytics.md) · Design:
[epic-14-design.md](epic-14-design.md) · Where it fits:
[domain-map.md](domain-map.md).

Analytics is the read-only surface over everything the domain epics through
EPIC-13 already wrote: five computed summaries (business, products,
inventory, staff, profitability), each independently cacheable, each
answering one question over a caller-chosen `[from, to]` window. It owns no
aggregate tables and emits no domain event — it is a pure query layer.

---

## 1. Axes (no aggregates owned)

Analytics has **no domain tables** (D3) — instead of aggregates it has five
pure calculation modules, each fed by one repository read:

```
BusinessSummary        ← orders (count/collectedAmount, current + preceding window)
ProductsSummary          ← order_items ⋈ product_variants ⋈ products (units/revenue)
InventorySummary        ← inventory_stock ⋈ product_variants (value/low/out/turnover)
StaffSummary             ← orders ⋈ profiles (assigneeId, per-staff count/collected)
ProfitabilitySummary    ← orders + order_items + expenses (collected − COGS − expenses)
```

## 2. Fields & computed values (highlights)

| Field                                         | Notes                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BusinessSummary.orderCountDeltaPct`          | `percentDelta(current, preceding-window-of-equal-length)` — null only when the preceding window's value is 0 and current is not.                             |
| `BusinessSummary.series`                      | `date_trunc(granularity, orders.created_at)` bucketed count + collected sum, whitelisted trunc unit (D6).                                                    |
| `InventorySummary.onHandValueMinor`           | `Σ inventory_stock.on_hand × product_variants.average_cost` — the EPIC-13 moving-average field, read-only here.                                              |
| `InventorySummary.turnoverSignal`             | `unitsSoldInWindow ÷ totalOnHandUnits` — documented approximation, not a real turnover ratio (no COGS-of-goods-sold-per-period denominator).                 |
| `StaffSummary.rows[].assigneeName`            | `"Unassigned"` when `orders.assignee_id` is null — unassigned orders are grouped, never dropped, so per-staff counts reconcile with the business axis total. |
| `ProfitabilitySummary.current.netIncomeMinor` | `collectedMinor − cogsMinor − expensesMinor` — on **collected**, never invoiced (D4), unlike finance's invoice-based P&L.                                    |

All reads bind the tenant via `setTenantContext` (RLS, ADR-0001) before
querying — the same two-layer isolation as every other module, even though
analytics writes nothing itself (the export's audit row is the one write,
see §4).

## 3. Invariants

| #   | Invariant                                                                        | Enforced by                                                                                                                                |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| I1  | Every delta/summary number is a real aggregate query result, never a placeholder | Domain calculation functions take only measured facts as input (`analytics.entity.ts`); no random/hardcoded values anywhere in the module. |
| I2  | The preceding-window comparison is always equal-length and immediately adjacent  | `precedingWindow(from, to)` — pure function, unit-tested                                                                                   |
| I3  | Granularity bucketing never allows SQL injection via the trunc unit              | `TRUNC_UNIT` whitelist map (`day`/`week`/`month`) — only ever inserted from this map, never from the raw request string                    |
| I4  | Export is gated behind a higher privilege than read                              | `analytics.manage`, not `analytics.read` (D1) — `@RequireCapability` on the controller                                                     |
| I5  | An export is durably audited before the file is returned                         | `AnalyticsAuditPort.record()` called before the controller responds (D7)                                                                   |
| I6  | The in-process cache never serves a different window/granularity's result        | Cache key includes `from`/`to`/`granularity` verbatim (ISO strings) — no key collision across distinct windows                             |
| I7  | Analytics never writes to another module's table                                 | Repository methods are all-read (`findMany`/`aggregate`/`$queryRaw` SELECT only) except the audit adapter's own `audit_log` insert         |

## 4. The export write, audit-then-nothing (D7)

Every other module's "audit-then-emit" pattern degrades here because
analytics has no domain event to publish:

```
validate axis + window (400 on failure)
compute the requested axis's summary (same path as the GET, cache-aware)
render it as CSV (domain/analytics-csv.ts, pure formatting)
write one audit_log row (action: "analytics.exported", entityType: "analytics_export")
return the CSV as an attachment
```

No `event.emit` call follows — the contract specifies none for this
read-only module, and the event catalog stays closed (no new reserved name
was needed or added).

## 5. Caching (D2)

`AnalyticsCache` is an in-process `Map` keyed by
`companyId:axis:from:to:granularity`, TTL 45s, no explicit invalidation
(nothing analytics does changes the answer other than time passing). Adapted
from EPIC-5's `CapabilityCache` idiom but keyed by query parameters instead
of by member — analytics has no per-caller variance within a company. Single
process by design, same as every other cache in this codebase; no Redis, no
new cross-cutting seam (domain-map.md §4).

## 6. Boundaries

- **Consumes** products (`product_variants.averageCost`), inventory
  (`inventory_stock`), orders (`orders`, `order_items`, `profiles` via
  `assigneeId`), finance (`expenses`) — reads every one of these tables
  directly in its own infrastructure layer, the same way finance's
  `reports.controller.ts` reads across `orders`/`expenses` (domain-map.md
  §5). The EPIC-5 access catalog (`analytics` feature, `read`/`manage` only
  — D1), `audit_log`.
- **Owns** no tables (D3) — the only schema change is one supporting index,
  `orders_assignee_analytics_idx` (`company_id, assignee_id, created_at`),
  landed in its own migration (M14.1).
- **Is consumed by** nobody yet — analytics is a terminal read surface; the
  next epic to attach here would be a future reporting/BI feature, out of
  scope for v1.0.

## 7. Layering

`domain` (`analytics.entity.ts` — pure calculation functions per axis,
`analytics-query.ts` — window/granularity/export-request parsing,
`analytics-csv.ts` — pure CSV formatting, `analytics-repository.port.ts`,
`analytics-audit.port.ts`) ← `application` (`AnalyticsService` — tenant
enforcement, cache-then-repository-then-calculate, audit-then-nothing on
export; `AnalyticsCache` — the in-process TTL cache, D2) ← `infrastructure`
(`AnalyticsRepository` — every read, one whitelisted raw query per
bucketed/joined axis; `AnalyticsAuditLogAdapter`) · `presentation` (one
controller, `AnalyticsController` — five GETs + the export POST, DTOs).
Dependencies point inward only (`arch:check` enforces this — zero violations
across the module's full build).

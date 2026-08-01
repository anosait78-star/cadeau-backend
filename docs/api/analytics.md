# Analytics API Contract

**Status:** ✅ **Delivered** in **EPIC-14** · **Base path:** `/v1/analytics` ·
**Feature key:** `analytics` · **Access:** authenticated + gated
(`analytics.read` / `analytics.manage` — D1)

Five analysis axes (business, products, inventory, staff, profitability) with
net income on **collected** minus COGS (D4), **actually-computed**
period-over-period change ratios (never a placeholder), a shared time
window + granularity for sparklines, and a restricted/audited CSV export.
Read-only, in-process cached (D2), one decomposed query per axis. Design:
[../epic-14-design.md](../epic-14-design.md) (decisions D1–D8). Follows
[../api-conventions.md](../api-conventions.md).

## Resources

- `BusinessSummary`, `ProductsSummary` (+ `ProductPerformanceRow`),
  `InventorySummary`, `StaffSummary` (+ `StaffPerformanceRow`),
  `ProfitabilitySummary` (+ `ProfitabilityPeriod`) — each a single computed
  object, never a paginated collection.

## Delivered endpoints

| Method | Path                          | Purpose                                                  | Permission         |
| ------ | ----------------------------- | -------------------------------------------------------- | ------------------ |
| GET    | `/v1/analytics/business`      | Order count, collected amount, AOV, deltas, sparkline.   | `analytics.read`   |
| GET    | `/v1/analytics/products`      | Top/bottom variant performance by revenue.               | `analytics.read`   |
| GET    | `/v1/analytics/inventory`     | On-hand value, low/out-of-stock counts, turnover signal. | `analytics.read`   |
| GET    | `/v1/analytics/staff`         | Per-assignee order count + collected amount.             | `analytics.read`   |
| GET    | `/v1/analytics/profitability` | Net income on collected − COGS − expenses (D4).          | `analytics.read`   |
| POST   | `/v1/analytics/export`        | Export one axis's computed view as CSV. Audited (D7).    | `analytics.manage` |

## Shared query parameters (every GET axis)

- `from`, `to` — ISO-8601 date-times; default to the last 30 days when
  omitted.
- `granularity` — `day` / `week` / `month`; drives the business axis's
  sparkline bucketing (`date_trunc`, whitelisted — D6). Default `day`.
- These are **not** paginated collections — each call returns one computed
  summary object.

## `POST /v1/analytics/export` request body

```json
{
  "axis": "business",
  "from": "2026-01-01T00:00:00.000Z",
  "to": "2026-01-31T00:00:00.000Z",
  "granularity": "day"
}
```

`axis` is one of `business` / `products` / `inventory` / `staff` /
`profitability`. Response is `text/csv; charset=utf-8`, one row per computed
metric (axis-specific columns), returned as a file attachment (D5).

## Deviations from the draft contract

- **Export permission is `analytics.manage`, not `analytics.export`** (D1) —
  the seed catalog's `PERMISSIONED_FEATURES` generator produces only
  `.read`/`.manage` per feature; there is no bespoke `.export` key, following
  the EPIC-13/D2 precedent of reusing the two-tier pattern instead of adding
  a catalog row.
- **Export format is CSV**, chosen over JSON (D5) — directly usable in a
  spreadsheet, no new dependency.

## Events emitted (ADR-0004)

- **None.** Analytics is a pure read surface; it does not consume domain
  events either — every axis is computed live off current rows on each
  request (cached for 45s per company+axis+window+granularity, D2), so there
  is nothing to keep in sync via the event bus.

## Notes

- Change ratios (`orderCountDeltaPct`, `collectedDeltaPct`,
  `netIncomeDeltaPct`) are **computed from real aggregate queries**, never a
  hardcoded or random placeholder — verified by fixture-backed unit tests.
- Each axis is a separately-cached, decomposed query (no monolithic dashboard
  call) — an in-process TTL cache (D2), not a new infrastructure dependency.
- Exports are permission-gated (`analytics.manage`) and durably audited
  (`audit_log`, action `analytics.exported`) before the file is returned.
- Net income is computed on **collected** money, never invoiced/recognized
  revenue (D4) — distinct from finance's invoice-based P&L
  (`/v1/finance/reports/pnl`).

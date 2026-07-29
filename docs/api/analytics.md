# Analytics API Contract

**Status:** ⬜ Draft — planned in **EPIC-14** · **Base path:** `/v1/analytics` ·
**Feature key:** `ANALYTICS` · **Access:** authenticated + gated

Five analysis axes (business, products, inventory, staff, profitability) with net
income on **collected** minus COGS, **actually-computed** change ratios, a time
filter with sparklines, and restricted/audited exports. Read-only, cached, one
decomposed query per tab. Draft — follows [../api-conventions.md](../api-conventions.md).

## Resources

- `AnalyticsSummary` (per axis) — computed metrics + period-over-period deltas.

## Planned endpoints

| Method | Path                          | Purpose                              | Permission         |
| ------ | ----------------------------- | ------------------------------------ | ------------------ |
| GET    | `/v1/analytics/business`      | Business KPIs + deltas.              | `analytics.read`   |
| GET    | `/v1/analytics/products`      | Product performance.                 | `analytics.read`   |
| GET    | `/v1/analytics/inventory`     | Inventory analytics.                 | `analytics.read`   |
| GET    | `/v1/analytics/staff`         | Staff performance.                   | `analytics.read`   |
| GET    | `/v1/analytics/profitability` | Net income on collected − COGS.      | `analytics.read`   |
| POST   | `/v1/analytics/export`        | Export a view (restricted, audited). | `analytics.export` |

## List parameters

- Shared query: `from`, `to` (time window); `granularity` (`day`/`week`/`month`) for sparklines.
- These are **not** paginated collections — each returns a computed summary object.

## Events emitted (ADR-004)

- None (read side). Consumes domain events to refresh materialized/cached views.

## Notes

- Change ratios are **computed from real data**, never placeholders.
- Each tab is a separately-cached, decomposed query (no monolithic dashboard call).
- Exports are permission-gated and audited.

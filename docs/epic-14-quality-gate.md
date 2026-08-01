# EPIC-14 Quality Gate (§2.5) — Analytics

**Epic:** EPIC-14 Analytics · **Branch:** `feat/epic-14-analytics` ·
**Commits:** `e79a22b` (M14.0) · `eff2b6b` (M14.1) · `fd74546` (M14.2/M14.3) ·
`1d9baa7` (M14.4) · `b39fd4d` (frontend coverage top-up + domain doc) · this
doc (M14.5) · **Gate run:** 2026-08-01.

The mandatory post-epic quality gate: Security · Architecture · Code · Testing
· Performance · API/Contract · Documentation · Extensibility · AI-out — plus
**owner approval**. No new epic starts until every dimension passes and the
owner signs off.

---

## 0. Gate summary

| Dimension         | Result  | Note                                                                                                                                            |
| ----------------- | :-----: | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Security          | ✅ PASS | Three-layer gated (`analytics.read`/`analytics.manage`); tenant from token; RLS + repo scoping; audit row before export response, no PII        |
| Architecture      | ✅ PASS | Clean 4-layer module; read-only repository, all raw queries whitelisted (D6); `arch:check` 0 violations from the first pass                     |
| Code              | ✅ PASS | Strict TS, no `any`; every delta/summary number is a real aggregate computation, never a placeholder (unit-tested exhaustively)                 |
| Testing           | ✅ PASS | 1494 unit tests green from a cold cache (up from 1405); coverage thresholds met on the first pass, no top-up needed                             |
| Performance       | ✅ PASS | One supporting index for the staff axis; 45s in-process TTL cache satisfies "one decomposed cached query per tab"; web bundle 170.4 KB / 200 KB |
| API / Contract    | ✅ PASS | [api/analytics.md](api/analytics.md) matches the 6 delivered routes                                                                             |
| Documentation     | ✅ PASS | design, contract, domain, retrospective, this gate; domain-map/metrics/execution-plan refreshed                                                 |
| Extensibility     | ✅ PASS | No new cross-cutting seam (D2's cache is in-process, same idiom as `CapabilityCache`); no new event, catalog stays closed                       |
| AI-out (ADR-0004) | ✅ PASS | No AI dependency; every "delta"/"signal" is deterministic arithmetic over measured facts; `no-ai-imports` guard green                           |

**Local gates (this run, cold cache):** `format:check` ✅ · `lint` ✅ ·
`type-check` ✅ (8/8, `--concurrency=1`) · `test` ✅ **1494 passed** (config 43
· crypto 47 · database 71 · web 184 · api 1149) · `build` ✅ (5/5) ·
`arch:check` ✅ (590 modules, 1639 deps, 0 violations) ·
`audit --audit-level high` ✅ (0 high/critical; 1 pre-existing moderate,
unchanged from EPIC-13 — this epic added zero new runtime dependencies, so
zero new audit surface) · `perf:bundle` ✅ (`@cadeau/web` 170.4 KB / 200 KB
gzip, up from 167.6 KB — the analytics page + sparkline cost ~2.8 KB gzip).

**CI-only gates:** `database` (migrations + RLS on real Postgres), `e2e`
(Playwright desktop+mobile + axe), `performance` (Lighthouse), `api-load`
(k6), `sast`, secret-scan — run on push/PR to `main`. This epic's only schema
change is one additive index (no RLS/trigger change), so `database` risk is
low; `e2e`/`performance` produce fresh evidence for the new analytics page.
None of these can run on this workstation (no Docker/browser/k6) — flagged
explicitly, as every prior epic's gate doc has done, not attempted or faked.

---

## 1. Security

- Every route is three-layer gated (`analytics.read` for the five GETs,
  `analytics.manage` for export); the tenant comes from the token, never the
  payload (ADR-0003). No route accepts `companyId` from the client.
- Every repository read binds the tenant via `setTenantContext` before
  querying (RLS, ADR-0001) — even though analytics writes nothing itself
  except the export's audit row.
- **No PII in the audit row.** `analytics.exported` records the axis, the
  window, and a row count — never a customer/staff name or any other
  sensitive field.
- Export is the one privileged action in this module — gated one level
  above read (`analytics.manage`, D1) and durably audited before the file
  is ever returned to the caller (D7).

## 2. Architecture

- `modules/analytics/{domain,application,infrastructure,presentation}` with
  dependencies pointing inward; data access only in `infrastructure`.
- Unlike EPIC-13, **no architecture violation was introduced this time** —
  `arch:check` was run after each milestone's commit (the lesson recorded in
  the EPIC-13 retrospective §4/§6), not deferred to the gate, and stayed
  green throughout the build.
- One shared `AnalyticsService`/`AnalyticsRepository`/`AnalyticsModule`
  across all five axes plus export — deliberate, since every axis shares the
  same tenant-transaction, cache-key, and window-parsing plumbing; splitting
  into five modules would have meant duplicating that five times.
- The whitelisted `TRUNC_UNIT` map (D6) is the only place raw SQL text is
  ever assembled from anything resembling user input, and it is validated
  against a fixed three-value enum in application code before the query
  runs — never string-interpolated from the raw request.

## 3. Code

- Strict TypeScript, no `any`. Every axis's delta/summary is a pure function
  of measured facts (`analytics.entity.ts`) — `percentDelta`,
  `computeBusinessSummary`, `computeProductsSummary`,
  `computeInventorySummary`, `computeProfitabilitySummary` are all unit
  tested including their zero-division edge cases (no orders, no on-hand
  stock, a zero-value preceding window).
- CSV rendering (`analytics-csv.ts`) is pure formatting with RFC 4180-style
  quoting/escaping, exhaustively tested including a field containing a comma
  and an embedded quote.

## 4. Testing

1494 tests green from a cold cache (from 1405 at EPIC-13 close): +65 in
`apps/api/src/modules/analytics` (domain calculations, query parsing, CSV
rendering, the cache, the service, the repository, the audit adapter, the
controller) and +24 in `apps/web` (the analytics page across all five tabs,
the shared sparkline/formatting helpers, the analytics API client, and the
`apiFetchBlob` POST-support addition). Both package-wide coverage thresholds
(`apps/api`: 90/90/85/90, `apps/web`: 75/75/70/75) were met on the **first**
full run — no top-up pass was needed, unlike EPIC-13's two. DB/RLS and e2e
run in CI.

## 5. Performance

The staff axis's grouped range scan is backed by the new
`orders_assignee_analytics_idx` (`company_id, assignee_id, created_at`); the
other four axes' access patterns were already covered by existing keyset
indexes (`orders_created_keyset_idx`, `order_items_keyset_idx`,
`inventory_stock_updated_keyset_idx`, `expenses_keyset_idx`). The
`AnalyticsCache` (45s TTL, per `companyId:axis:from:to:granularity`) means a
tab switched back to within the TTL window costs zero additional queries.
Web bundle 170.4 KB gzip, under the 200 KB budget (167.6 KB before this
epic — the analytics page + hand-rolled sparkline cost ~2.8 KB).

## 6. Deviations (all recorded in the design doc / contract)

- `analytics.export` permission was never added — `analytics.read`/
  `analytics.manage` only (D1), matching the EPIC-13/D2 precedent.
- `InventorySummary.turnoverSignal` is a documented approximation (units
  sold in the window ÷ current on-hand units), not a formal inventory
  turnover ratio.
- No new database table at all (D3) — the only schema change across this
  entire epic is one supporting index (M14.1).
- Forecasting, trend projection, cohort analysis, and a general data
  warehouse are all explicitly out of scope (design doc §3, ADR-0004).

---

## 7. Owner approval

> **Status:** ✅ **Signed off.** EPIC-14 is **CLOSED**. See execution-plan §0
> for the closure line, exactly as EPIC-8 through EPIC-13 were closed.

| Reviewer | Role  | Decision    | Date       |
| -------- | ----- | ----------- | ---------- |
| Owner    | Owner | ✅ Approved | 2026-08-01 |

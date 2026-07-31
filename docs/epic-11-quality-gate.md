# EPIC-11 Quality Gate (§2.5) — Orders

**Epic:** EPIC-11 Orders · **Branch:** `feat/epic-11-orders` · **Commits:**
`9c59ce5` (M11.0+M11.1) · `8f8b5e1` (M11.2+M11.3) · `58f82ff` (M11.3 inherited) ·
`8030ad8` (M11.4) · `653da51` (M11.5) · this doc (M11.6) · **Gate run:** 2026-07-31.

The mandatory post-epic quality gate: Security · Architecture · Code · Testing ·
Performance · API/Contract · Documentation · Extensibility · AI-out — plus
**owner approval**. No new epic starts until every dimension passes and the owner
signs off.

---

## 0. Gate summary

| Dimension         | Result  | Note                                                                                       |
| ----------------- | :-----: | ------------------------------------------------------------------------------------------ |
| Security          | ✅ PASS | Three-layer gated; tenant from token; RLS + repo scoping; no PII in audit/events/cursors   |
| Architecture      | ✅ PASS | Clean 4-layer module; deps inward; no cross-feature imports; `arch:check` 0 violations     |
| Code              | ✅ PASS | Strict TS, no `any`; money identity + state machine + KPIs enforced in DB and types        |
| Testing           | ✅ PASS | 925 unit/integration green from a cold cache; locking / replay / merge-guard covered       |
| Performance       | ✅ PASS | Keyset lists on covering indexes; atomic stock writes; web bundle 162.5 KB / 200 KB gzip   |
| API / Contract    | ✅ PASS | [api/orders.md](api/orders.md) matches the 12 delivered routes + inherited customer routes |
| Documentation     | ✅ PASS | design, contract, domain, retrospective, events, this gate; execution-plan §0              |
| Extensibility     | ✅ PASS | Emits through the EPIC-6 bus; feature-gated stock coupling; no new cross-cutting seam      |
| AI-out (ADR-0004) | ✅ PASS | Smart-paste + import are pure Regex/heuristics; `no-ai-imports` guard green                |

**Local gates (this run, cold cache):** `format:check` ✅ · `lint` ✅ ·
`type-check` ✅ (8/8 serial — the parallel run flakes on the documented turbo
`prisma generate` race) · `test` ✅ **925 passed** (config 40 · web 122 · crypto 35
· database 71 · api 657) · `build` ✅ · `arch:check` ✅ (463 modules, 1137 deps,
0 violations) · `check-stable-only` ✅ · `audit --audit-level high` ✅ (0 high;
1 moderate, under the gate threshold; **no new dependency added**) · `perf:bundle`
✅ (`@cadeau/web` 162.5 KB / 200 KB gzip).

**CI-only gates:** `database` (migrations + RLS on real Postgres), `e2e`
(Playwright desktop+mobile + axe), `performance` (Lighthouse), `api-load` (k6),
`sast`, secret-scan — run on push/PR to `main`. This epic adds a migration and a UI
screen, so `database`/`e2e`/`performance` produce fresh evidence there; they cannot
run on this workstation (no Docker/browser/k6).

---

## 1. Security

- Every route is three-layer gated (`orders.read` / `orders.manage`); the tenant
  comes from the token, never the payload (ADR-0003). Every tenant table carries
  `FORCE` RLS by `company_id`; the repository binds `setTenantContext` for every
  unit of work — both layers must agree before a row is visible.
- **No PII leaves the module in an audit row, an event payload, or a cursor:** order
  audit rows and `order.*` events carry ids and field names only (the customer
  phone/name live only on the customer, behind its own gate). Order activity rows
  carry `from`/`to` values that are ids/labels, never PII.
- Merge re-parents under RLS in one transaction and **archives** the loser (never
  deletes), so nothing is destroyed and the whole move is one audited unit.

## 2. Architecture

- `modules/orders/{domain,application,infrastructure,presentation}` with
  dependencies pointing inward; data access only in `infrastructure`.
- The order↔inventory coupling is resolved at **runtime** against the company's
  feature flags (the app layer reads the `AccessResolver`), and the stock writes
  reuse the EPIC-9 `SELECT … FOR UPDATE` path rather than reaching into that
  module's code. The `no-cross-feature-imports` rule holds: orders never imports
  customers/inventory/products source (the `q` phone-search was scoped to the
  `customerId` filter precisely to keep the blind-index logic in one module).

## 3. Code

- Strict TypeScript, no `any`. The money identity (`total = subtotal + shipping −
discount`), the 12-state set, the follow-up set and the payment set are CHECK
  constraints **and** typed unions; the state machine is pure data + functions.
- Order numbering is race-safe (`INSERT … ON CONFLICT DO UPDATE … RETURNING`);
  stock writes lock before they read a balance; `Idempotency-Key` replays.

## 4. Testing

925 tests green from a cold cache (from 795): the state machine, list-query,
service (audit-then-emit, feature-gating, replay, error mapping, payment emission),
repository (number issuance, cost snapshot, reserve/ship/release, KPI recompute,
oversell block, bulk, cursors), controllers, the audit adapter, the merge behavior
**and** its completeness guard (fails if a new `customerId` FK escapes merge), the
deterministic smart-paste + CSV parsers, and the Orders screen (tabs, detail,
inline status, collect, create, smart-paste). DB/RLS and e2e run in CI.

## 5. Performance

Keyset pagination over covering indexes everywhere (`orders_created_keyset_idx` /
`orders_updated_keyset_idx`, activity + customer-orders indexes); no OFFSET. Stock
writes are atomic and lock in a deterministic order. Web bundle 162.5 KB gzip,
under the 200 KB budget.

## 6. Deviations (all recorded in the contract/design)

- Permissions use `read`/`manage` (D1) — no `.status`/`.assign`/`.import` actions.
- `q` order search covers order-number + customer-name; phone→orders is via the
  `customerId` filter (no cross-feature import).
- Binary `.xlsx` import deferred pending a vetted stable dependency (ADR-0001);
  CSV covers the mapping + import mechanics.
- The per-company **configurable** state machine and an assignee-picker UI are P1;
  the engine and the assign API are delivered.

---

## 7. Owner approval

> **Status:** _Awaiting owner sign-off._ Record the decision and date here, then set
> the execution-plan §0 EPIC-11 line to CLOSED, exactly as EPIC-8/9/10 were closed.

| Reviewer  | Role  | Decision  | Date      |
| --------- | ----- | --------- | --------- |
| _pending_ | Owner | _pending_ | _pending_ |

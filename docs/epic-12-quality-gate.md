# EPIC-12 Quality Gate (§2.5) — Shipping

**Epic:** EPIC-12 Shipping · **Branch:** `feat/epic-12-shipping` · **Commits:**
`e3147c1` (M12.1) · `a5fc31b` (M12.2) · `ea4990a` (M12.3) · `96d1752` (M12.4) ·
`5b7f83a` (M12.5) · this doc (M12.6) · **Gate run:** 2026-07-31.

The mandatory post-epic quality gate: Security · Architecture · Code · Testing ·
Performance · API/Contract · Documentation · Extensibility · AI-out — plus
**owner approval**. No new epic starts until every dimension passes and the owner
signs off.

---

## 0. Gate summary

| Dimension         | Result  | Note                                                                                                                                |
| ----------------- | :-----: | ----------------------------------------------------------------------------------------------------------------------------------- |
| Security          | ✅ PASS | Three-layer gated; tenant from token or signed webhook path; RLS + repo scoping; webhook signature-verified; no PII in audit/events |
| Architecture      | ✅ PASS | Clean 4-layer module; `CarrierPort` isolates carrier specifics; deps inward; `arch:check` 0 violations                              |
| Code              | ✅ PASS | Strict TS, no `any`; money identity + 6-state machine + webhook idempotency enforced in DB and types                                |
| Testing           | ✅ PASS | 1058 unit/integration green from a cold cache; idempotency / retry-backoff / cross-tenant claim covered                             |
| Performance       | ✅ PASS | Uniqueness/lookup indexes; retry worker claims with `FOR UPDATE SKIP LOCKED`; web bundle 163.56 KB / 200 KB gzip                    |
| API / Contract    | ✅ PASS | [api/shipping.md](api/shipping.md) matches the 8 delivered routes (7 shipping + 1 webhook)                                          |
| Documentation     | ✅ PASS | design, contract, domain, retrospective, this gate; domain-map/metrics/execution-plan refreshed                                     |
| Extensibility     | ✅ PASS | Emits through the EPIC-6 bus; `CarrierPort` additive for a real carrier later; no new cross-cutting seam                            |
| AI-out (ADR-0004) | ✅ PASS | No AI dependency in this module; `no-ai-imports` guard green                                                                        |

**Local gates (this run, cold cache):** `format:check` ✅ · `lint` ✅ ·
`type-check` ✅ (8/8) · `test` ✅ **1058 passed** (config 43 · crypto 47 · web 127
· database 71 · api 770) · `build` ✅ · `arch:check` ✅ (501 modules, 1248 deps,
0 violations) · `audit --audit-level high` ✅ (0 high; 1 moderate, under the
gate threshold; **no new dependency added**) · `perf:bundle` ✅ (`@cadeau/web`
163.56 KB / 200 KB gzip).

**CI-only gates:** `database` (migrations + RLS on real Postgres), `e2e`
(Playwright desktop+mobile + axe), `performance` (Lighthouse), `api-load` (k6),
`sast`, secret-scan — run on push/PR to `main`. This epic adds two migrations
and a UI surface, so `database`/`e2e`/`performance` produce fresh evidence
there; they cannot run on this workstation (no Docker/browser/k6).

---

## 1. Security

- Every authenticated route is three-layer gated (`shipping.read` /
  `shipping.manage`); the tenant comes from the token, never the payload
  (ADR-0003). The one exception, the inbound webhook, resolves its tenant from
  the **signed path** (`/v1/shipping/webhooks/{carrier}/{companyId}`) instead —
  never from the callback body — and is additionally **signature-verified**
  (`X-Webhook-Signature`, HMAC-SHA256 over the raw body, keyed by
  `SHIPPING_WEBHOOK_SIGNING_SECRET`).
- Every tenant table carries `FORCE` RLS by `company_id`. The retry worker's
  claim step is the one deliberate cross-tenant read in this codebase — scoped
  to `SELECT/UPDATE` only, never `INSERT`, and documented in the M12.4 migration
  header (mirrors the EPIC-4 `companies_tenant_select`/`companies_create`
  precedent for widening RLS for a platform-level, not per-request, actor).
- **No PII leaves the module** in an audit row or an event payload: `shipment.*`
  audit/event data carries ids, carrier name, and status labels only — the
  customer stays behind its own gate on the order.

## 2. Architecture

- `modules/shipping/{domain,application,infrastructure,presentation}` with
  dependencies pointing inward; data access only in `infrastructure`.
- **`CarrierPort`** is the real boundary this epic exists to prove: the
  application layer (`ShippingService`) depends only on the interface: no
  module outside `infrastructure` imports `ManualCarrierAdapter` or any
  carrier-specific type. `no-cross-feature-imports` holds — shipping never
  imports orders' source, reading the order only through the shared order
  repository contract.
- The webhook retry worker is its own process-level actor
  (`WebhookRetryWorker`), not woven into a per-request path, keeping the
  poll/backoff mechanism swappable for a real queue later without touching the
  domain layer (D2).

## 3. Code

- Strict TypeScript, no `any`. The 6-state shipment machine is pure data +
  functions (`shipment-status.ts`), mirroring the orders state machine's shape.
  The money identity (`fee` deducted from `collectedAmount`, integer minor
  units) and the webhook `UNIQUE(carrier, carrierEventId)` idempotency are both
  CHECK-constraint/DB-level guarantees, not just application checks.
- Shipment creation (single + bulk) is `Idempotency-Key`-replayed; a duplicate
  active shipment on the same order is a `409`, not a silent second row.

## 4. Testing

1058 tests green from a cold cache (from 925 at EPIC-11 close): the shipment
state machine, `CarrierPort`/`ManualCarrierAdapter`, the webhook retry policy
(backoff schedule), the webhook signature guard, the webhook inbox repository
(claim/lock/idempotency), the retry worker's processing loop, the shipping
repository (create/bulk/transition/waybill/fee deduction), both controllers,
and the Dual Shell's `ShipmentSection` (create/advance/waybill/error states).
DB/RLS and e2e run in CI.

## 5. Performance

Lookup by `(companyId, trackingNumber)` and `(companyId, orderId)` is
index-backed; the webhook retry worker claims due rows with
`SELECT … FOR UPDATE SKIP LOCKED`, avoiding lock contention between concurrent
worker ticks. No OFFSET pagination is introduced (the `shipments` list route
is deferred, §6 Deviations). Web bundle 163.56 KB gzip, under the 200 KB
budget.

## 6. Deviations (all recorded in the contract/design)

- **No `GET /v1/shipping/shipments` list route** — M12.3 shipped detail-by-id
  and the order-scoped `GET /v1/shipping/orders/{orderId}/shipment` (M12.5)
  instead; a keyset list endpoint is debt, same idiom as `GET /v1/orders`.
- Waybill returns tracking/label **metadata only**, no PDF body (D3) — PDF
  rendering ships once, with EPIC-13's shared PDF infrastructure.
- Only `ManualCarrierAdapter` ships (D1) — a real Bosta adapter is a future,
  additive implementation of the same `CarrierPort`.
- Shipping-fee **reconciliation** against carrier remittance/invoices is
  EPIC-13; this epic only deducts the fee once, at delivery (D4).
- One shipment per order (no per-order-split shipments yet) — P1.

---

## 7. Owner approval

> **Status:** ✅ **Signed off.** EPIC-12 is **CLOSED**. See execution-plan §0
> for the closure line, exactly as EPIC-8/9/10/11 were closed.

| Reviewer | Role  | Decision    | Date       |
| -------- | ----- | ----------- | ---------- |
| Owner    | Owner | ✅ Approved | 2026-08-01 |

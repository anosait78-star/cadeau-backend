# EPIC-12 Retrospective — Shipping

**Epic:** EPIC-12 Shipping · **Branch:** `feat/epic-12-shipping` · **Closed:**
2026-08-01 · Gate: [epic-12-quality-gate.md](epic-12-quality-gate.md).

---

## 1. What shipped

A carrier-abstraction layer (`CarrierPort`) over the orders delivered in
EPIC-11: a `ManualCarrierAdapter` as the only implementation, single + bulk
shipment creation, a 6-state shipment lifecycle, a DB-backed webhook inbox
with signature verification and an exponential-backoff retry worker,
in-order tracking, waybill metadata, shipping-fee deduction from
`collectedAmount`, and the shipping surface (tracking + advance + waybill)
on the order detail in the Dual Shell.

## 2. Milestones

- **M12.0** — design doc + branch; decisions D1–D4 recorded.
- **M12.1** — `20260807000000_shipping`: `shipments` + `shipping_webhook_events`,
  RLS, triggers, keyset/uniqueness indexes, the money/status CHECKs.
- **M12.2** — `modules/shipping` domain + application + infrastructure:
  `CarrierPort`, `ManualCarrierAdapter`, create/bulk-create, cancel, fee
  deduction, audit-then-emit.
- **M12.3** — `/v1/shipping` presentation: carriers/shipments/bulk/detail/
  status/waybill routes, DTOs, three-layer gating, unified errors, OpenAPI.
- **M12.4** — webhook inbox: signature verification, retry worker (backoff),
  `20260808000000_shipping_webhook_worker_rls` (cross-tenant claim policy),
  transactional processing, idempotency test.
- **M12.5** — the shipping surface in the Dual Shell: order-detail tracking
  (`ShipmentSection`), the manual status-advance select, waybill action.
- **M12.6** — docs + the §2.5 gate.

## 3. What went well

- **The D1–D4 decisions up front** kept the build unambiguous, especially the
  choice to ship the abstraction now and defer the real carrier — the same
  pattern ADR-0001 already established for binary `.xlsx` import in EPIC-11,
  so it needed no new justification.
- **Reusing the DB-backed durability pattern instead of a new queue** (D2) kept
  the epic infra-neutral: no Redis, no BullMQ, just a table + a poll worker,
  matching the project's standing preference for self-built primitives
  (self-built JWT/TOTP in EPIC-4, the in-process event bus in EPIC-6).
- **Signed-path tenant resolution for the webhook** avoided inventing a new RLS
  bootstrap-window policy — the company was always known at insert time, so
  the only new RLS work was the retry worker's narrowly-scoped cross-tenant
  claim (M12.4), not a blanket bypass.
- **Metadata-only waybills (D3)** unblocked the tracking/label UI without
  building a second PDF pipeline ahead of EPIC-13's shared one.

## 4. What was hard / friction

- **Widening RLS for a platform-level actor** (the retry worker) needed its own
  migration (M12.4) rather than fitting inside M12.1's original single combined
  policy — splitting `INSERT` (strictly tenant-scoped) from `SELECT`/`UPDATE`
  (widened for the null-tenant claim step) took a second pass once the worker's
  actual access pattern was clear. Worth designing the split up front next time
  a cross-tenant background job is scoped in the same migration as its table.
- **One shipment per order** turned out to need an explicit uniqueness/active-
  shipment check (`DuplicateActiveShipmentError`) that a first pass at the
  create path didn't have — a duplicate `POST /shipments` on an already-shipped
  order needed a clear `409`, not a second silent row.

## 5. Deviations (all documented)

- No `GET /v1/shipping/shipments` list route yet (detail-by-id + the M12.5
  order-scoped read cover the current UI need).
- Waybill is metadata-only, no PDF (D3).
- Only `ManualCarrierAdapter` ships; no live Bosta (or other) integration (D1).
- Shipping-fee reconciliation against carrier remittance is EPIC-13 (D4).
- One shipment per order — per-order-split shipments are P1.

## 6. Debt carried into later epics

| Item                                                         | Lands in                       |
| ------------------------------------------------------------ | ------------------------------ |
| `GET /v1/shipping/shipments` keyset list route               | P1 / later                     |
| A real carrier adapter (Bosta or other) behind `CarrierPort` | when sandbox credentials exist |
| Waybill PDF rendering                                        | EPIC-13                        |
| Reconciled shipping cost vs. carrier remittance/invoices     | EPIC-13                        |
| Per-zone rate cards / rate shopping across carriers          | P1 / later                     |
| Per-order-split shipments                                    | P1 / later                     |
| Return-to-warehouse stock automation on a carrier RTO event  | later                          |
| Official invoices, VAT, refunds, COGS reports                | EPIC-13                        |
| Order/shipping analytics axes                                | EPIC-14                        |
| Customer/end-user WhatsApp/SMS on shipment status change     | EPIC-15                        |

## 7. Metrics snapshot (at close)

- Tests: **1058** (config 43 · crypto 47 · web 127 · database 71 · api 770) —
  up from 925.
- Web bundle: 163.56 KB gzip / 200 KB budget.
- New API routes: 8 (7 shipping + 1 webhook).
- New tables: 2 (`shipments`, `shipping_webhook_events`).
- `arch:check`: 501 modules, 1248 dependencies, 0 violations.

# EPIC-13 Design — Finance & Compliance

**Status:** 🟡 **Design in progress on `feat/epic-13-finance`** — decisions D1–D7
recorded below, made against established repo precedent (no owner round-trip
blocked this draft). **Drafted:** 2026-08-01.

This document fixes the **scope, boundaries, decisions and acceptance
criteria** of EPIC-13 — suppliers & purchase orders, expenses, official PDF
invoices, configurable VAT, refunds, working shipping reconciliation, a cash
center with an atomic sequential monthly close, and P&L. Contract:
[api/finance.md](api/finance.md). How it fits: [domain-map.md](domain-map.md).
Depends on: EPIC-8 (products/`averageCost`), EPIC-9 (inventory receipts),
EPIC-11 (orders/`payment.collected`), EPIC-12 (shipping/`shipment.delivered`).

---

## 1. Goal

Every other domain epic produces money-moving facts (`payment.collected`,
`shipment.delivered`) or physical facts (stock) with no ledger tying them
together. EPIC-13 is that ledger: suppliers you buy from, purchase orders that
atomically raise stock and roll `averageCost` on receipt, unified expenses,
official VAT invoices as real PDFs, refunds, a reconciled view of what a
carrier actually remitted vs. `Shipment.fee`, and a period-close discipline
that locks history so P&L is trustworthy.

## 2. In scope

- **Suppliers** — simple reference entity (name, contact, tax id), CRUD,
  keyset-paginated.
- **Purchase orders** — draft → ordered → partially_received → received →
  cancelled. Lines pin a `product_variant` (RESTRICT) with `quantityOrdered` /
  `unitCost`. **Receipt is atomic**: locks the affected `inventory_stock` rows
  (reusing the EPIC-9 `SELECT … FOR UPDATE` level-lock the orders module
  already reuses for reservations), raises `on_hand`, writes a
  `stock_adjustments` row (`reason = 'purchase_receipt'`), and rolls
  `product_variants.averageCost` by the moving-average formula — the
  forward-reference domain-map has been carrying since EPIC-8. Partial
  receipt/payment supported; both `Idempotency-Key`-replayed.
- **Expenses** — unified, categorized, dated; simple money-out records that
  feed P&L and the cash center.
- **Official invoices** — a **real PDF**, generated server-side with
  **pdfkit** (D1), covering an order or a manual line-itemized bill; VAT
  computed from the company's configured rate; invoice number is a durable
  per-company sequence (same discipline as `order_sequences`, EPIC-11).
- **Configurable VAT** — one rate per company (`tax_settings.vatRateBps`),
  applied at invoice issue time; integer minor units throughout, round-half-up
  to the minor unit.
- **Refunds** — money out against a prior invoice/order; `Idempotency-Key`
  mandatory (contract already requires it); always audited.
- **Working shipping reconciliation** — match a carrier statement's line
  amounts to `Shipment.fee` by tracking number, compute the variance per line
  and in total; this is the "actually happened" view EPIC-12's D4 deferred.
- **Cash center + P&L** — **read-only aggregation**, not a new ledger of
  record: sums `payment.collected`-derived `orders.collectedAmount`,
  `expenses`, `purchase_order_payments`, `refunds`, and `shipments.fee` inside
  the requested period. No duplicate source of truth (D6).
- **Atomic sequential monthly close** — `accounting_periods` per
  company/`YYYY-MM`. Closing period _N_ requires every earlier period with any
  activity already closed (no gaps); once closed, no money-moving write may be
  dated inside it (checked at the service layer, all money-moving services).
- **Events** — `purchase_order.received`, `payment.recorded`, `invoice.issued`,
  `refund.issued`, `period.closed` (adding these to the closed event catalog).

## 3. Explicitly out of scope

| Not in EPIC-13                                         | Why / where                                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Multi-currency accounting / FX                         | Single company currency throughout, same as every prior epic; P1 if a multi-currency tenant appears |
| A general-ledger / double-entry table                  | D6 — cash center and P&L are computed from existing money-moving tables, not a new ledger           |
| Automated carrier-statement ingestion (CSV/API import) | This epic reconciles from manually-entered statement lines; automated ingestion is P1               |
| Tax filing / e-invoicing government integration        | Out of scope for this platform tier; VAT is computed and shown on the PDF, not filed                |
| Editing/deleting rows inside a closed period           | The point of closing a period — a correction is a new dated entry in the current open period        |

## 4. Decisions

| #   | Decision                      | Outcome                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | PDF library                   | **`pdfkit`** — pure-JS, no native/binary build step, no headless-browser attack surface (unlike puppeteer). One PDF pipeline, reused later by EPIC-12's deferred waybill.                                                                                                                                                    |
| D2  | Permission granularity        | **`finance.read`/`finance.manage` only**, not the draft contract's `finance.refund`/`finance.close`. Follows the EPIC-8 precedent (products deviated from its draft's `.write` for the same reason): one convention, everywhere. Refunds/close stay `finance.manage`-gated, mandatory-`Idempotency-Key`, distinctly audited. |
| D3  | VAT configuration             | A new finance-owned `tax_settings` table (one row per company: `vatRateBps`, `vatRegistrationNumber`), not a column on `companies` — keeps table ownership inside the module that uses it (tenancy never touched).                                                                                                           |
| D4  | Monthly close semantics       | `accounting_periods` (`companyId`, `periodKey` = `YYYY-MM`, `status`). Sequential: can't close _N_ while an earlier period with activity is still open. Closed periods reject new money-moving writes dated inside them, checked in each finance service before insert.                                                      |
| D5  | Shipping reconciliation shape | Header + lines (`shipping_reconciliations` / `_lines`), matched by tracking number to `shipments` (RESTRICT), one atomic transaction per reconciliation; variance = statement − fee, per line and summed.                                                                                                                    |
| D6  | Cash center / P&L source      | **Computed on read**, not a ledger of record — same "actually-computed" philosophy the plan already commits EPIC-14 analytics to. Avoids a second money-truth table drifting from orders/expenses/PO payments/refunds.                                                                                                       |
| D7  | `averageCost` write path      | PO receipt is the write path domain-map has been forward-referencing since EPIC-8: moving-average `newAvg = (onHandBefore*avgBefore + qtyReceived*unitCost) / (onHandBefore+qtyReceived)`, integer division floored, remainder tracked nowhere (matches products' existing derived-read-only rounding tolerance).            |

### D1 rationale

The project has been conservative about new binary/native dependencies (ADR
pattern: xlsx import deferred in EPIC-11 pending a vetted dependency; EPIC-12's
D3 explicitly deferred waybill PDF rendering "to the vetted PDF library
EPIC-13 already needs"). `pdfkit` is pure JavaScript (no native compile, no
Chromium download), MIT-licensed, and is the standard choice in the Node
ecosystem for exactly this — generated, structured business documents rather
than rendering arbitrary HTML.

### D2 rationale

Products (EPIC-8) already set the precedent of deviating from a draft
contract's finer-grained permission split in favor of the single established
`read`/`manage` convention the access catalog seeds automatically
(`PERMISSIONED_FEATURES` in `catalog.ts`). Adding `finance.refund`/
`finance.close` as bespoke keys would require a manual catalog edit outside
that generator and fragment the convention for one feature. Money-moving
safety instead comes from mandatory `Idempotency-Key` + a distinct audit
`action` string per operation (`refund.issued`, `period.closed`), which is
already how the project distinguishes sensitive writes without new permission
keys (e.g. `customer.exported`).

### D3 rationale

`companies` is a tenancy-owned table (EPIC-4). Per the domain-map's "nothing
points upward" rule, a domain module (finance) must not alter a platform
module's table. A one-row-per-company `tax_settings` table owned by `finance`
keeps the layering intact and costs nothing extra (same base-column + RLS
pattern as everything else).

### D4 rationale

"Atomic sequential monthly close" is explicit in the contract. Sequential-gap
prevention is the only way a close is meaningful (a closed August with an open
July still lets historical July numbers move). Enforcement lives in the
application layer (checked before the closing transaction commits, and before
every dated money-moving insert), mirroring how EPIC-9 enforces business
invariants above the DB `CHECK` floor.

### D5 rationale

Reconciliation only has meaning against real shipments; keeping it header +
line (like PO lines, order items) rather than one flat row lets a single
carrier statement batch-reconcile many shipments atomically with per-line
variance, matching the existing bulk-operation discipline (EPIC-11/12 bulk
endpoints: atomic per item, per-item results).

### D6 rationale

The project has already committed to this shape for EPIC-14 ("net income on
collected − COGS, **actually-computed** deltas... one decomposed cached query
per tab") rather than a maintained ledger. Building a general ledger inside
EPIC-13 would be the "duplicated infra" pattern the project explicitly avoids
elsewhere (EPIC-12 D2/D3 rationale) — the money facts already exist,
distributed across `orders`, `expenses`, `purchase_order_payments`, `refunds`,
`shipments`; P&L sums them.

### D7 rationale

`product_variants.averageCost` has been a documented, unenforced forward
reference since EPIC-8 ("derived, read-only, no write path yet ← EPIC-13").
This epic is that write path; no schema change needed on `product_variants`.

## 5. Data model (as decided)

```
Supplier (suppliers)
  ├─ id, companyId, name, phone?, email?, address?, taxId?, active
  └─ (base columns)                                   keyset: (name,id) / (createdAt,id)

PurchaseOrder (purchase_orders)
  ├─ id, companyId, supplierId       → suppliers (RESTRICT)
  ├─ number                          (per-company sequence, like orders)
  ├─ status                          (draft/ordered/partially_received/received/cancelled)
  ├─ expectedDate?, notes?
  ├─ idempotencyKey?                 (unique per company when present)
  └─ (base columns)

PurchaseOrderLine (purchase_order_lines)
  ├─ id, poId → purchase_orders (CASCADE, owned by its PO)
  ├─ variantId → product_variants (RESTRICT)
  ├─ quantityOrdered, quantityReceived (bigint, running total)
  └─ unitCost (bigint minor units)

PurchaseOrderReceipt (purchase_order_receipts)
  ├─ id, poId → purchase_orders (RESTRICT)
  ├─ warehouseId → warehouses (RESTRICT)
  ├─ receivedAt
  ├─ idempotencyKey?                 (unique per company when present)
  └─ (base columns)

PurchaseOrderReceiptLine (purchase_order_receipt_lines)
  ├─ id, receiptId → purchase_order_receipts (CASCADE)
  ├─ poLineId → purchase_order_lines (RESTRICT)
  └─ quantity (bigint)

PurchaseOrderPayment (purchase_order_payments)
  ├─ id, poId → purchase_orders (RESTRICT)
  ├─ amountMinor (bigint), method, paidAt
  ├─ idempotencyKey?                 (unique per company when present)
  └─ (base columns)

Expense (expenses)
  ├─ id, companyId, category, amountMinor (bigint), incurredAt, notes?, supplierId?
  └─ (base columns)                                   keyset: (incurredAt,id)

TaxSettings (tax_settings)                              ← D3
  ├─ companyId (PK/unique)
  ├─ vatRateBps (int, default 0)      basis points, e.g. 1400 = 14%
  ├─ vatRegistrationNumber?
  └─ updatedAt, updatedBy

Invoice (invoices)
  ├─ id, companyId, orderId? → orders (RESTRICT, nullable — manual invoices allowed)
  ├─ number                          (per-company sequence)
  ├─ subtotalMinor, vatMinor, totalMinor (bigint)
  ├─ vatRateBpsSnapshot (int)         frozen at issue time
  ├─ pdfGeneratedAt
  ├─ idempotencyKey?                 (unique per company when present)
  └─ (base columns)

InvoiceLine (invoice_lines)
  ├─ id, invoiceId → invoices (CASCADE)
  ├─ description, quantity, unitPriceMinor, lineTotalMinor
  └─ —

Refund (refunds)
  ├─ id, companyId, invoiceId? → invoices (RESTRICT), orderId? → orders (RESTRICT)
  ├─ amountMinor (bigint), reason
  ├─ idempotencyKey                  (NOT NULL, unique per company — mandatory)
  └─ (base columns)

ShippingReconciliation (shipping_reconciliations)
  ├─ id, companyId, carrier, statementRef, periodKey
  ├─ totalStatementMinor, totalFeeMinor, totalVarianceMinor (bigint)
  ├─ idempotencyKey?                 (unique per company when present)
  └─ (base columns)

ShippingReconciliationLine (shipping_reconciliation_lines)
  ├─ id, reconciliationId → shipping_reconciliations (CASCADE)
  ├─ shipmentId → shipments (RESTRICT)
  ├─ statementAmountMinor, shipmentFeeMinor, varianceMinor (bigint)
  └─ —

AccountingPeriod (accounting_periods)
  ├─ id, companyId, periodKey        (YYYY-MM, unique per company)
  ├─ status                          (open/closed)
  ├─ closedAt?, closedBy?
  └─ (base columns)
```

All tenant-editable tables: base columns + `FORCE` RLS by `company_id` +
`touch_updated_at`. Every `bigint minor-units` field follows api-conventions
§12.1 (no floats). PO receipt and invoice/refund/close writes always append an
`audit_log` row before emitting (ADR-0004).

## 6. Milestones

| ID    | Deliverable                                                                                                                                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M13.0 | This design doc + branch `feat/epic-13-finance`; decisions D1–D7 recorded.                                                                                                                                  |
| M13.1 | Prisma models + migration for all tables in §5; RLS, triggers, keyset indexes, checks; `finance.*` events added to the event catalog.                                                                       |
| M13.2 | `modules/finance` suppliers + purchase orders (domain/application/infrastructure/presentation): CRUD, atomic receipt (stock + `averageCost`), partial payments.                                             |
| M13.3 | Expenses + tax settings backend.                                                                                                                                                                            |
| M13.4 | Invoices (PDF via pdfkit, VAT) + refunds backend.                                                                                                                                                           |
| M13.5 | Shipping reconciliation + accounting periods (atomic sequential close, write-lock enforcement) + cash center/P&L read endpoints.                                                                            |
| M13.6 | `/v1/finance` presentation layer wiring for all of the above: DTOs, three-layer gating, unified errors, OpenAPI.                                                                                            |
| M13.7 | Finance surface in the Dual Shell: suppliers/POs, expenses, invoices (PDF download), refunds, reconciliation, period close, P&L dashboard.                                                                  |
| M13.8 | Docs + §2.5 gate: `api/finance.md` matched to delivered routes, `events.md`, `finance-domain.md`, retrospective, `epic-13-quality-gate.md`; `domain-map.md`/`project-metrics.md` refreshed; owner sign-off. |

## 7. Acceptance criteria

1. PO receipt is atomic: stock rises, `averageCost` rolls by the moving-average
   formula, `Idempotency-Key` replay moves no stock and issues no duplicate
   receipt.
2. Every money-moving write (payment, expense, invoice, refund) is integer
   minor units, `Idempotency-Key`-replayed where the contract requires it, and
   appends an `audit_log` row before its event.
3. An invoice issues a real PDF with VAT computed from `tax_settings`, frozen
   on the row at issue time.
4. A refund requires `Idempotency-Key` and is rejected without one.
5. A shipping reconciliation matches statement lines to shipments by tracking
   number and computes a correct signed variance, atomically.
6. Closing period _N_ fails if an earlier period with activity is still open;
   once closed, a dated write inside that period is rejected by every
   money-moving service.
7. Cash center / P&L numbers are computed from live source tables, verified
   equal to the sum of their inputs in tests (no drift).
8. Every route is three-layer gated (`finance.read`/`finance.manage`); tenant
   from token; RLS + repo scoping both hold (CI `database` job).
9. All local gates green from a cold cache; web bundle stays under budget.

## 8. Risks

| Risk                                                                                   | Mitigation                                                                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PO receipt racing an inventory-module adjustment on the same level                     | Same `SELECT … FOR UPDATE` row lock the orders module already reuses from EPIC-9 — one lock discipline, two callers      |
| `averageCost` drifting under concurrent partial receipts                               | Computed inside the same locked transaction as the stock raise, never a separate pass                                    |
| Closed-period bypass via a service that forgets the check                              | Centralize the period-open check in one shared helper every money-moving service calls before insert                     |
| PDF generation blocking the request thread                                             | pdfkit is synchronous but fast for these documents (single page, tabular) at this scale; revisit if invoice volume grows |
| Cash center double counting a source (e.g. a refunded invoice still summed as revenue) | Explicit sign convention per source in the aggregation query, unit-tested against known fixtures                         |

---

**Status:** decisions D1–D7 recorded 2026-08-01; this document is the M13.1
brief. [api/finance.md](api/finance.md) is updated to match as each milestone
lands.

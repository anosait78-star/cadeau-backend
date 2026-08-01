# Finance Domain Model (EPIC-13)

**Status:** ✅ Delivered — 2026-08-01 · Module:
[`apps/api/src/modules/finance`](../apps/api/src/modules/finance/) · Contract:
[api/finance.md](api/finance.md) · Design: [epic-13-design.md](epic-13-design.md) ·
Where it fits: [domain-map.md](domain-map.md).

Finance is the ledger that ties every other domain epic's money-moving and
physical facts together: suppliers you buy from, purchase orders that raise
stock and cost, unified expenses, official VAT invoices, refunds, a reconciled
view of shipping cost, and a period-close discipline that locks history.

---

## 1. Aggregates

Eight independent aggregates, no cross-aggregate transaction except the two
that are explicitly atomic by design (a PO receipt; a reconciliation batch):

```
Supplier            (reference entity)
PurchaseOrder        ── PurchaseOrderLine (owned)
                      ── PurchaseOrderReceipt ── PurchaseOrderReceiptLine (owned, append-only)
                      ── PurchaseOrderPayment (owned)
Expense              (reference entity, optional Supplier link)
TaxSettings          (one row per company)
Invoice               ── InvoiceLine (owned, append-only)
Refund                (references Invoice and/or Order, RESTRICT)
ShippingReconciliation ── ShippingReconciliationLine (owned, append-only, references Shipment RESTRICT)
AccountingPeriod      (one row per company × YYYY-MM)
```

## 2. Entities & fields (highlights)

| Field                                      | Notes                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `PurchaseOrderLine.unitCost`               | Frozen at PO-create time; the receipt reads it to roll `averageCost` — never re-derived later.             |
| `PurchaseOrderLine.quantityReceived`       | Running total; a receipt can be partial, PO status tracks `partially_received`→`received`.                 |
| `PurchaseOrderReceipt.warehouseId`         | Pinned (`RESTRICT`) — a receipt always raises stock in a specific warehouse.                               |
| `Invoice.vatRateBpsSnapshot`               | Frozen at issue time from `TaxSettings.vatRateBps` — a later rate change never rewrites a past invoice.    |
| `Invoice.orderId`                          | Nullable, `RESTRICT` — manual (no-order) invoices are allowed.                                             |
| `Refund.idempotencyKey`                    | **`NOT NULL`** — the one mandatory idempotency key in this codebase (every other write's key is optional). |
| `ShippingReconciliationLine.varianceMinor` | `= statementAmountMinor − shipmentFeeMinor`, DB-CHECK-enforced at both the line and header level.          |
| `AccountingPeriod.periodKey`               | `YYYY-MM`, unique per company; string-sortable, so `<`/`>` comparisons work directly in SQL.               |

All tenant-editable tables: base columns + `FORCE` RLS by `company_id` +
`touch_updated_at`. Append-only child rows (`PurchaseOrderReceiptLine`,
`InvoiceLine`, `ShippingReconciliationLine`) follow the `audit_log`
SELECT/INSERT-only RLS pattern — no `UPDATE`/`DELETE` policy exists, so those
commands are denied at the database for everyone, not just guarded in code.

## 3. Invariants

| #   | Invariant                                                               | Enforced by                                                                                  |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| I1  | A PO receipt raises stock and rolls `averageCost` atomically            | One transaction: `SELECT … FOR UPDATE` on the variant + stock level, then both writes        |
| I2  | `averageCost` follows the moving-average formula exactly (D7)           | `newAvg = floor((onHandBefore·avgBefore + qty·unitCost) / (onHandBefore+qty))`               |
| I3  | A receipt can never over-receive a line                                 | `quantity_received <= quantity_ordered` CHECK + application guard                            |
| I4  | VAT is computed once, frozen at invoice-issue time                      | `vatRateBpsSnapshot` column; round-half-up, integer-only (`domain/vat.ts`)                   |
| I5  | `invoices_total_check` always holds                                     | `totalMinor = subtotalMinor + vatMinor`, DB CHECK, never trusted from the client             |
| I6  | A refund is always idempotency-replayable, never silently duplicated    | `idempotencyKey` `NOT NULL` + unique per company; missing header is a `400`, pre-repo        |
| I7  | A reconciliation batch is all-or-nothing                                | One bad `trackingNumber` fails the whole batch — same bulk discipline as EPIC-11/12          |
| I8  | A period can only close if every earlier period with activity is closed | `PeriodSequenceGapError` (`409`) — any earlier `status='open'` row for the company blocks it |
| I9  | Once closed, a period accepts no new dated money-moving write           | `assertPeriodOpen` — called first in every finance write's transaction, `409` if closed      |
| I10 | Money stays integer minor units end to end                              | Same discipline as orders/shipping — no float ever touches an amount column                  |

## 4. The period-close write guard (D4)

Every dated money-moving write (expense create/update, invoice issue, refund
issue, PO payment — reconciliation and PO receipt use write-time) calls
`assertPeriodOpen(tx, companyId, date)` at the top of its transaction:

1. Look up `accounting_periods` for `(companyId, YYYY-MM(date))`.
2. If it exists and is `closed` → `PeriodClosedError` (`409`).
3. If no row exists yet → upsert one as `open` (so the row exists for
   `closePeriod`'s sequential check to inspect later).

`POST /v1/finance/periods/{period}/close` then locks any existing row,
rejects if an **earlier** period for the company is still `open`
(`PeriodSequenceGapError`), and flips this one to `closed`. The simplification
(documented in the code): no "has activity" vs. "has an open row" distinction
is needed, because a row only ever exists once something touched it.

## 5. Purchase-order receipt, in one transaction

```
lock PurchaseOrder + its lines (FOR UPDATE)
for each receipt line:
  lock the variant row + the (warehouse, variant) stock level (FOR UPDATE)
  raise inventory_stock.on_hand by the received quantity
  roll product_variants.average_cost (moving average, I2)
  insert one stock_adjustments row (reason = 'purchase_receipt')
  raise PurchaseOrderLine.quantityReceived
advance PurchaseOrder.status (partially_received | received)
insert PurchaseOrderReceipt + its receipt lines
audit purchase_order.received → emit purchase_order.received
```

Reuses the exact `SELECT … FOR UPDATE` level-lock discipline the `orders`
module already reuses from EPIC-9 — one locking pattern, three callers.

## 6. Cash center & P&L (D6 — computed, not a ledger)

Both `/v1/finance/reports/*` endpoints are pure reads: `SUM(...)` over the
relevant existing table for the requested date range, no new table, no cache.

| Report field                 | Source                                                           | Note                                                 |
| ---------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| `collectedMinor`             | `SUM(orders.collectedAmount)` by `orders.updatedAt`              | Documented approximation — not per-collection-event  |
| `expensesMinor`              | `SUM(expenses.amountMinor)` by `incurredAt`                      | Exact                                                |
| `purchaseOrderPaymentsMinor` | `SUM(purchase_order_payments.amountMinor)` by `paidAt`           | Exact                                                |
| `refundsMinor`               | `SUM(refunds.amountMinor)` by `createdAt`                        | Exact                                                |
| `shippingFeesMinor`          | `SUM(shipments.fee)` by `deliveredAt`                            | Only delivered shipments carry a real fee event      |
| `revenueMinor` (P&L)         | `SUM(invoices.subtotalMinor)` by `invoices.createdAt`            | Invoices are this epic's owned billed-revenue record |
| `cogsMinor` (P&L)            | `SUM(order_items.costSnapshot × quantity)` by `orders.createdAt` | Documented approximation — precise timing is EPIC-14 |

`netCashMinor` / `netIncomeMinor` are simple signed sums of the above. A
`compareFrom`/`compareTo` range on `/reports/pnl` runs the identical
computation over a second window.

## 7. Boundaries

- **Consumes** products (`averageCost` write path, D7), inventory
  (`inventory_stock`/`stock_adjustments`, same lock discipline as EPIC-9),
  orders (`collectedAmount`, `order_items.costSnapshot`, pinned FK on
  `Invoice`/`Refund`), shipping (`shipments.fee`/`trackingNumber`, pinned FK
  on `ShippingReconciliationLine`), the EPIC-5 access catalog (`finance`
  feature, `read`/`manage` only — D2), the EPIC-6 event bus, `audit_log`.
- **Owns** `suppliers`, `purchase_order_sequences`, `purchase_orders`,
  `purchase_order_lines`, `purchase_order_receipts`,
  `purchase_order_receipt_lines`, `purchase_order_payments`, `expenses`,
  `tax_settings`, `invoice_sequences`, `invoices`, `invoice_lines`, `refunds`,
  `shipping_reconciliations`, `shipping_reconciliation_lines`,
  `accounting_periods` — 16 tables.
- **Is consumed by** EPIC-14 (analytics reads across finance for the
  business/profitability axes), EPIC-16 (launch gate).

## 8. Layering

`domain` (`finance.entity.ts` views, `finance.errors.ts`, `list-query.ts`,
`vat.ts` — pure round-half-up VAT, `finance-repository.port.ts`,
`finance-audit.port.ts`, `invoice-pdf.port.ts`) ← `application`
(`FinanceService` — tenant enforcement, `assertPeriodOpen`-driven guards,
audit-then-emit, orchestrates the PDF port) ← `infrastructure`
(`FinanceRepository` — every atomic transaction; `PdfKitInvoiceRenderer` —
the `pdfkit` adapter behind `InvoicePdfRendererPort`; `FinanceAuditLogAdapter`)
· `presentation` (nine controllers — `Suppliers`, `PurchaseOrders`,
`Expenses`, `TaxSettings`, `Invoices`, `Refunds`, `Reconciliations`,
`Periods`, `Reports` — + DTOs). Dependencies point inward only: the PDF
renderer is reached through `InvoicePdfRendererPort`, never imported directly
by `application` or `presentation` (`arch:check` enforces this — see the
[quality gate](epic-13-quality-gate.md) §2 for the violation this caught and
fixed during the build).

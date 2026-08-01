# Finance & Compliance API Contract

**Status:** ✅ **Delivered** in **EPIC-13** · **Base path:** `/v1/finance` ·
**Feature key:** `finance` · **Access:** authenticated + gated
(`finance.read` / `finance.manage` — D2)

Suppliers & purchase orders (partial pay/receive; atomic receipt raises stock
and rolls `product_variants.averageCost`), unified expenses, configurable VAT,
official invoices as real PDFs, refunds, working shipping reconciliation, an
atomic sequential monthly close, and computed cash-center/P&L reports. Design:
[../epic-13-design.md](../epic-13-design.md) (decisions D1–D7). Follows
[../api-conventions.md](../api-conventions.md).

## Resources

- `Supplier`, `PurchaseOrder` (+ `PurchaseOrderLine`/`PurchaseOrderReceipt`/
  `PurchaseOrderPayment`), `Expense`, `TaxSettings`, `Invoice` (+
  `InvoiceLine`), `Refund`, `ShippingReconciliation` (+ `...Line`),
  `AccountingPeriod`.

## Delivered endpoints

| Method | Path                                        | Purpose                                                                            | Permission       |
| ------ | ------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------- |
| GET    | `/v1/finance/suppliers`                     | List suppliers (keyset, `q`, `active`).                                            | `finance.read`   |
| GET    | `/v1/finance/suppliers/{id}`                | Supplier detail.                                                                   | `finance.read`   |
| POST   | `/v1/finance/suppliers`                     | Create a supplier.                                                                 | `finance.manage` |
| PATCH  | `/v1/finance/suppliers/{id}`                | Update a supplier.                                                                 | `finance.manage` |
| DELETE | `/v1/finance/suppliers/{id}`                | Soft-archive (`isActive=false`).                                                   | `finance.manage` |
| GET    | `/v1/finance/purchase-orders`               | List POs (keyset; `status`, `supplierId`, `dateFrom/To`).                          | `finance.read`   |
| GET    | `/v1/finance/purchase-orders/{id}`          | PO detail with lines.                                                              | `finance.read`   |
| POST   | `/v1/finance/purchase-orders`               | Create a PO with lines. `Idempotency-Key`.                                         | `finance.manage` |
| POST   | `/v1/finance/purchase-orders/{id}/receipts` | Atomic receipt — raises stock, rolls `averageCost`. `Idempotency-Key`.             | `finance.manage` |
| POST   | `/v1/finance/purchase-orders/{id}/payments` | Record a (partial) payment. `Idempotency-Key`.                                     | `finance.manage` |
| GET    | `/v1/finance/expenses`                      | List expenses (keyset; `category`, `supplierId`, `dateFrom/To`).                   | `finance.read`   |
| GET    | `/v1/finance/expenses/{id}`                 | Expense detail.                                                                    | `finance.read`   |
| POST   | `/v1/finance/expenses`                      | Create an expense. `Idempotency-Key`.                                              | `finance.manage` |
| PATCH  | `/v1/finance/expenses/{id}`                 | Update an expense (rejected if its period is closed).                              | `finance.manage` |
| GET    | `/v1/finance/tax-settings`                  | Read the company's VAT config (lazily created at zero rate).                       | `finance.read`   |
| PATCH  | `/v1/finance/tax-settings`                  | Update `vatRateBps` / `vatRegistrationNumber`.                                     | `finance.manage` |
| GET    | `/v1/finance/invoices`                      | List invoices (keyset; `orderId`, `dateFrom/To`).                                  | `finance.read`   |
| GET    | `/v1/finance/invoices/{id}`                 | Invoice detail with lines.                                                         | `finance.read`   |
| POST   | `/v1/finance/invoices`                      | Issue an invoice (order-derived or manual lines). `Idempotency-Key`.               | `finance.manage` |
| GET    | `/v1/finance/invoices/{id}/pdf`             | Stream the official invoice PDF (pdfkit, D1).                                      | `finance.read`   |
| GET    | `/v1/finance/refunds`                       | List refunds (keyset; `invoiceId`, `orderId`, `dateFrom/To`).                      | `finance.read`   |
| POST   | `/v1/finance/refunds`                       | Issue a refund. **`Idempotency-Key` mandatory** (`400` without one).               | `finance.manage` |
| GET    | `/v1/finance/reconciliations`               | List reconciliations (keyset; `carrier`, `periodKey`).                             | `finance.read`   |
| GET    | `/v1/finance/reconciliations/{id}`          | Reconciliation detail with lines.                                                  | `finance.read`   |
| POST   | `/v1/finance/reconciliations`               | Atomic, all-or-nothing statement-line match by tracking number. `Idempotency-Key`. | `finance.manage` |
| GET    | `/v1/finance/periods`                       | List the company's accounting periods.                                             | `finance.read`   |
| POST   | `/v1/finance/periods/{period}/close`        | Atomic sequential close (`period` = `YYYY-MM`). `Idempotency-Key`.                 | `finance.manage` |
| GET    | `/v1/finance/reports/cash-center`           | Computed cash-center summary over `dateFrom`/`dateTo`.                             | `finance.read`   |
| GET    | `/v1/finance/reports/pnl`                   | Computed P&L, optional `compareFrom`/`compareTo`.                                  | `finance.read`   |

30 routes total.

## List parameters

- Keyset pagination throughout (api-conventions §5) — no OFFSET anywhere.
- Filters per resource: see the table above. `suppliers`, `purchase-orders`,
  and `expenses` accept a whitelisted `?sort=` (e.g. `-name`, `-createdAt`,
  `-incurredAt` for expenses); `invoices`, `refunds`, and `reconciliations`
  have one fixed sort (`-createdAt`) with no `?sort=` param, since no UI need
  for reordering those lists exists yet.

## Events emitted (ADR-0004, audit-then-emit)

- `purchase_order.received`, `payment.recorded`, `invoice.issued`,
  `refund.issued`, `period.closed`. Expenses, tax-settings, and shipping
  reconciliation writes are audited but emit no event (not in the original
  event list; consistent with how `customer.exported` is the only EPIC-10
  event, not every write).

## Notes

- Money is **integer minor units + currency** (conventions §12.1); no floats.
  VAT rounds half-up to the minor unit (`domain/vat.ts`).
- PO receipt, invoice issue, refund issue, reconciliation create, and period
  close are all **atomic** (single DB transaction); close is additionally
  **sequential** — an earlier open period with activity blocks a later close
  (D4).
- Refunds are the only endpoint with a **mandatory** `Idempotency-Key`; every
  other write accepts it optionally and replays on a repeat.
- **Permission model (D2, deviation from the draft):** `finance.read` /
  `finance.manage` only — no `finance.refund`/`finance.close`. Matches the
  EPIC-8 products precedent (draft `.write` → delivered `read`/`manage`).
  Money-moving safety comes from mandatory idempotency + a distinct
  `audit_log.action` per operation, not a bespoke permission key.
- **Period-close write guard:** every dated money-moving write
  (`assertPeriodOpen`) touches its `YYYY-MM` accounting period into existence
  as `open` if none exists yet, and rejects (`409`) if that period is
  `closed`. This is how `POST /periods/{period}/close`'s sequential check has
  rows to inspect.
- **Cash center / P&L are computed reads (D6)** — summed directly from
  `orders`, `expenses`, `purchase_order_payments`, `refunds`, `shipments`,
  `invoices`, and `order_items` at request time; no ledger table. Documented
  approximations: `collectedMinor` sums `orders.collectedAmount` by
  `orders.updatedAt` (not a per-collection-event figure); `cogsMinor` sums
  `order_items.costSnapshot × quantity` by `orders.createdAt`. Precise
  per-event timing is EPIC-14's job.

## Deviations from the original draft

- `finance.refund` / `finance.close` permissions were never added — D2.
- `invoices`/`refunds`/`reconciliations` lists have one fixed sort, not a
  free-form `?sort=` — no UI need for reordering those lists yet.
- `POST /v1/finance/reconciliations` takes `{ carrier, statementRef,
periodKey, lines[] }` in one call rather than a separate "reconcile a
  carrier statement" flow per line — atomic batch, same discipline as
  EPIC-11/12 bulk endpoints.

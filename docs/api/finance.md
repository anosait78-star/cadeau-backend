# Finance & Compliance API Contract

**Status:** ⬜ Draft — planned in **EPIC-13** · **Base path:** `/v1/finance` ·
**Feature key:** `FINANCE` · **Access:** authenticated + gated

Suppliers & purchase orders (partial pay/receive; atomic receipt raises stock),
unified expenses, official PDF invoices, configurable VAT, refunds, working
shipping reconciliation, an atomic sequential monthly close, and P&L. Draft —
follows [../api-conventions.md](../api-conventions.md).

## Resources

- `Supplier`, `PurchaseOrder` (+ receipts/payments), `Expense`, `Invoice`,
  `Refund`, `ShippingReconciliation`, `AccountingPeriod`, `ProfitAndLoss`.

## Planned endpoints

| Method   | Path                                          | Purpose                                           | Permission                       |
| -------- | --------------------------------------------- | ------------------------------------------------- | -------------------------------- |
| GET      | `/v1/finance/suppliers`                       | List suppliers.                                   | `finance.read`                   |
| POST     | `/v1/finance/purchase-orders`                 | Create a PO. Idempotency-Key.                     | `finance.write`                  |
| POST     | `/v1/finance/purchase-orders/{poId}/receipts` | Receive (atomic; raises stock). Idempotency-Key.  | `finance.write`                  |
| POST     | `/v1/finance/purchase-orders/{poId}/payments` | Record a (partial) payment. Idempotency-Key.      | `finance.write`                  |
| GET/POST | `/v1/finance/expenses`                        | List / add expenses.                              | `finance.read` / `finance.write` |
| POST     | `/v1/finance/invoices`                        | Issue an official invoice (PDF). Idempotency-Key. | `finance.write`                  |
| POST     | `/v1/finance/refunds`                         | Issue a refund. **Idempotency-Key required.**     | `finance.refund`                 |
| POST     | `/v1/finance/reconciliations`                 | Reconcile a carrier statement.                    | `finance.manage`                 |
| POST     | `/v1/finance/periods/{period}/close`          | Atomic sequential monthly close. Idempotency-Key. | `finance.close`                  |
| GET      | `/v1/finance/reports/pnl`                     | P&L + period comparison.                          | `finance.read`                   |

## List parameters

- Filter: `dateFrom/To`, `status`, `supplierId`, `type`; sort (whitelist): `-createdAt,id`, `-amount`.

## Events emitted (ADR-004)

- `purchase_order.received`, `payment.recorded`, `invoice.issued`, `refund.issued`, `period.closed`.

## Notes

- Money is **integer minor units + currency** (conventions §12.1); no floats.
- PO receipt and monthly close are **atomic** and, for close, **sequential** (no gaps).
- Refunds and closes are money-moving → idempotency-key mandatory; all audited.

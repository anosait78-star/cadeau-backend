# EPIC-13 Retrospective — Finance & Compliance

**Epic:** EPIC-13 Finance & Compliance · **Branch:** `feat/epic-13-finance` ·
**Closed:** 2026-08-01 · Gate: [epic-13-quality-gate.md](epic-13-quality-gate.md).

---

## 1. What shipped

The ledger that ties every prior domain epic's money-moving and physical
facts together: suppliers and purchase orders with an atomic receipt that
raises stock and rolls `product_variants.averageCost`, unified expenses,
configurable VAT, official invoices as real PDFs (`pdfkit`), refunds,
shipping-statement reconciliation against `Shipment.fee`, an atomic
sequential monthly close, and computed cash-center/P&L reports — plus the
full suppliers/POs/expenses/invoices/refunds/reconciliation/periods/reports
surface in the Dual Shell.

## 2. Milestones

- **M13.0** — design doc + branch; decisions D1–D7 recorded.
- **M13.1** — `20260809000000_finance`: 16 tables, RLS, triggers, keyset
  indexes, checks; 5 events added to the closed catalog.
- **M13.2** — `modules/finance` suppliers + purchase orders: CRUD, atomic
  receipt (stock + `averageCost`), partial payments.
- **M13.3** — expenses + tax settings; introduced `assertPeriodOpen`, the
  D4 write guard every later milestone reuses.
- **M13.4** — invoices (PDF/VAT) + refunds; added the `pdfkit` dependency.
- **M13.5** — shipping reconciliation + accounting-period close + cash
  center/P&L computed reads.
- **M13.6** — `/v1/finance` presentation layer (shipped incrementally with
  M13.2–M13.5, not a separate commit).
- **M13.7** — the finance surface in the Dual Shell (8 tabs).
- **M13.8** — docs + the §2.5 gate, including a mid-build architecture fix
  and two coverage top-up passes (§4, §6 below).

## 3. What went well

- **The D1–D7 decisions up front** (mirroring EPIC-12's D1–D4 pattern) kept
  nine resources' worth of build unambiguous — in particular D2 (read/manage
  only, no bespoke `finance.refund`/`finance.close` permission) avoided a
  manual access-catalog edit outside the generator, and D6 (computed reads,
  no new ledger) avoided a second money-truth table that could drift from
  orders/expenses/PO-payments/refunds.
- **Reusing the EPIC-9 `SELECT … FOR UPDATE` locking discipline** for the PO
  receipt meant no new concurrency primitive was invented — the third caller
  of a pattern orders already established as the second.
- **One shared `FinanceRepository`/`FinanceService`/`FinanceModule`** across
  all nine resources kept the tenant-transaction, idempotency, and
  audit-then-emit plumbing in one place instead of duplicated nine times —
  each milestone extended the same files rather than standing up a parallel
  structure, which kept the module coherent even though it was built across
  five separate agent-delegated passes.
- **`assertPeriodOpen`'s upsert-into-existence design** (M13.3, extended in
  M13.5) meant the sequential-close check never needed a second data source —
  every dated write already leaves a trail of `open` period rows for
  `closePeriod` to inspect.

## 4. What was hard / friction

- **A real architecture-layering violation shipped and was only caught by
  `arch:check` at gate time**, not during the milestone that introduced it:
  the invoice-PDF endpoint imported the `pdfkit` renderer straight into the
  controller (M13.4), and once moved to the service layer, straight into the
  service too. Both violate "dependencies point inward only." The correct
  fix — a proper `InvoicePdfRendererPort`/adapter pair — took a second pass
  at gate time. Lesson: `arch:check` should run as part of each milestone's
  own verification, not deferred to the closing gate, for any milestone that
  adds a new external-library adapter (this one added `pdfkit`, the module's
  only new runtime dependency).
- **Package-wide coverage thresholds broke twice** — `apps/api` branches
  (85%) and `apps/web` functions (75%) — purely from the module's size, not
  from any single milestone being under-tested by its own local bar. Each
  milestone's own tests were dense and passed in isolation; the aggregate
  crossed the line only once all nine resources' worth of code existed
  side by side. Two dedicated top-up passes closed the gap (+95 API tests,
  +32 web tests) without touching either threshold. Lesson: for an epic this
  size, check the package-wide coverage number after every 2–3 milestones,
  not only at the end.
- **No local Postgres was available in this environment** (no Docker), so
  the M13.1 migration was hand-written to mirror EPIC-12's exact conventions
  rather than machine-generated via `prisma migrate dev` against a shadow
  database. It validates and the Prisma Client generates cleanly against it,
  but CI's `database` job (real Postgres) is the first true application of
  this migration and needs first-run attention.

## 5. Deviations (all documented)

- `finance.refund` / `finance.close` permissions were never added (D2).
- Cash center / P&L use documented approximations for `collectedMinor` and
  `cogsMinor` (D6) — precise per-event timing is EPIC-14.
- PO receipt in the frontend simplifies to "receive the full remaining
  quantity into one warehouse" — no per-line quantity picker in the UI yet.
- Multi-currency accounting, a general ledger, automated carrier-statement
  ingestion, and tax-authority e-invoicing are out of scope (design §3).

## 6. Debt carried into later epics

| Item                                                                                        | Lands in                        |
| ------------------------------------------------------------------------------------------- | ------------------------------- |
| Per-line partial-quantity picker on the PO-receive UI                                       | P1 / later                      |
| Precise per-event `collectedMinor`/`cogsMinor` (a real payment/COGS event ledger)           | EPIC-14                         |
| Automated carrier-statement ingestion (CSV/API import)                                      | P1 / later                      |
| A general ledger / double-entry table, if ever needed                                       | later, only if D6 stops holding |
| Tax filing / e-invoicing government integration                                             | later, platform-tier dependent  |
| `arch:check` as a required step in each milestone's own local gate, not just the epic close | process change, next epic       |

## 7. Metrics snapshot (at close)

- Tests: **1405** (config 43 · crypto 47 · database 71 · web 160 · api 1084)
  — up from 1058.
- Web bundle: 167.6 KB gzip / 200 KB budget.
- New API routes: 30 (`/v1/finance/*`).
- New tables: 16.
- New events: 5 (`purchase_order.received`, `payment.recorded`,
  `invoice.issued`, `refund.issued`, `period.closed`).
- New runtime dependency: `pdfkit` (+ `@types/pdfkit` dev).
- `arch:check`: 556 modules, 1538 dependencies, 0 violations.

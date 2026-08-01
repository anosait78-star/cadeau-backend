# EPIC-13 Quality Gate (§2.5) — Finance & Compliance

**Epic:** EPIC-13 Finance & Compliance · **Branch:** `feat/epic-13-finance` ·
**Commits:** `b0a450a` (M13.0) · `beb896d` (M13.1) · `76e506e` (M13.2) ·
`7e9105e` (M13.3) · `bcdfec0` (M13.4) · `0835923` (M13.5) · `2590675` (M13.7)
· `d8540b7` (arch + coverage fix) · `589010c` (web coverage fix) · this doc
(M13.8) · **Gate run:** 2026-08-01.

M13.6 (`/v1/finance` presentation layer) shipped incrementally with each
backend milestone's own controllers rather than as a separate commit — every
route landed already OpenAPI-decorated, DTO-validated, and gated.

The mandatory post-epic quality gate: Security · Architecture · Code · Testing
· Performance · API/Contract · Documentation · Extensibility · AI-out — plus
**owner approval**. No new epic starts until every dimension passes and the
owner signs off.

---

## 0. Gate summary

| Dimension         | Result  | Note                                                                                                                                                    |
| ----------------- | :-----: | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security          | ✅ PASS | Three-layer gated (`finance.read`/`finance.manage`); tenant from token; RLS + repo scoping; no PII in audit/events                                      |
| Architecture      | ✅ PASS | Clean 4-layer module; `InvoicePdfRendererPort` isolates `pdfkit`; deps inward; `arch:check` 0 violations (one violation found and fixed mid-build — §2) |
| Code              | ✅ PASS | Strict TS, no `any`; money identity + period-close guard + receipt locking enforced in DB and types                                                     |
| Testing           | ✅ PASS | 1405 unit/integration green from a cold cache; branch/function coverage thresholds met after two targeted top-up passes (§4)                            |
| Performance       | ✅ PASS | Uniqueness/lookup/keyset indexes throughout; PO receipt reuses the EPIC-9 row-lock discipline; web bundle 167.6 KB / 200 KB gzip                        |
| API / Contract    | ✅ PASS | [api/finance.md](api/finance.md) matches the 30 delivered routes                                                                                        |
| Documentation     | ✅ PASS | design, contract, domain, retrospective, this gate; events/domain-map/metrics/execution-plan refreshed                                                  |
| Extensibility     | ✅ PASS | Emits through the EPIC-6 bus; `InvoicePdfRendererPort` additive for a future renderer; no new cross-cutting seam                                        |
| AI-out (ADR-0004) | ✅ PASS | No AI dependency in this module; `no-ai-imports` guard green                                                                                            |

**Local gates (this run, cold cache):** `format:check` ✅ · `lint` ✅ ·
`type-check` ✅ (8/8) · `test` ✅ **1405 passed** (config 43 · crypto 47 ·
database 71 · web 160 · api 1084) · `build` ✅ · `arch:check` ✅ (556 modules,
1538 deps, 0 violations) · `audit --audit-level high` ✅ (0 high/critical; 1
pre-existing moderate, under the gate threshold — `pdfkit`/`@types/pdfkit`
introduced no new advisory) · `perf:bundle` ✅ (`@cadeau/web` 167.6 KB / 200 KB
gzip).

**CI-only gates:** `database` (migrations + RLS on real Postgres), `e2e`
(Playwright desktop+mobile + axe), `performance` (Lighthouse), `api-load`
(k6), `sast`, secret-scan — run on push/PR to `main`. This epic adds one large
migration (16 tables) and a UI surface, so `database`/`e2e`/`performance`
produce fresh evidence there; they cannot run on this workstation (no
Docker/browser/k6 — flagged explicitly in the M13.1 commit message).

---

## 1. Security

- Every route is three-layer gated (`finance.read` / `finance.manage`); the
  tenant comes from the token, never the payload (ADR-0003). No route accepts
  `companyId` from the client.
- Every tenant table (16 new ones) carries `FORCE` RLS by `company_id`.
  Append-only child tables (`purchase_order_receipt_lines`, `invoice_lines`,
  `shipping_reconciliation_lines`) additionally deny `UPDATE`/`DELETE` for
  everyone at the database — no permissive policy exists for those commands
  (same pattern as `audit_log`).
- **No PII in audit/events.** `purchase_order.received` /
  `payment.recorded` / `invoice.issued` / `refund.issued` / `period.closed`
  payloads carry ids and amounts only — never a supplier/customer name,
  address, or tax id.
- Refunds — the only money-out, irreversible-by-design write in this epic —
  require `Idempotency-Key`, rejected with `400` before the repository is
  ever reached if absent (`MissingIdempotencyKeyError`).

## 2. Architecture

- `modules/finance/{domain,application,infrastructure,presentation}` with
  dependencies pointing inward; data access only in `infrastructure`.
- **A real violation was caught and fixed during this build**, not before: an
  early cut of `POST /v1/finance/invoices/{id}/pdf` had the presentation-layer
  controller import `infrastructure/invoice-pdf.renderer.ts` directly (to
  avoid touching the shared `finance.repository.ts`). `arch:check` failed on
  `layer-presentation-no-infrastructure`. The fix moved the call into
  `FinanceService`, which then also failed `layer-application-no-outer` —
  the correct fix was a proper port: `InvoicePdfRendererPort` (domain) /
  `PdfKitInvoiceRenderer` (infrastructure adapter), DI-wired in
  `finance.module.ts`, mirroring the existing `FinanceAuditPort` precedent.
  `arch:check` is green with 0 violations as of the `d8540b7` commit.
- One shared `FinanceRepository`/`FinanceService`/`FinanceModule` across all
  nine resources (not nine separate repositories) — deliberate, since every
  resource shares the same tenant-transaction, idempotency, and
  audit-then-emit discipline; splitting would have meant either duplicating
  that plumbing nine times or inventing a shared base class this codebase
  doesn't otherwise use.

## 3. Code

- Strict TypeScript, no `any`. Money is `bigint` end to end; VAT rounds
  half-up via a pure, exhaustively-tested function (`domain/vat.ts`).
- The PO-receipt atomic transaction, the period-close sequential check, and
  the reconciliation all-or-nothing batch are each covered by dedicated
  edge-case tests (lock races, idempotency replay, partial failure).

## 4. Testing

1405 tests green from a cold cache (from 1058 at EPIC-12 close): +204 in
`modules/finance` across its build, +~95 more in a targeted coverage top-up
(idempotency races, list-query filter combinations, error-mapping branches),
+18 in `apps/web/src/pages/finance` plus +32 more in a second coverage
top-up. Two gate-driven top-up passes were needed because the module's size
pulled package-wide coverage below the `apps/api` branches (85%) and
`apps/web` functions (75%) thresholds on the first full run — both closed
without touching either `vitest.config.ts` (§6 lists this as friction, not a
deviation: the thresholds were never weakened). DB/RLS and e2e run in CI.

## 5. Performance

PO receipt raises stock via the exact `SELECT … FOR UPDATE` level-lock
EPIC-9/EPIC-11 already established — no new locking primitive. Every list is
keyset-paginated (api-conventions §5); `suppliers`/`purchase-orders` support a
whitelisted `?sort=`. Cash-center/P&L reads are direct `SUM(...)` aggregate
queries scoped by `companyId` and the date range — no caching layer added
(D6: computed reads are cheap enough at this scale; revisit if invoice/expense
volume grows). Web bundle 167.6 KB gzip, under the 200 KB budget.

## 6. Deviations (all recorded in the design doc / contract)

- `finance.refund` / `finance.close` permissions were never added — `finance.
read`/`finance.manage` only (D2), matching the EPIC-8 products precedent.
- Cash center / P&L use documented approximations for `collectedMinor`
  (by `orders.updatedAt`, not per-collection-event) and `cogsMinor` (by
  `orders.createdAt`) — D6 explicitly defers precise per-event timing to
  EPIC-14.
- PO receipt in the frontend simplifies to "receive the full remaining
  quantity of every line into one warehouse" — no per-line partial-quantity
  picker in the UI (the API supports partial receipt; the UI doesn't expose
  it yet).
- Multi-currency accounting, a general ledger, automated carrier-statement
  ingestion, and tax-authority e-invoicing integration are all explicitly out
  of scope (design doc §3).

---

## 7. Owner approval

> **Status:** ✅ **Signed off.** EPIC-13 is **CLOSED**. See execution-plan §0
> for the closure line, exactly as EPIC-8 through EPIC-12 were closed.

| Reviewer | Role  | Decision    | Date       |
| -------- | ----- | ----------- | ---------- |
| Owner    | Owner | ✅ Approved | 2026-08-01 |

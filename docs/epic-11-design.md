# EPIC-11 Design — Orders

**Status:** ✅ **Delivered on `feat/epic-11-orders`** — gate:
[epic-11-quality-gate.md](epic-11-quality-gate.md). · Decisions D1–D6 answered
by the owner on **2026-07-31** (before code). · **Drafted:** 2026-07-31.

This document fixes the **scope, boundaries, decisions and acceptance criteria** of
EPIC-11 — the core of the system. Contract: [api/orders.md](api/orders.md). How it
fits: [domain-map.md](domain-map.md). It also discharges the EPIC-10 debt that was
deferred until orders exist ([customers-domain.md](customers-domain.md) §8).

---

## 1. Goal

The order is where every other module pays off: a customer (EPIC-10), a set of
product variants (EPIC-8), a warehouse commitment (EPIC-9), a label/reason
(EPIC-7), an assignee (EPIC-4/5), and a COD `collectedAmount` that ultimately feeds
finance (EPIC-13) and analytics (EPIC-14). EPIC-11 delivers the **12-state
lifecycle plus a separate follow-up state**, keyset lists with saved filters and
deep-linking, inline + bulk status/assign, a side detail panel with a full activity
log, deterministic smart-paste (Regex/Heuristics — **no AI**, ADR-0004), and
Excel/CSV import with column mapping.

## 2. In scope

- **Order** — header (number, customer, assignee, status, follow-up state,
  label, reason, governorate, shipping/discount, `collectedAmount`, `paymentStatus`)
  - items + activity log.
- **OrderItem** — a variant line with `quantity`, unit `price`, and a `costSnapshot`
  (the variant's `averageCost` at the time the line was added — frozen for COGS).
- **OrderActivity** — the append-only per-order activity/audit log (who, when,
  from→to, kind).
- **12-state lifecycle + follow-up state** — a fixed default state machine now,
  configurable per company in a later pass (P1); illegal transitions → `422`.
- **Stock coupling (D2)** — entering `processing` reserves stock via EPIC-9;
  `shipped` decrements on-hand; `cancelled`/`returned` before shipping release the
  reservation. **Feature-gated:** only when the company's `inventory` feature is on.
- **Customer KPIs (D3)** — `ordersCount` / `totalSpent` / `lastOrderAt` recomputed
  **in the same transaction** as the order write. This discharges the EPIC-10 debt.
- **Customer merge (D5)** — `POST /v1/customers/merge`, one atomic audited
  transaction re-parenting **every** customer-owned table, with a guard test that
  fails if a new one is added without updating the merge. Emits `customer.merged`.
- **CRUD + keyset list** — filters, whitelisted sorts, `q`, deep-linking; status
  tabs with live counts.
- **Bulk** — bulk status and bulk assign, atomic per item, per-item results.
- **Smart-paste** — `POST /v1/orders/parse`, deterministic Regex/Heuristics → draft
  fields (M11.5).
- **Import** — `POST /v1/orders/import`, Excel/CSV with column mapping, per-row
  results (M11.5).
- **Frontend** — a capability-gated Orders screen in the Dual Shell (list, tabs,
  dual view, side panel, inline/bulk actions, create/edit, paste, import).
- **Events** — `order.created`, `order.status_changed`, `order.assigned`,
  `payment.collected`, and the reserved `customer.merged`.

## 3. Explicitly out of scope

| Not in EPIC-11                                    | Why / where                                                     |
| ------------------------------------------------- | --------------------------------------------------------------- |
| Shipping carrier integration / waybills           | EPIC-12                                                         |
| Official PDF invoices, VAT, refunds, PO receipts  | EPIC-13                                                         |
| Return-to-stock on a post-shipment return         | Manual inventory adjustment in EPIC-11; automated in EPIC-12/13 |
| Analytics axes over orders                        | EPIC-14                                                         |
| Customer/end-user WhatsApp/SMS on status change   | EPIC-15                                                         |
| Per-company **editing** of the state machine (UI) | P1 — the engine is data-driven now; the editor ships later      |
| Automatic duplicate-order detection / dedupe      | Future, additive                                                |

## 4. Decisions — answered by the owner, 2026-07-31

| #   | Decision                           | Outcome                                                                                                                                                                                                        |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Permission model for orders        | **`orders.read` / `orders.manage`** — the standing convention (as EPIC-8/9/10). The contract draft's `.write`/`.status`/`.assign`/`.import` fold into `manage`. No catalog change.                             |
| D2  | Order ↔ inventory stock coupling  | **Auto-reserve at `processing`, feature-gated.** Release on pre-ship cancel/return; decrement on-hand at `shipped`. Skipped when `inventory` is off for the company.                                           |
| D3  | Customer KPI computation           | **In-transaction (strong).** Recomputed from source rows inside the order write transaction — no drift, no eventual-consistency window.                                                                        |
| D4  | Sequencing of smart-paste + import | **Core lifecycle first.** M11.1–M11.4 deliver the daily driver; parse + import land in M11.5.                                                                                                                  |
| D5  | Customer merge scope               | One atomic, audited transaction over the **complete** set of customer-owned tables (`customer_addresses`, `orders`), losing customer archived not deleted, guard test for new tables. Emits `customer.merged`. |
| D6  | Default state-machine transitions  | Fixed graph below (§6); illegal transitions `422`. Configurable per company is P1 behind the same engine.                                                                                                      |

### D1 rationale

Every delivered module collapsed the draft's fine-grained actions into `read` /
`manage` ([catalog.ts](../packages/database/src/seed/access/catalog.ts) already
seeds `orders.read` / `orders.manage`). Splitting `status`/`assign`/`import` into
separate permission actions is a **core change** to the ADR-0003 permission model
and deserves its own review, not a line in EPIC-11. Recorded as debt if the owner
later wants status/assign/import separated.

### D2 rationale

The COD flow (04*Orders.md) reserves stock when an order enters \_processing* (state
3, "مؤكّد، قيد التجهيز — حجز مخزون"). Reuse the EPIC-9 reservation log and its
atomic `SELECT … FOR UPDATE` commit path, now with a real `order_id` FK. A company
on the **Free** plan has **no inventory feature** — for it, orders simply carry no
stock side effects. The coupling is therefore resolved at runtime against the
company's feature flags, never assumed.

### D3 rationale

KPIs are recomputed by a single SQL aggregate over the customer's own orders inside
the write transaction, the same discipline `average_cost` follows. Definitions:

- `ordersCount` = orders for the customer whose `status <> 'cancelled'`.
- `totalSpent` = `SUM(collected_amount)` over those orders (COD actually collected).
- `lastOrderAt` = `MAX(created_at)` over those orders.

Recomputed on create, status change, `collectedAmount` change, customer reassign,
and merge. Because it is derived from source rows every time, it cannot drift.

## 5. Data model (as decided)

```
Order (orders)
  ├─ id, companyId
  ├─ orderNumber      (bigint, sequential PER COMPANY, unique; human-facing)
  ├─ customerId       → customers (RESTRICT: an order pins its customer)
  ├─ assigneeId?      → profiles (SET NULL)
  ├─ status           (enum-checked; 12 states)          ← state machine
  ├─ followUpState    (separate axis; e.g. none/pending/…) ← D6
  ├─ labelId?         → order_labels   (EPIC-7, SET NULL)
  ├─ reasonId?        → order_reasons  (EPIC-7, SET NULL; required for cancel)
  ├─ governorateId?   → governorates   (EPIC-7, SET NULL)
  ├─ subtotal         (bigint minor units, derived from items)
  ├─ shippingFee      (bigint minor units, default 0)
  ├─ discount         (bigint minor units, default 0)
  ├─ total            (bigint minor units = subtotal + shippingFee − discount)
  ├─ collectedAmount  (bigint minor units, default 0)     ← pivotal COD
  ├─ paymentStatus    (unpaid/partial/paid, derived from collected vs total)
  ├─ notes?
  ├─ statusChangedAt  (timestamptz)
  ├─ idempotencyKey?  (unique per company when present)
  └─ (base columns)

OrderItem (order_items)
  ├─ id, companyId, orderId
  ├─ variantId        → product_variants (RESTRICT)
  ├─ nameSnapshot     (product + variant label frozen at add time)
  ├─ quantity         (bigint whole units, > 0)
  ├─ price            (bigint minor units, ≥ 0; unit sell price)
  ├─ costSnapshot     (bigint minor units, ≥ 0; averageCost at add time — COGS)
  └─ (base columns)

OrderActivity (order_activities)
  ├─ id, companyId, orderId
  ├─ kind             (created/status_changed/assigned/edited/payment/…)
  ├─ fromValue?, toValue?   (text; e.g. old→new status — ids/labels only, no PII)
  ├─ note?
  ├─ actorId?         → profiles
  └─ createdAt

OrderSequence (order_sequences)   — per-company monotonic counter
  ├─ companyId (PK) → companies
  └─ nextNumber (bigint)          UPDATE … RETURNING serializes number issuance
```

All tenant-editable tables: base columns + `FORCE` RLS by `company_id` +
`touch_updated_at`. Keyset indexes on `(company_id, created_at DESC, id DESC)` and
the whitelisted sort keys. `stock_reservations.order_id` gains a real FK
(`ON DELETE SET NULL`) now that `orders` exists.

## 6. State machine (D6)

The **12 states** (04_Orders.md §ج):

`new · confirming · processing · incomplete · ready · shipped · delivered ·
completed · postponed · cancelled · returned · exchanged`

Default legal transitions (P0, fixed; P1 makes them per-company configurable):

| From       | To                                            | Side effect on entry                        |
| ---------- | --------------------------------------------- | ------------------------------------------- |
| new        | confirming, processing, cancelled, postponed  | —                                           |
| confirming | processing, incomplete, cancelled, postponed  | —                                           |
| processing | incomplete, ready, cancelled, postponed       | **reserve stock** (feature-gated)           |
| incomplete | processing, ready, cancelled, postponed       | —                                           |
| ready      | shipped, cancelled, postponed                 | —                                           |
| shipped    | delivered, returned, postponed                | **decrement on-hand + release reservation** |
| delivered  | completed, returned, exchanged                | —                                           |
| completed  | returned, exchanged                           | —                                           |
| postponed  | new, confirming, processing, ready, cancelled | —                                           |
| cancelled  | — (terminal)                                  | **release reservation** (if held, pre-ship) |
| returned   | exchanged                                     | **release reservation** (if held, pre-ship) |
| exchanged  | — (terminal)                                  | —                                           |

Rules:

- **cancel requires a reason** of kind `cancel`/`cancellation` (04_Orders.md §5.2);
  the transition is rejected `422` without one.
- **follow-up state** is an independent axis (`none` default), set/cleared without a
  main-status transition; it never gates the main machine.
- **completed** implies delivered **and** fully collected — the UI nudges collection
  but the machine only requires the delivered predecessor; `paymentStatus` is
  derived and shown alongside.
- Stock side effects run only when the `inventory` feature is enabled for the
  company (D2) and the order has items with a resolvable default warehouse.

## 7. Milestones

| ID    | Deliverable                                                                                                                                                                                                                                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M11.0 | This design doc + branch `feat/epic-11-orders`; decisions D1–D6 recorded.                                                                                                                                                                                                                                   |
| M11.1 | Prisma models + migration `20260806000000_orders`: `orders`, `order_items`, `order_activities`, `order_sequences`; RLS, triggers, keyset indexes, status/amount checks; `stock_reservations.order_id` real FK.                                                                                              |
| M11.2 | `modules/orders` domain + application + infrastructure: state machine, create with items + cost snapshot, edit, status transition (stock reserve + KPI recompute in-txn), assign, bulk, activity log, idempotency replay, audit-then-emit. **Plus inherited:** customer merge + KPIs + order-history query. |
| M11.3 | `/v1/orders` presentation: list/create/detail/patch/status/assign/bulk/activity, DTOs, three-layer gating, unified errors, OpenAPI. **Plus** `GET /v1/customers/{id}/orders`, `POST /v1/customers/merge`, `hasOrders` filter + `-ordersCount`/`-totalSpent` sorts.                                          |
| M11.4 | Orders screen in the Dual Shell: keyset list, status tabs + counts, dual view, saved filters, inline + bulk status/assign, side detail panel with activity, create/edit, ar/en, standard states.                                                                                                            |
| M11.5 | `POST /v1/orders/parse` (deterministic smart-paste) + `POST /v1/orders/import` (Excel/CSV with column mapping); frontend paste box + import wizard.                                                                                                                                                         |
| M11.6 | Docs + §2.5 gate: contract delivered, events live, `orders-domain.md`, `orders-review.md`, `epic-11-retrospective.md`, `epic-11-quality-gate.md`; metrics/domain-map refreshed; customers-domain §8 closed; owner sign-off.                                                                                 |

## 8. Acceptance criteria

The epic is done when **all** hold:

1. An order moves only along legal transitions; an illegal one → `422` naming the
   attempted `from`→`to`. Cancel without a `cancel`-kind reason → `422`.
2. Entering `processing` reserves stock atomically via the EPIC-9 path **iff** the
   `inventory` feature is enabled; `shipped` decrements on-hand; a pre-ship
   cancel/return releases the reservation. No double-commit on retry
   (`Idempotency-Key` replays).
3. `ordersCount` / `totalSpent` / `lastOrderAt` are recomputed inside the order
   write transaction and are always consistent with the order rows.
4. `POST /v1/customers/merge` re-parents every customer-owned table in one
   transaction, archives the loser, is audited, emits `customer.merged`, and a
   guard test fails if a new customer-owned table is added without updating it.
5. Money is integer minor units everywhere; `total = subtotal + shippingFee −
discount`; `costSnapshot` freezes `averageCost` at add time.
6. Every route is three-layer gated (`orders.read` / `orders.manage`); the tenant
   comes from the token; RLS + repo scoping both hold (CI `database` job).
7. Every list is keyset-paginated over a covering index; no OFFSET; deep-linking
   works via the cursor.
8. Bulk status/assign are atomic per item and return per-item results.
9. `POST /v1/orders/parse` is **100 % deterministic** (Regex/Heuristics) and never
   imports or calls an AI SDK (the `no-ai-imports` guard stays green).
10. Order number is sequential per company and unique; concurrent creates never
    collide (serialized via `order_sequences`).
11. The Orders screen works in both shells, in ar and en, with the standard
    empty/loading/error states.
12. All local gates green from a cold cache; test count grows from 795; web bundle
    stays under 200 KB gzip.

## 9. Risks

| Risk                                               | Mitigation                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| Order ↔ stock coupling deadlocks or oversells     | Reuse EPIC-9's deterministic lock order + `FOR UPDATE`; feature-gate; idempotent  |
| Order-number races produce duplicates              | `order_sequences` `UPDATE … RETURNING` under the tenant txn serializes issuance   |
| KPI recompute drifts from order rows               | Recompute from source aggregate every write (D3); never incremental               |
| Merge silently misses a customer-owned table       | Guard test enumerates customer-owned tables and fails if merge doesn't cover them |
| Smart-paste tempts an AI shortcut                  | ADR-0004 + `no-ai-imports` CI guard; parser is pure Regex/Heuristics, unit-tested |
| The epic is large and risks a half-built lifecycle | D4 core-first sequencing: a usable daily driver lands before parse/import         |

---

**Status:** decisions D1–D6 answered on 2026-07-31; this document is the M11.1
brief. [api/orders.md](api/orders.md) is updated to match as each milestone lands.

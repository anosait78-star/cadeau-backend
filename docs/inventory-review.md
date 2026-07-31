# EPIC-9 Inventory — Technical Review

**Epic:** EPIC-9 Inventory & Warehouses · **Branch:** `feat/epic-9-inventory` ·
**Commit:** `70fd2f4` · **Reviewed:** 2026-07-31.

A dimension-by-dimension review of what was actually delivered, written against the
code rather than the plan. The formal §2.5 verdict is in
[epic-9-quality-gate.md](epic-9-quality-gate.md); the model is in
[inventory-domain.md](inventory-domain.md); the HTTP contract is
[api/inventory.md](api/inventory.md).

---

## 1. Warehouse model

`warehouses` is a small, tenant-editable entity: `name` (unique per company),
optional `code` (unique per company **when present**, partial index), optional
`address`, an `isDefault` flag, and the standard soft-delete `is_active`.

The interesting constraint is `isDefault`. "At most one default per company" is
expressed as a **partial unique index** on `(company_id) WHERE is_default`, so the
database — not application code — owns the rule. Promoting a new default is a
single transaction that demotes the incumbent first.

Archive is soft (`is_active = false`). Levels and history rows survive, which is
required: a closed warehouse still explains where past stock went.

**Assessment: sound.** The model carries no field the epic does not use.

## 2. Stock level model

One row per `(warehouse, variant)`, unique-constrained. Three quantity columns plus
a threshold:

- `on_hand` — physical stock, `CHECK >= 0`
- `committed` — reserved but unshipped, `CHECK >= 0`
- `available` — **derived** `on_hand - committed`
- `reorder_point` — `CHECK >= 0`

The decision worth calling out: **`available` is a real column maintained by a
trigger** (`app.sync_stock_available()`), not a generated expression evaluated at
read time and not a view. The reason is the list surface — `available` is both a
filter (`belowReorder`) and a keyset sort key, and only a real column can carry
`inventory_stock_available_keyset_idx (company_id, available, id)`. The cost is one
trigger; the alternative was an unindexable sort.

Levels are **upserted on first touch**. There is no "initialize stock" endpoint,
which removes an entire class of "level missing" errors from every write path.

**Assessment: correct trade-off, and the trigger keeps the invariant out of
application hands.**

## 3. Atomicity — the core of this epic

Every stock write is one transaction that:

1. binds the tenant context (RLS),
2. checks the `Idempotency-Key` (replay short-circuit),
3. resolves and locks the affected level(s) with `SELECT … FOR UPDATE`,
4. **then** reads the balance and validates,
5. writes the level(s) + the durable log row,
6. writes `audit_log`, and only after commit emits events.

The ordering of (3) and (4) is the whole point: a balance read before a lock is a
race. Two concurrent reservations for the last unit now serialize — the second one
sees the post-first balance and is rejected with `409`, instead of both committing.

Transfers lock **both** sides **in a deterministic order**, which is what prevents
the classic A→B / B→A deadlock. This is the kind of property that is easy to state
and easy to lose in a later refactor, so it is worth its explicit test coverage
(`inventory.repository.edge.test.ts`).

**Assessment: this is the strongest part of the epic.** The locking discipline is
consistent across all four write paths rather than being applied only where it was
obviously needed.

## 4. Idempotency

`Idempotency-Key` is stored on the log row under a partial unique index
`(company_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. Two paths are
handled:

- **Sequential retry** — the key is found up-front, the original record is returned
  with `effects: []`, `replayed: true`. No stock moves, no event, no audit row.
- **Concurrent retry** — both requests pass the up-front check; one wins the insert,
  the loser catches the unique violation and replays the winner's row.

The release path has its own replay: if another transaction released the
reservation first, the current (already-`released`) row is returned rather than
double-decrementing `committed`.

This is the first real idempotency implementation in the tree, and it is
**per-module, not shared**. That is a deliberate scoping decision, and it is now the
model the deferred cross-module idempotency store should generalize from.

**Assessment: complete for this module; the generalization is open debt.**

## 5. Oversell policy

Overselling is a **per-product** flag (`products.allow_oversell`, added to the
EPIC-8 table by this migration), read inside the write transaction. When set, a
reservation may exceed `available`, driving `available` negative — which is exactly
how a backorder should read. It never bypasses `on_hand >= 0`; physical stock stays
truthful.

Putting the policy on the product rather than the company or the request is right:
overselling is a property of what you sell (made-to-order vs. stocked), not of who
is asking.

**Assessment: correct placement, correct floor.**

## 6. Events

Two events, both finalized in the EPIC-6 closed catalog:

- `stock.changed` — emitted **once per affected level** (so a transfer emits two),
  carrying warehouse, variant, the new balances and which write path moved it.
- `stock.low` — **edge-triggered**: fires only when the write pushed `available` to
  or below `reorderPoint` _from above_. A level that is already below its threshold
  does not re-alert on every subsequent write.

Edge-triggering is the difference between a useful alert and a notification storm
in EPIC-15. Doing it at emission time (rather than asking every consumer to
de-duplicate) puts the logic in the one place that knows the before-state.

A replay emits nothing, consistent with "a replay moved no stock".

**Assessment: well-shaped.** The payload carries what a consumer needs without
forcing a read-back.

## 7. Validation & error mapping

All through the unified envelope, with field-specific details:

| Condition                                     | Result                            |
| --------------------------------------------- | --------------------------------- |
| Duplicate warehouse `name` / `code` / default | `409` + offending field           |
| Unknown warehouse / variant in this tenant    | `422` (never a cross-tenant leak) |
| Reservation > `available` (no oversell)       | `409` `InsufficientStockError`    |
| Transfer / negative adjustment > `on_hand`    | `409` `InsufficientStockError`    |
| Tampered or stale list cursor                 | `400`                             |
| No active company on the principal            | `403`                             |

Reference checks run **under RLS**, so a foreign-tenant `warehouseId` is simply not
found → `422`. The tenant is always taken from the token, never the payload
(ADR-003).

Using `409` (not `422`) for insufficient stock is the right call: the request is
well-formed, it conflicts with current state.

**Assessment: consistent with the other modules; no bespoke error shapes.**

## 8. API surface

Eleven routes across two controllers:

- `/v1/warehouses` — list (keyset, `q`/`active`), detail, create, update, archive.
- `/v1/inventory` — `GET stock` (keyset, `warehouseId`/`variantId`/`belowReorder`,
  sort by `available` or `updatedAt`), `PUT reorder-points`, `POST reservations`,
  `DELETE reservations/{id}`, `POST transfers`, `POST adjustments`.

Every route is three-layer gated (`inventory.read` / `inventory.manage` under the
`inventory` feature — already seeded in EPIC-5, so **no access-catalog change**).
`PUT reorder-points` is an addition to the contract draft: low-stock alerting is
useless without a way to set the threshold, and it is idempotent by nature, hence
`PUT`.

Reservations have **no list endpoint**. That is deliberate — reservations are read
in the context of an order, and EPIC-11 owns that surface.

**Assessment: minimal and complete for the epic's acceptance criteria.**

## 9. Frontend

A capability-gated Inventory screen in the Dual Shell (`pages/inventory`,
`features/inventory`), two tabs:

- **Stock** — warehouse filter, low-stock filter with a count badge, inline
  reorder-point editor, adjust and transfer forms. Variant labels are sourced from
  the EPIC-8 catalog rather than re-derived.
- **Warehouses** — create / edit / archive, default flag.

Responsive card lists for both shells, the standard empty/loading/error states,
ar/en, and the route replaces the previous placeholder. Web tests 90 → 100.

**Assessment: consistent with the Products screen; no new UI primitives invented.**

## 10. Documentation

[api/inventory.md](api/inventory.md) marked ✅ Delivered and matches the shipped
controllers (routes, params, status codes, `operationId`s), and documents
atomicity, the oversell policy, idempotency, errors, events and audit.
[events.md](events.md) lists both `stock.*` events live.
[execution-plan.md](execution-plan.md) records EPIC-9 delivered with the 668
baseline. Closure docs: this review, [inventory-domain.md](inventory-domain.md),
[epic-9-retrospective.md](epic-9-retrospective.md),
[epic-9-quality-gate.md](epic-9-quality-gate.md).

**Assessment: complete; deferrals are explicit rather than silent.**

---

## Findings & fixes during review

- **No defects found.** Unlike the EPIC-8 gate — where a cached type-check pass
  masked a real strict-mode error in a controller test — this gate's cold re-run of
  every local gate was green on the first pass (see the gate doc for the numbers).
- **Note, not a defect:** `pnpm test --force` failed once when turbo ran packages in
  parallel, because two packages run `prisma generate` into the same client output.
  Re-running with `--concurrency=1` is green, and CI runs the packages
  independently. Recorded as low-priority tooling debt, not a product issue.

## Verdict

**PASS.** EPIC-9 delivers correct concurrent stock semantics — the property most
inventory implementations get wrong — with the invariants pushed down to Postgres
(CHECKs, partial unique indexes, the `available` trigger) and the concurrency
discipline (`FOR UPDATE` before balance reads, deterministic lock order) applied
uniformly across all four write paths. It added a substantial feature with **no
core change**: no new access-catalog entry, no new framework, no new UI primitive.

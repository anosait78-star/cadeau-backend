# EPIC-10 Design — Customers

**Status:** ✅ **Approved — in progress on `feat/epic-10-customers`.** ·
EPIC-9 closed and decisions D1–D4 answered by the owner on **2026-07-31**. ·
**Drafted:** 2026-07-31.

This document fixes the **scope, boundaries and acceptance criteria** of EPIC-10,
and records the four decisions that had to be settled before code.
Contract: [api/customers.md](api/customers.md). Sensitive-field storage:
[privacy-model.md](privacy-model.md). How it fits: [domain-map.md](domain-map.md) §6.

---

## 1. Goal

A **customer base** for COD social commerce: a person with a phone number, an
address or two, and — once orders exist — a small set of derived KPIs. The phone
number is the identity key: it is E.164, **unique per company**, and it is how a
back-office user finds a returning buyer in one keystroke.

This is the last domain module before Orders (EPIC-11), and Orders is the reason it
exists. Every decision below is judged by "does EPIC-11 get what it needs, without
EPIC-10 pretending to know things only EPIC-11 will know."

## 2. In scope

- **Customer** — name, phone (E.164, **stored as ciphertext + blind index** per
  [privacy-model.md](privacy-model.md), unique per company), optional email,
  optional notes, `active` soft-delete.
- **CustomerAddress** — 0..n per customer; line, `governorateId` → EPIC-7
  `governorates`, optional landmark/notes, one flagged default.
- **CRUD + keyset list** — search `q`, filters (`hasOrders`, `governorateId`,
  `createdAtFrom/To`), whitelisted sorts.
- **Derived KPIs** — `ordersCount`, `totalSpent`, `lastOrderAt`: **read-only, no
  write path, zero/null until EPIC-11**. Same discipline as `averageCost` in EPIC-8.
- **Export** — gated by `customers.manage` (D2) **and** audited, per ADR-0001.
- **Frontend** — a capability-gated Customers screen in the Dual Shell, matching the
  Products/Inventory pattern (list, detail, create/edit/archive, addresses).
- **Events** — `customer.created`, `customer.updated`, `customer.exported`.
  (`customer.merged` stays reserved for EPIC-11.)

## 3. Explicitly out of scope

| Not in EPIC-10                                          | Why / where                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Order history endpoint returning rows                   | `GET /{id}/orders` ships in EPIC-11 with orders                                             |
| KPI computation                                         | EPIC-11 (counts/spend) — EPIC-10 ships the columns only                                     |
| **Customer merge** (`POST /v1/customers/merge`)         | **EPIC-11 (decision D3)** — written once, against the complete set of customer-owned tables |
| Automatic duplicate detection / fuzzy merge suggestions | Future, additive; merge itself is manual                                                    |
| Un-merge / merge rollback                               | Not a v1 feature; the audit log records the merge                                           |
| Partial-phone search (e.g. "ends with 4567")            | Not possible against a blind index — see [privacy-model.md](privacy-model.md) §5            |
| Customer segments, tags, loyalty                        | Not in the roadmap for v1                                                                   |
| Bulk import of customers                                | Arrives with the EPIC-11 order import                                                       |
| WhatsApp/SMS to customers                               | EPIC-15                                                                                     |

## 4. Decisions — **answered by the owner, 2026-07-31**

These four could not be settled by "follow the existing pattern" — the existing
patterns conflicted. All four are now decided and binding for this epic.

| #   | Decision                                                              | Outcome                          |
| --- | --------------------------------------------------------------------- | -------------------------------- |
| D1  | `phone_encrypted` (AES-256-GCM) **+** `phone_hash` (HMAC blind index) | ✅ option B — as recommended     |
| D2  | Export gated by `customers.manage`; **no new permission action**      | ✅ option B1 — as recommended    |
| D3  | **Customer merge deferred to EPIC-11** (until orders exist)           | ⚠️ **changed from the proposal** |
| D4  | Reuse the EPIC-9 module-local `Idempotency-Key` implementation        | ✅ as recommended                |

**D3 changes this epic's scope.** The proposal was to build merge now over
addresses only; the owner deferred it instead. Consequences, applied throughout this
document:

- No `POST /v1/customers/merge` route in EPIC-10 — **6 routes, not 7.**
- No `customer.merged` emission in EPIC-10 (the name stays reserved in the closed
  event catalog for EPIC-11).
- Acceptance criterion 4 (merge atomicity) is removed from this epic and becomes an
  EPIC-11 criterion.
- The upside: merge gets written **once**, against the complete set of
  customer-owned tables, instead of being written now and extended later — which
  removes the "merge silently misses a table added later" risk from §8 entirely.
- The cost: duplicate customers created before EPIC-11 can only be resolved by
  archiving one by hand. Acceptable — the E.164 unique index prevents the common
  case from arising at all.

The full rationale for D1 and its consequences (normalization, key management,
rotation, what search survives) is now documented in
[privacy-model.md](privacy-model.md) — that document, not this one, is the binding
reference for sensitive-field storage.

<details>
<summary>The original options as presented (kept for the record)</summary>

### D1 — How is the customer phone stored? _(the important one)_

The phone must be **encrypted PII** (ADR-0001), **unique per company**, and
**searchable**. Those three pull in different directions, and the codebase contains
precedent for two different answers:

- `profiles.phone_encrypted` — AES-256-GCM ciphertext, not unique, not searchable.
- `profiles.email` — plaintext `citext`, unique, searchable.

| Option                                                                                                                                | Unique? | Exact lookup?       | Partial `q` search? | PII posture                           |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------- | ------------------- | ------------------------------------- |
| **A. Plaintext E.164 + unique index** (the `email` precedent)                                                                         | ✅      | ✅                  | ✅                  | Weakest — phone readable in a DB dump |
| **B. Blind index + ciphertext** — `phone_hash` (HMAC-SHA256, server key) unique per company, plus `phone_encrypted` **(recommended)** | ✅      | ✅ (hash the query) | ❌ (exact only)     | Strong                                |
| C. Ciphertext only                                                                                                                    | ❌      | ❌                  | ❌                  | Strong, but fails the requirement     |

**Recommendation: B.** In COD social commerce the phone lookup that matters is
_exact_ — a customer gives their full number. Losing partial-phone search is a real
but small cost; `q` still covers name and email. B needs one new key in
`@cadeau/config` (the blind-index HMAC key, distinct from the encryption key) and a
documented rotation story — that is the honest cost of the option, and it should be
decided now rather than discovered in M10.2.

### D2 — What gates export?

The contract draft names `customers.export`, but the **permission catalog contains
only `read`/`manage` per feature**
([catalog.ts](../packages/database/src/seed/access/catalog.ts)) — there is no
`export` action anywhere in the system. Two ways out:

- **B1 (recommended): gate export with `customers.manage` + mandatory audit.** No
  catalog change, ships now, consistent with every other module.
- B2: add a third action to the catalog. This is a **core change** — it touches the
  permission model that ADR-0003 defines and that every module inherits — so it
  deserves its own review, not a line in EPIC-10.

**Recommendation: B1**, with B2 recorded as debt if the owner later wants
export separated from write.

### D3 — Where does merge live, and what does it do before orders exist?

Merge must move _everything_ the loser owns to the winner. Today that is only
addresses. In EPIC-11 it becomes orders too. Proposal: **implement merge now as one
atomic, audited transaction with an explicit, documented list of what it
re-parents**, and treat "extend the list" as an EPIC-11 task with a test that fails
loudly if a new customer-owned table is added without updating the merge. Losing
customer is archived, not deleted.

### D4 — Idempotency on `POST /v1/customers`

EPIC-9 built module-local `Idempotency-Key` handling (stored on the row, partial
unique index, replay on retry). EPIC-8 deferred it. Proposal: **reuse the EPIC-9
pattern** — it is proven and cheap — and keep the shared cross-module store as
existing debt.

</details>

## 5. Data model (as decided)

```
Customer (customers)
  ├─ id, companyId
  ├─ name
  ├─ phoneHash       (blind index — UNIQUE per company)   ← D1
  ├─ phoneEncrypted  (AES-256-GCM ciphertext)             ← D1
  ├─ email?          (citext, optional; not unique)
  ├─ notes?
  ├─ ordersCount     (derived, read-only, default 0)      ← EPIC-11 writes
  ├─ totalSpent      (derived, bigint minor units, default 0) ← EPIC-11 writes
  ├─ lastOrderAt?    (derived)                            ← EPIC-11 writes
  ├─ idempotencyKey? (unique per company when present)
  └─ active

CustomerAddress (customer_addresses)
  ├─ id, companyId, customerId
  ├─ line, landmark?, notes?
  ├─ governorateId → governorates  (EPIC-7)
  ├─ isDefault  (at most ONE true per customer — partial unique index)
  └─ active
```

Both tables: base columns + `FORCE` RLS by `company_id` + `touch_updated_at`, per
the standing convention. Keyset indexes on `(company_id, created_at DESC, id DESC)`
and on the whitelisted sort keys.

## 6. Milestones

| ID    | Deliverable                                                                                                                                                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M10.1 | `PII_HASH_KEY` in `@cadeau/config` + `blindIndex()` in `@cadeau/crypto`; Prisma models + migration `20260805000000_customers`: 2 tables, RLS, triggers, unique `phone_hash` per company, one-default-address partial index, derived-KPI columns with no write path, idempotency index |
| M10.2 | `modules/customers` domain + application + infrastructure: E.164 normalization, tenant-scoped CRUD, addresses, keyset list with `q`/filters, blind-index lookup, idempotency replay (EPIC-9 pattern)                                                                                  |
| M10.3 | `/v1/customers` presentation: **6 routes**, DTOs, three-layer gating, audit-then-emit, phone masking on list, unified error mapping; OpenAPI                                                                                                                                          |
| M10.4 | Customers screen in the Dual Shell: list + search, detail with KPIs and addresses, create/edit/archive, ar/en                                                                                                                                                                         |
| M10.5 | Docs + gates: contract marked delivered, `customer.*` events live, domain + review + retrospective + §2.5 gate; metrics, domain map and privacy model refreshed                                                                                                                       |

## 7. Acceptance criteria

The epic is done when **all** of these hold:

1. A phone number cannot be duplicated within a company — enforced by a **database
   unique index on `(company_id, phone_hash)`**, surfaced as `409` naming the
   `phone` field (never the colliding row's id).
2. A phone number is **never stored in a readable form**; the plaintext exists only
   in the request body and in the decrypted detail response. An exact-phone lookup
   still resolves in one indexed query.
3. Normalization to E.164 happens in **one** place and serves both writes and
   lookups, so `+20 100 123 4567` and `+201001234567` collide as they should.
4. `ordersCount` / `totalSpent` / `lastOrderAt` have **no write path** at any layer
   — no DTO field, no repository write.
5. Export is gated by `customers.manage` **and** writes an `audit_log` row **and**
   emits `customer.exported` — no unaudited path to bulk PII exists.
6. No plaintext PII appears in `audit_log.changes`, in an event payload, in a
   cursor, in a URL, or in a log line ([privacy-model.md](privacy-model.md) §6).
7. Every route is three-layer gated; the tenant comes from the token; RLS + repo
   scoping both hold (verified by the CI `database` job).
8. Every list is keyset-paginated over a covering index; no OFFSET.
9. The Customers screen works in both shells, in ar and en, with the standard
   empty/loading/error states.
10. All local gates green **from a cold cache**; test count grows from 668; web
    bundle stays under 200 KB gzip.
11. No access-catalog change (per D2) and no new cross-cutting seam.

## 8. Risks

| Risk                                                                      | Mitigation                                                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Inconsistent E.164 normalization lets a duplicate through                 | Criterion 3: one normalization function, unit-tested against messy input                                     |
| A new required secret (`PII_HASH_KEY`) breaks existing environment setups | Ship it with the config schema, `.env.example` and a startup error that names the variable                   |
| Losing the key makes every phone unfindable                               | Ciphertext is the source of truth; the hash is rebuildable from it ([privacy-model.md](privacy-model.md) §3) |
| KPI columns get "temporarily" written by hand to demo the screen          | Criterion 4 + no DTO field; review it explicitly                                                             |
| PII export becomes the easy path to a data leak                           | Criterion 5; export stays `manage`-gated and audited                                                         |
| Duplicates created before EPIC-11 have no merge path                      | Accepted (D3); the unique index prevents the common case, archive-by-hand covers the rest                    |

~~Merge silently misses a table added later~~ — **removed by D3**: merge is now
written once in EPIC-11, against the complete set of customer-owned tables.

## 9. Estimated shape

Comparable to EPIC-8 (two tables, CRUD + one screen) plus the blind-index work, and
smaller than originally estimated now that merge is deferred (D3) — well short of
EPIC-9, which carried the concurrency model. Expect the test count to land in the
~730–770 range and the bundle to grow a few KB.

---

**Status:** decisions D1–D4 answered and the EPIC-9 closure box ticked on
2026-07-31. This document is now the M10.1 brief;
[api/customers.md](api/customers.md) has been updated to match.

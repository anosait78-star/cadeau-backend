# EPIC-10 Design — Customers

**Status:** 🟡 Design proposal — **not approved, not started.** ·
**Prerequisite:** the EPIC-9 closure checkbox in
[epic-9-quality-gate.md](epic-9-quality-gate.md) must be ticked first. ·
**Drafted:** 2026-07-31.

This document fixes the **scope, boundaries and acceptance criteria** of EPIC-10
before any code is written, and surfaces the four decisions that need an answer
first. Contract draft: [api/customers.md](api/customers.md). How it fits:
[domain-map.md](domain-map.md) §6.

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

- **Customer** — name, phone (E.164, unique per company), optional email, optional
  notes, `active` soft-delete.
- **CustomerAddress** — 0..n per customer; line, `governorateId` → EPIC-7
  `governorates`, optional landmark/notes, one flagged default.
- **CRUD + keyset list** — search `q`, filters (`hasOrders`, `governorateId`,
  `createdAtFrom/To`), whitelisted sorts.
- **Derived KPIs** — `ordersCount`, `totalSpent`, `lastOrderAt`: **read-only, no
  write path, zero/null until EPIC-11**. Same discipline as `averageCost` in EPIC-8.
- **Manual merge** — collapse two customers into one, audited, reversible only by
  the audit trail (not by an undo endpoint).
- **Export** — permission-gated **and** audited, per ADR-0001.
- **Frontend** — a capability-gated Customers screen in the Dual Shell, matching the
  Products/Inventory pattern (list, detail, create/edit/archive, addresses).
- **Events** — `customer.created`, `customer.merged`, `customer.exported`.

## 3. Explicitly out of scope

| Not in EPIC-10                                          | Why / where                                             |
| ------------------------------------------------------- | ------------------------------------------------------- |
| Order history endpoint returning rows                   | `GET /{id}/orders` ships in EPIC-11 with orders         |
| KPI computation                                         | EPIC-11 (counts/spend) — EPIC-10 ships the columns only |
| Automatic duplicate detection / fuzzy merge suggestions | Future, additive; v1 merge is manual                    |
| Un-merge / merge rollback                               | Not a v1 feature; the audit log records the merge       |
| Customer segments, tags, loyalty                        | Not in the roadmap for v1                               |
| Bulk import of customers                                | Arrives with the EPIC-11 order import                   |
| WhatsApp/SMS to customers                               | EPIC-15                                                 |

## 4. Decisions required before M10.1

These four cannot be settled by "follow the existing pattern" — the existing
patterns conflict. **Each needs an explicit answer.**

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

## 5. Proposed data model

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

| ID    | Deliverable                                                                                                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M10.1 | Prisma models + migration `2026080500000_customers`: 2 tables, RLS, triggers, unique `phone_hash` per company, one-default-address partial index, derived-KPI columns with no write path |
| M10.2 | `modules/customers` domain + application + infrastructure: tenant-scoped CRUD, addresses, keyset list with `q`/filters, blind-index lookup, merge transaction, idempotency replay        |
| M10.3 | `/v1/customers` presentation: routes, DTOs, three-layer gating, audit-then-emit, unified error mapping; OpenAPI                                                                          |
| M10.4 | Customers screen in the Dual Shell: list + search, detail with KPIs and addresses, create/edit/archive, merge flow, ar/en                                                                |
| M10.5 | Docs + gates: contract marked delivered, `customer.*` events live, domain + review + retrospective + §2.5 gate; metrics and domain map refreshed                                         |

## 7. Acceptance criteria

The epic is done when **all** of these hold:

1. A phone number cannot be duplicated within a company — enforced by a **database
   unique index**, surfaced as `409` with the offending field.
2. A phone number is never stored in a readable form (per D1-B), and an exact-phone
   lookup still resolves in one indexed query.
3. `ordersCount` / `totalSpent` / `lastOrderAt` have **no write path** at any layer
   — no DTO field, no repository write.
4. Merge is one atomic transaction, moves every customer-owned row, archives the
   loser, writes one `audit_log` entry naming both ids, and emits `customer.merged`.
5. Export is permission-gated **and** writes an `audit_log` row **and** emits
   `customer.exported` — no unaudited path to bulk PII exists.
6. Every route is three-layer gated; the tenant comes from the token; RLS + repo
   scoping both hold (verified by the CI `database` job).
7. Every list is keyset-paginated over a covering index; no OFFSET.
8. The Customers screen works in both shells, in ar and en, with the standard
   empty/loading/error states.
9. All local gates green **from a cold cache**; test count grows from 668; web
   bundle stays under 200 KB gzip.
10. No access-catalog change (per D2-B1) and no new cross-cutting seam.

## 8. Risks

| Risk                                                             | Mitigation                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| D1 decided late → the phone column is reworked mid-epic          | Decide before M10.1; it is a migration-shaped decision                 |
| Blind-index key rotation is undesigned                           | Document rotation (re-hash under a new key, dual-read window) in M10.1 |
| Merge silently misses a table added later                        | A test that enumerates customer-owned tables and fails on drift        |
| KPI columns get "temporarily" written by hand to demo the screen | Acceptance criterion 3 + no DTO field; review it explicitly            |
| PII export becomes the easy path to a data leak                  | Criterion 5; export stays `manage`-gated and audited                   |

## 9. Estimated shape

Comparable to EPIC-8 (two tables, CRUD + one screen) plus the merge transaction and
the blind-index work — smaller than EPIC-9, which carried the concurrency model.
Expect the test count to land in the ~740–780 range and the bundle to grow a few KB.

---

**Next step:** the owner answers D1–D4 (and ticks the EPIC-9 closure box). Once
those are settled, this document becomes the M10.1 brief and
[api/customers.md](api/customers.md) is updated to match the decisions before any
code is written.

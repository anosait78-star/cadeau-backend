# EPIC-10 Retrospective — Customers

**Epic:** EPIC-10 Customers · **Branch:** `feat/epic-10-customers` ·
**Closed:** 2026-07-31 · Design: [epic-10-design.md](epic-10-design.md) · Review:
[customers-review.md](customers-review.md) · Gate:
[epic-10-quality-gate.md](epic-10-quality-gate.md).

---

## 1. What we set out to build

A customer base for COD social commerce: a person with a phone number that is the
identity key, an address or two, and a small set of derived KPIs — built so that
**EPIC-11 gets what it needs without EPIC-10 pretending to know things only
EPIC-11 will know**. Four decisions (D1–D4) were answered by the owner before any
code was written.

## 2. What we delivered

- **M10.1** — `PII_HASH_KEY` in `@cadeau/config` (required, must differ from
  `ENCRYPTION_KEY`) and `blindIndex()` in `@cadeau/crypto`; migration
  `20260805000000_customers`: `customers` + `customer_addresses`, `FORCE` RLS,
  `touch_updated_at`, `UNIQUE (company_id, phone_hash)`, one-default-address partial
  index, idempotency index, KPI columns with no write path, encrypted address line.
- **M10.2** — the module's domain, application and infrastructure layers: E.164
  normalization as the single gate in front of the blind index, tenant-scoped CRUD +
  addresses, keyset list with `q` routed to either an exact phone lookup or a
  name/email search, governorate reference check, in-transaction default-address
  demotion, `Idempotency-Key` replay including the concurrent race, audit-then-emit
  with ids and field names only.
- **M10.3** — 9 routes (6 customer + 3 nested address), DTOs that carry the
  mask/full split in the type system, three-layer gating, the gated-and-audited
  export, OpenAPI, module registration.
- **M10.4** — the Customers screen in the Dual Shell: list + search, expandable
  detail with KPIs and addresses, create/edit/archive, address management, ar/en.
- **M10.5** — contract delivered, `customer.*` live, domain + review + this
  retrospective + the §2.5 gate; metrics, domain map and privacy model refreshed.

## 3. What went well

- **Deciding D1 before writing code was the whole difference.** The storage strategy
  for a sensitive, unique, searchable field is a schema decision; discovering it
  mid-milestone would have meant a second migration and a data backfill. Writing
  [privacy-model.md](privacy-model.md) first turned "how do we store a phone" into a
  reusable rule for every future sensitive column.
- **Structural invariants again beat procedural ones.** Uniqueness is a database
  index; "one default address" is a partial unique index; the mask/full split is a
  type distinction; the KPI columns are absent from every input type. None of these
  depend on a reviewer noticing something.
- **The EPIC-9 idempotency pattern transplanted cleanly** — including the concurrent
  replay race — which is the second time reusing a proven pattern cost less than
  designing one.
- **D3 (deferring merge) removed a risk rather than postponing work.** The design's
  own risk table listed "merge silently misses a table added later"; deferring merge
  to EPIC-11, where it is written once against the complete set of customer-owned
  tables, deletes that risk instead of mitigating it.
- **The epic added no core change.** No access-catalog action, no new cross-cutting
  seam — the third consecutive epic to attach entirely through existing seams.

## 4. What was hard / what we learned

- **A blind index is a trade, not a free upgrade.** It buys uniqueness and exact
  lookup over encrypted data and takes partial search away. Naming that cost in the
  contract and the review — instead of discovering it as a "missing feature" later —
  is what makes it a decision rather than a defect.
- **One normalization function is an invariant, not a style preference.** Two
  normalization paths would hash differently and quietly defeat the very index that
  enforces uniqueness. Framing it as invariant I4 in
  [customers-domain.md](customers-domain.md) made it testable.
- **Masking limits the response, not the work.** The list still decrypts every row
  to mask it. Worth stating so nobody assumes the masked list is the cheap path.
- **The frontend needed its own re-masking rule.** A write returns the full phone;
  folding that response into a list row would have put a full number into list state.
  The privacy split had to be re-applied client-side, not just trusted from the API.
- **A milestone boundary bent once, deliberately.** M10.3 was specified as
  presentation-only, but export needed a bulk read that did not exist. Adding
  `exportAll` there was the honest choice; recording it in the review was the rest of
  it.

## 5. Deviations & deferrals (all accepted)

| Item                                                    | Status                                       |
| ------------------------------------------------------- | -------------------------------------------- |
| `customers.export` permission action                    | **Not created** — export uses `manage` (D2)  |
| `POST /v1/customers/merge`                              | **Deferred to EPIC-11** (D3)                 |
| `GET /v1/customers/{id}/orders`                         | Deferred to EPIC-11 — needs orders           |
| `hasOrders` filter, `-ordersCount`/`-totalSpent` sorts  | EPIC-11 — the KPIs are `0`/`null` until then |
| Partial-phone search                                    | **Not possible** by construction (D1)        |
| Bulk customer import                                    | Arrives with the EPIC-11 order import        |
| Repository/service work inside M10.3 (export read path) | Accepted; recorded in the review             |

## 6. Debt carried into later epics

| Item                                                                         | Lands in                |
| ---------------------------------------------------------------------------- | ----------------------- |
| KPI computation (`ordersCount`, `totalSpent`, `lastOrderAt`)                 | EPIC-11                 |
| Customer merge, written once over all customer-owned tables                  | EPIC-11                 |
| Customer order-history endpoint                                              | EPIC-11                 |
| Duplicates created before merge exists → archive by hand                     | accepted (D3)           |
| Delivery address consumed by shipments                                       | EPIC-12                 |
| Customer analytics axis (cohorts, repeat rate)                               | EPIC-14                 |
| Shared cross-module idempotency store                                        | when the store is built |
| Blind-index key rotation runbook (rebuild hashes from ciphertext)            | before first rotation   |
| `prisma generate` races under parallel turbo tasks (`--concurrency=1` works) | tooling, low priority   |

## 7. Metrics snapshot (at close)

- **Gates (this run, cold):** format ✓ · lint ✓ · type-check ✓ (8/8) ·
  **795 tests ✓** (config 40 · web 111 · crypto 35 · database 71 · api 538) ·
  build ✓ (5/5) · arch ✓ (434 modules, 1048 deps, 0 violations) · stable-only ✓ ·
  audit high-clean (1 moderate, under gate) · web bundle **153.3 KB / 200 KB** gzip.
- **Growth over the epic:** tests 668 → 795 (+127), endpoints 49 → 58 (+9), tables
  33 → 35 (+2), bundle 150.2 → 153.3 KB (+3.1 KB) — inside the design's estimate of
  "a few KB", and above its ~730–770 test estimate.
- **CI-only (not run locally — no Docker/browser/k6):** `database` (migrations + RLS
  on real Postgres), `e2e` (Playwright desktop+mobile + axe), `performance`
  (Lighthouse), `api-load` (k6), `sast`, secret-scan.

See [epic-10-quality-gate.md](epic-10-quality-gate.md) for the formal §2.5 result
and [customers-review.md](customers-review.md) for the dimension review.

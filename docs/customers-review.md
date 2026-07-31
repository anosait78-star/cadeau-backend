# EPIC-10 Customers — Technical Review

**Reviewed:** 2026-07-31 · **Branch:** `feat/epic-10-customers` · **Scope:**
M10.1–M10.5 · Contract: [api/customers.md](api/customers.md) · Domain:
[customers-domain.md](customers-domain.md) · Gate:
[epic-10-quality-gate.md](epic-10-quality-gate.md).

A walk through what was built, why it is shaped that way, and what was left out on
purpose.

---

## 1. The storage decision, and what it cost

Decision D1 required the phone to be three things at once — encrypted PII, unique
per company, and searchable — and those pull against each other. The delivered
answer stores it **twice**: `phone_encrypted` (AES-256-GCM, reversible, the source
of truth) and `phone_hash` (HMAC-SHA256 under a separate key, `UNIQUE (company_id,
phone_hash)`, exact lookup).

What that bought: a duplicate phone is rejected by a **database index**, not by an
application check that a race could slip past; and an exact lookup is one indexed
query rather than a scan-and-decrypt.

What it cost, stated plainly:

- **Partial-phone search is gone.** "ends with 4567" cannot be answered by a hash.
  `q` still covers name and email. This is a property of the storage choice, not a
  gap in the query code, and it is documented in the contract and in
  [privacy-model.md](privacy-model.md) §5.
- **A second required secret.** `PII_HASH_KEY` ships in the config schema with a
  startup error naming it, and is validated to **differ** from `ENCRYPTION_KEY`.
- **A masked list still decrypts every row.** Masking limits what the _response_
  carries, not what the server reads. Honest, and worth knowing before someone
  assumes the list is cheap.

## 2. Normalization — one function, two callers

`normalizeE164` sits in the domain and is called by every write **and** by the
list-query parser. That is not tidiness: an un-normalized value hashes differently,
so a second normalization path would quietly defeat the unique index that enforces
"one customer per phone". It is unit-tested against messy input (spaces, `00`
prefixes, local formats).

The same function decides what `q` means: a term that normalizes becomes an exact
blind-index lookup, anything else a name/email search. The repository never guesses.

## 3. The mask/full split is carried by types

`CustomerListView` has a `phoneMasked` field and **no** full-phone field; the DTO
layer repeats the split (`CustomerListItemDto` vs `CustomerDto`). A future refactor
cannot widen a page of customers into a bulk PII response by accident, because
there is no field to put the number in. The frontend mirrors it once more: a detail
response folded back into a list row is re-masked before it lands in state.

## 4. Idempotency

`POST /v1/customers` reuses the EPIC-9 pattern (D4): the key is stored on the row
under a partial unique index per company. Two branches are handled and tested:

- **Sequential retry** — the key is found, the stored row is replayed.
- **Concurrent retry** — both requests race, the loser of the unique index replays
  the winner's row rather than surfacing a spurious `409`.

A replay writes **nothing** — no audit row, no event — and the controller answers
`200`, not `201`, because nothing was created.

## 5. Export — the one bulk-PII path

Export is where a customer module leaks if it is going to. Three properties, all
delivered:

1. **Gated** by `customers.manage` (D2 — no new catalog action).
2. **Audited and emitted _before_ the rows are returned.** The `audit_log` row and
   `customer.exported` are written first; there is no ordering in which rows leave
   the process untraced.
3. **Bounded.** A hard 5000-row cap per call, and the filters travel in the
   **request body** rather than a query string — a phone used as a filter must not
   land in a URL or an access log.

## 6. Derived KPIs with no write path

`ordersCount` / `totalSpent` / `lastOrderAt` exist as columns and are absent from
every request DTO, every service command and every repository input type. There is
no layer at which a caller could set them. Same discipline as
`product_variants.average_cost` in EPIC-8 — and the same reason: a column that gets
"temporarily" hand-written to demo a screen is a number nobody can trust afterwards.

## 7. Privacy rules, verified

Each rule in [privacy-model.md](privacy-model.md) §6 has a delivered counterpart:

| Rule                              | How it holds                                                      |
| --------------------------------- | ----------------------------------------------------------------- |
| No PII in `audit_log.changes`     | Audit records carry ids and **field names** (`{ fields: [...] }`) |
| No PII in an event payload        | `customer.*` payloads are ids, field names, and a count           |
| No PII in a URL or query string   | Exact-phone lookup is a filter; export filters are a body         |
| No PII in a cursor                | Cursors carry `createdAt`/`name` + id only                        |
| Bulk egress gated **and** audited | §5 above                                                          |
| Decrypt late, for few rows        | Masked lists; full value on the detail read only                  |

## 8. Validation & error mapping

Unified envelope throughout: duplicate phone → `409` naming the `phone` **field**
(never the colliding row's id — that would confirm a record the caller may have no
right to read); un-normalizable phone and unknown `governorateId` → `422`; tampered
cursor → `400`; no active company → `403`; a customer outside the tenant → `404`,
never a cross-tenant disclosure.

## 9. API surface

9 routes: 6 on the customer (list, create, export, detail, update, archive) and 3
nested address routes. All three-layer gated; reads `customers.read`, every write
including export `customers.manage`. No access-catalog change, as D2 required.

## 10. Frontend

One responsive card list serves both shells. The privacy split is visible in the
_flow_, not just the markup: the list renders masked phones, and the full number is
fetched only when the user opens a customer. Editing starts with a blank phone
field and omits it unless typed, so a save cannot write the mask back over the
stored number. A `409` gets its own message — a duplicate phone is the one write
error a back-office user can actually act on.

## 11. Documentation

Contract marked delivered (9 routes, export semantics, replay status codes);
`customer.*` live in [events.md](events.md); `customer.merged` still reserved;
metrics, domain map and privacy model refreshed; deferrals listed explicitly in the
contract, the domain doc and the plan.

---

## Findings & fixes during review

- **No defects found.** Every local gate was re-run from a cold cache and was green
  on the first pass (numbers in the gate doc).
- **Scope note, not a defect:** M10.3 was specified as presentation-only, but the
  export route needed a bulk read that did not exist, so `exportAll` was added to
  the repository port and the repository, and `export` to the service, in the same
  milestone. Recorded rather than hidden — the alternative was an export route with
  no way to export.
- **Carried forward:** the shared cross-module idempotency store remains debt (each
  module still implements the key locally); duplicate customers created before
  EPIC-11 can only be resolved by archiving one by hand (accepted under D3).

## Verdict

**PASS.** EPIC-10 delivers a customer base whose privacy properties are structural
rather than procedural: the uniqueness rule is a database index, the mask/full split
is a type distinction, the KPI columns have no write path at any layer, and the only
bulk-PII route cannot execute without leaving an audit row. The epic attached to
existing seams with **no core change** — no new access-catalog action, no new
cross-cutting concern — and its two deferrals (merge, order history) are explicit
and owned by EPIC-11.

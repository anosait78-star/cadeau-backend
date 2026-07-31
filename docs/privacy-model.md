# Privacy Model — Sensitive Field Storage

**Status:** ✅ Binding · **Owner decision:** 2026-07-31 (EPIC-9 closure, decision D1)
· Implements [ADR-0001 Security First](adr/0001-security-first.md) ·
**Implemented and verified in EPIC-10** (2026-07-31) — every rule in §6 is now
carried by delivered code and covered by tests; see
[customers-review.md](customers-review.md) §Privacy and
[epic-10-quality-gate.md](epic-10-quality-gate.md) §1.

How every sensitive field in Cadeau CRM is stored, whether it can be made unique,
and whether it can be searched. Read this **before adding any column that holds
personal data** — the storage strategy is a schema decision and is expensive to
change after data exists.

The short version: **encryption and searchability are mutually exclusive, so we
separate them into two columns** — a ciphertext column nobody can index and a keyed
blind-index column that supports uniqueness and exact lookup but reveals nothing on
its own.

---

## 1. The five strategies

| #   | Strategy                     | Mechanism                           | Reversible | Unique-indexable | Exact lookup | Partial search |
| --- | ---------------------------- | ----------------------------------- | :--------: | :--------------: | :----------: | :------------: |
| 1   | **Plaintext**                | stored as-is                        |    n/a     |        ✅        |      ✅      |       ✅       |
| 2   | **Ciphertext**               | AES-256-GCM, random IV per write    |     ✅     |        ❌        |      ❌      |       ❌       |
| 3   | **Blind index**              | HMAC-SHA256 under a server key      |     ❌     |        ✅        |      ✅      |       ❌       |
| 4   | **Ciphertext + blind index** | strategies 2 and 3 side by side     | ✅ (via 2) |    ✅ (via 3)    |  ✅ (via 3)  |       ❌       |
| 5   | **One-way hash**             | scrypt (secrets) / SHA-256 (tokens) |     ❌     |        ✅        |      ✅      |       ❌       |

Why (2) cannot be unique or searched: GCM uses a **fresh random IV on every
encryption**, so the same phone number encrypts to a different token each time.
That is the property that makes the ciphertext safe, and it is exactly what makes
it useless as an index key. Deterministic encryption would restore indexability but
leaks equality _and_ is reversible by anyone holding the key — strictly worse than a
blind index.

## 2. Field inventory

| Field                            | Strategy               | Unique             | Searchable          | Why                                                                                                                                                                                      |
| -------------------------------- | ---------------------- | ------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles.email`                 | 1 plaintext (`citext`) | ✅ global          | ✅                  | It is the **login identifier**; a user must be able to type it, and account recovery / invitations resolve by it. Treated as a credential-adjacent identifier, not as protected content. |
| `profiles.password_hash`         | 5 scrypt               | —                  | —                   | Never reversible by design.                                                                                                                                                              |
| `profiles.phone_encrypted`       | 2                      | ❌                 | ❌                  | Staff phone: displayed to its owner, never looked up by.                                                                                                                                 |
| `profiles.totp_secret_encrypted` | 2                      | ❌                 | ❌                  | Must be reversible to verify a code; never leaves the server.                                                                                                                            |
| `sessions.refresh_token_hash`    | 5                      | ✅                 | ✅ (by exact token) | The presented token is hashed and compared.                                                                                                                                              |
| `invitations.code_hash`          | 5                      | ✅                 | ✅ (by exact code)  | Same shape as above.                                                                                                                                                                     |
| `invitations.email`              | 1 (`citext`)           | ❌                 | ✅                  | Mirrors `profiles.email`; the invite is addressed to it.                                                                                                                                 |
| **`customers.phone_encrypted`**  | **4**                  | — (paired)         | ❌                  | End-customer PII. Reversible so the back office can call.                                                                                                                                |
| **`customers.phone_hash`**       | **4**                  | ✅ **per company** | ✅ exact            | Carries the E.164 uniqueness rule and the lookup.                                                                                                                                        |
| `customers.email`                | 1 (`citext`)           | ❌                 | ✅                  | Optional, low-sensitivity, needed in `q` search. Reconsider if it ever becomes a login identity.                                                                                         |
| `customers.name`                 | 1                      | ❌                 | ✅                  | Must be partially searchable; a name alone is weak PII.                                                                                                                                  |
| `customer_addresses.line`        | 2                      | ❌                 | ❌                  | Delivery address is high-sensitivity and never searched.                                                                                                                                 |
| `audit_log.changes`              | — (JSON)               | —                  | —                   | **Must never contain plaintext PII** — see §6.                                                                                                                                           |

Everything else in the schema is business data, not personal data.

## 3. The blind index

**Definition.** `phone_hash = HMAC-SHA256(key = PII_HASH_KEY, message = normalize(phone))`,
stored as 64 lowercase hex characters.

**Normalization is part of the contract.** The message is the **E.164 form** —
`+` followed by digits only, no spaces, dashes, or parentheses. `+20 100 123 4567`,
`+201001234567` and `00201001234567` must all normalize to `+201001234567` before
hashing, or the uniqueness rule silently fails to catch a duplicate. Normalization
happens once, in the domain layer, and the same function serves writes and lookups.

**Why HMAC and not a plain hash.** A bare `SHA256(phone)` is trivially brute-forced:
the space of Egyptian mobile numbers is about 10⁸, which a laptop enumerates in
seconds. The HMAC key turns that into an infeasible attack **for anyone who does not
hold the key** — which is the whole point, because the key lives in the application
environment, never in the database. An attacker with a database dump alone learns
nothing; an attacker with a dump _and_ the key is already in a position to decrypt
the ciphertext anyway.

**Key management.** `PII_HASH_KEY` is a new required 32-byte (64 hex char) secret in
`@cadeau/config`, **distinct from `ENCRYPTION_KEY`**. Two separate keys means
compromising the search index does not compromise the plaintext, and the two can be
rotated on different schedules. It is validated by the same schema rules as
`ENCRYPTION_KEY` (hex, length, no placeholder value in production) and is redacted
from every config dump and log line.

**What it still leaks, honestly.** Equality. Two customers in the same company with
the same phone produce the same hash — that is the feature. Someone holding the key
_and_ a candidate phone number can confirm whether that number exists. Neither is
avoidable in any scheme that also enforces uniqueness, and both are acceptable at
this threat level.

**Rotation.** Rotating `PII_HASH_KEY` invalidates every stored hash, so it is a
migration, not a config change:

1. Add `phone_hash_next`, and dual-write it under the new key.
2. Backfill `phone_hash_next` for existing rows (requires decrypting
   `phone_encrypted` — which is why the ciphertext column is the source of truth,
   not the hash).
3. Cut lookups over to the new column, drop the old one, rename.

The ciphertext column is what makes rotation possible at all. **A blind index is
never the only copy of a value.**

## 4. Uniqueness

`phone_hash` is unique **per company**, not globally:

```sql
CREATE UNIQUE INDEX customers_company_phone_key
  ON public.customers (company_id, phone_hash);
```

Two different tenants may each have a customer with the same phone — they are
different businesses with different relationships to that person, and a global
unique index would leak the existence of a customer across tenant boundaries. The
index sits **inside** the RLS boundary like every other tenant constraint.

A violation surfaces as `409 CONFLICT` naming the `phone` field — never the id of
the colliding row, which would itself be a cross-record disclosure.

## 5. Search

| Query the user wants                    | Supported | How                                                 |
| --------------------------------------- | :-------: | --------------------------------------------------- |
| "find the customer with +201001234567"  |    ✅     | Normalize → HMAC → indexed equality on `phone_hash` |
| "find customers whose number ends 4567" |    ❌     | Not possible against a blind index                  |
| "find customers named أحمد"             |    ✅     | `contains` on `name`                                |
| "find by email"                         |    ✅     | `contains` on `email`                               |

`q` is therefore defined as: **if the term normalizes to a valid E.164 number, look
it up by hash; otherwise search name and email.** This is the deliberate cost of
strategy 4, accepted at the EPIC-9 closure. In COD social commerce the phone lookup
that matters is exact — the customer states their full number — so the loss is
small and the PII posture is materially better than plaintext.

If partial-phone search ever becomes a real requirement, the options are (a) store
an additional blind index over the **last N digits** — cheap, but it deliberately
weakens the guarantee and creates collisions by design, or (b) accept plaintext.
Both are owner decisions, not implementation details.

## 6. Cross-cutting rules

1. **PII never enters `audit_log.changes`.** Audit a _reference_ (`entityType` +
   `entityId`) and the field **names** that changed, never plaintext values. The
   audit log is the one table read across tenants by platform admins.
2. **PII never enters an event payload.** The event bus carries ids, not people;
   consumers that need the value read it back under RLS with their own permissions.
3. **PII never enters a URL, a query string, or a log line.** Exact-phone lookup is
   a body/filter parameter, not a path segment.
4. **PII never enters a cursor.** Keyset cursors are opaque but not secret; they may
   only carry sort keys that are not personal data (id, timestamps).
5. **Bulk PII egress is permission-gated _and_ audited.** Export requires
   `customers.manage` (owner decision D2 — no new permission action) and writes an
   `audit_log` row plus a `customer.exported` event before the file is produced.
   There is no unaudited path to bulk PII.
6. **Decrypt as late as possible, for as few rows as possible.** List responses
   return masked phones (e.g. `+2010•••4567`); the full value is decrypted on the
   detail read only.

## 7. Adding a new sensitive field

Answer three questions in order, and the strategy falls out of the table in §1:

1. **Does anything need to read the original value back?** No → strategy 5 (one-way
   hash). Yes → continue.
2. **Does it need to be unique, or looked up exactly?** No → strategy 2 (ciphertext
   only). Yes → continue.
3. **Does it need _partial_ search?** No → strategy 4 (ciphertext + blind index).
   Yes → you are asking for plaintext; that requires an explicit owner decision
   recorded here, not a default.

Record the outcome in the §2 table in the same commit as the migration.

---

**See also:** [adr/0001-security-first.md](adr/0001-security-first.md) ·
[adr/0003-three-layer-access.md](adr/0003-three-layer-access.md) ·
[epic-10-design.md](epic-10-design.md) (decision D1) ·
[security/](security/) · [api-conventions.md](api-conventions.md)

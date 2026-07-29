# API Conventions

The **binding reference for every REST endpoint** in Cadeau CRM. All modules
implement to this document; a deviation requires an explicit decision recorded
here (or an ADR). It extends the runtime already shipped in
[backend-foundation.md](backend-foundation.md) — the error envelope, request-id
middleware, and `/v1` prefix described here are the ones the code actually
produces.

> **Governed by** ADR-001 (Security First) · ADR-003 (server-enforced access) ·
> ADR-004 (extensible core). Per-module contracts live under [`docs/api/`](api/README.md).

---

## 1. Versioning

- **URI major versioning**: every route is prefixed with `/v1`. There is exactly
  one major in the path (`/v1`, later `/v2`), never minor/patch.
- **Additive changes are non-breaking and ship without a version bump**: adding a
  field, a new optional query param, a new endpoint, or a new enum value clients
  must tolerate. Clients MUST ignore unknown response fields.
- **Breaking changes require a new major** (`/v2`): removing/renaming a field,
  changing a type, tightening validation, changing default behaviour.
- **Deprecation** is signalled per response with headers `Deprecation: true`, an
  optional `Sunset: <HTTP-date>`, and a human `Warning` header. Deprecated
  surfaces keep working until their sunset.

## 2. Success responses

There is no blanket `{ data }` wrapper for single resources — it is added only
where it carries meaning (collections).

### 2.1 Single resource

Return the resource object **directly** (HTTP `200`, or `201` on create):

```http
GET /v1/orders/ord_123 → 200
{ "id": "ord_123", "status": "confirmed", "collectedAmount": 15000, "currency": "EGP", ... }
```

`/v1/health` follows this exactly today (a single status resource returned raw).

### 2.2 Collection (list) — always enveloped

Lists are wrapped so pagination metadata has a home:

```jsonc
{
  "data": [
    /* array of resources */
  ],
  "page": {
    "limit": 25,
    "nextCursor": "b3JkXzEyMw", // opaque; null on the last page
    "hasMore": true,
  },
}
```

- `data` is always an array (empty `[]`, never `null`).
- Collections never return a raw array at the top level (prevents JSON-array
  hijacking and leaves room for metadata).

### 2.3 Status codes

| Code             | Use                                                                |
| ---------------- | ------------------------------------------------------------------ |
| `200 OK`         | Successful read / update.                                          |
| `201 Created`    | Resource created; body is the new resource; `Location` header set. |
| `202 Accepted`   | Work queued (async job); body describes how to track it.           |
| `204 No Content` | Successful delete / action with no body.                           |
| `4xx` / `5xx`    | Always the **error envelope** (§3).                                |

## 3. Error envelope

Every non-2xx response is the exact shape the global exception filter emits:

```jsonc
{
  "error": {
    "code": "NOT_FOUND", // stable machine code (§3.1)
    "message": "Order not found", // human-readable, client-safe
    "statusCode": 404, // mirrors the HTTP status
    "requestId": "7260f4f1-…", // == x-request-id response header
    "timestamp": "2026-07-28T08:10:17.244Z",
    "path": "/v1/orders/ord_x",
    "details": null, // present only when there is structured detail
  },
}
```

- Clients **switch on `error.code`**, never on the HTTP status alone or on the
  human message.
- Unexpected server errors always collapse to `500 / INTERNAL` with a generic
  message; the real cause is logged, never returned (no internal leakage).

### 3.1 Error codes

The canonical set (extend in code at [`error-codes.ts`](../apps/api/src/shared/errors/error-codes.ts);
never repurpose an existing one):

| `code`                 | HTTP | Meaning                                                                   |
| ---------------------- | ---- | ------------------------------------------------------------------------- |
| `BAD_REQUEST`          | 400  | Malformed request the schema could not accept.                            |
| `VALIDATION_FAILED`    | 400  | Body/params failed validation (see §4).                                   |
| `UNAUTHORIZED`         | 401  | Missing/invalid authentication.                                           |
| `FORBIDDEN`            | 403  | Authenticated but not permitted (subscription/flag/permission — ADR-003). |
| `NOT_FOUND`            | 404  | Resource does not exist (or is out of the caller's tenant).               |
| `METHOD_NOT_ALLOWED`   | 405  | Verb not supported on the resource.                                       |
| `CONFLICT`             | 409  | State conflict (duplicate, version clash, idempotency mismatch).          |
| `UNPROCESSABLE_ENTITY` | 422  | Well-formed but semantically invalid.                                     |
| `TOO_MANY_REQUESTS`    | 429  | Rate limit exceeded (see §11).                                            |
| `INTERNAL`             | 500  | Unexpected server error.                                                  |
| `SERVICE_UNAVAILABLE`  | 503  | Dependency down / shedding load.                                          |

> **Tenant isolation:** a resource belonging to another company is reported as
> `404 NOT_FOUND`, never `403` — we do not confirm existence across tenants.

## 4. Validation errors

Validation failures use `code: "VALIDATION_FAILED"` (HTTP 400) and carry a
flattened `details` array (produced by the global `ValidationPipe`):

```jsonc
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "statusCode": 400,
    "requestId": "…",
    "timestamp": "…",
    "path": "/v1/customers",
    "details": [
      { "field": "email", "messages": ["email must be an email"] },
      { "field": "address.city", "messages": ["city should not be empty"] },
    ],
  },
}
```

- `field` uses dotted paths for nested objects and `arr[0].field` for arrays.
- Unknown/extra properties are rejected (`whitelist + forbidNonWhitelisted`).
- All field errors are reported together (not fail-fast on the first).

## 5. Pagination (keyset / cursor — the default)

All list endpoints use **keyset (cursor) pagination**. Offset/`page-number`
pagination is **not** offered (it is slow and unstable under writes — Roadmap §16.3).

**Request**

| Param    | Default | Rules                                                                    |
| -------- | ------- | ------------------------------------------------------------------------ |
| `limit`  | `25`    | Integer `1..100`. Values above the max are clamped to `100`.             |
| `cursor` | —       | Opaque token from a previous `page.nextCursor`. Omit for the first page. |

**Response**: the collection envelope (§2.2). `page.nextCursor` is `null` on the
last page and `page.hasMore` is `false`.

### 5.1 Cursor semantics

- The cursor is **opaque** (base64url of the last row's sort keys + tie-breaker
  id). Clients must treat it as a blackbox and never construct or parse it.
- Cursors are tied to a specific `sort` + `filter` set; reusing a cursor with a
  different sort/filter is a `400 BAD_REQUEST`.
- Pagination is **stable**: an item inserted/removed mid-scroll never causes a
  skip or duplicate of already-seen rows (keyset guarantee).
- **Totals are not returned by default** (a keyset scan has no cheap count).
  Where a count is genuinely needed a resource may expose a dedicated
  `GET …/count` endpoint; this is the exception, not the rule.

## 6. Filtering

- **Simple equality**: `?status=confirmed`. Repeated or CSV values mean OR:
  `?status=confirmed,shipped`.
- **Ranges** use `From`/`To` suffixes (inclusive): `?createdAtFrom=2026-01-01&createdAtTo=2026-02-01`,
  `?totalFrom=1000`.
- **Free-text search**: `?q=<term>` (resource defines which fields it searches).
- Only a **whitelisted** set of filterable fields per resource is accepted;
  unknown filter params → `400 VALIDATION_FAILED`.
- Filter param names are `camelCase` and match the resource's field names.

## 7. Sorting

- `?sort=field` ascending, `?sort=-field` descending (leading `-`).
- Multiple keys are comma-separated, applied in order: `?sort=-createdAt,id`.
- Only **whitelisted** sort fields per resource are accepted; others →
  `400 VALIDATION_FAILED`.
- Every list has a **deterministic default sort** with a unique tie-breaker
  (typically `-createdAt,id`) so keyset cursors are stable.

## 8. Idempotency

Unsafe, non-idempotent writes (**`POST` creates**, money-moving actions) accept
an idempotency key so retries are safe:

- Header: `Idempotency-Key: <opaque, client-generated, ≤128 chars>` (a UUID is ideal).
- The server stores the first response for `(company, endpoint, key)` for **24h**
  and **replays it verbatim** for any retry with the same key.
- Same key + a **different request body** → `409 CONFLICT`.
- `GET`/`HEAD`/`PUT`/`DELETE` are already idempotent by definition and ignore the
  header.
- Endpoints that require the header (e.g. payment capture) document it in their
  contract and return `400` if it is missing.

## 9. Request IDs & 10. Correlation IDs

- **`X-Request-Id`** — identifies a single HTTP request. The server honours a
  safe inbound value (`^[A-Za-z0-9._-]{1,128}$`) or generates a UUID, echoes it
  on the response, and stamps it on every log line for that request. It appears
  in the error envelope as `requestId`. _(Already implemented — M1.5.)_
- **`X-Correlation-Id`** — identifies a logical operation that may span multiple
  requests, async jobs, webhooks, or notifications. Clients may send one to tie a
  workflow together; if absent it defaults to the request id. It propagates to
  emitted events and outbound calls so a whole flow can be traced end to end.
  _(Contract defined now; propagation lands with the event bus in EPIC-6.)_

Never place ids (or any identifier/PII) in query strings for sensitive calls;
they travel in headers.

## 11. Rate limiting headers

Throttled endpoints advertise limits with the IETF `RateLimit-*` fields:

| Header                | Meaning                                         |
| --------------------- | ----------------------------------------------- |
| `RateLimit-Limit`     | Requests allowed in the current window.         |
| `RateLimit-Remaining` | Requests left in the current window.            |
| `RateLimit-Reset`     | Seconds until the window resets.                |
| `Retry-After`         | On `429` only: seconds to wait before retrying. |

Exceeding a limit returns `429` with `code: "TOO_MANY_REQUESTS"`. Limits are
per-tenant and per-principal. _(Contract defined now; enforcement is a
cross-cutting guard added before launch — Roadmap EPIC-16 / §2.)_

## 12. Naming conventions

| Element              | Convention                                          | Example                                                   |
| -------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| URL path segments    | `kebab-case`, **plural** resource nouns             | `/v1/purchase-orders`, `/v1/order-labels`                 |
| Path parameters      | the resource id                                     | `/v1/orders/{orderId}`                                    |
| JSON property names  | `camelCase`                                         | `collectedAmount`, `createdAt`                            |
| Query parameters     | `camelCase`                                         | `?createdAtFrom=`, `?sort=-createdAt`                     |
| Stable machine codes | `SCREAMING_SNAKE_CASE`                              | error `code`, feature keys, permission keys               |
| Domain enum values   | `lower_snake_case`                                  | order `status: "out_for_delivery"`, health `status: "ok"` |
| Boolean fields       | positive, no `is`/`has` prefix required but allowed | `active`, `hasMore`                                       |

### 12.1 Data types

- **Timestamps**: ISO-8601 in **UTC** with `Z` (e.g. `2026-07-28T08:10:17.244Z`).
- **Money**: an **integer in minor units** (piastres/cents) plus an ISO-4217
  `currency` code — never a float. Example: `{ "amount": 15000, "currency": "EGP" }`.
- **Decimals** that are not money are transported as **strings** to avoid IEEE-754
  loss.
- **Ids**: opaque strings; clients must not assume a format.
- **Enums**: closed sets; clients tolerate unknown future values gracefully.

### 12.2 Tenancy & auth (ADR-003)

- Every non-public route requires a bearer token (`Authorization: Bearer <jwt>`).
- **`companyId` is never accepted from the client for scoping** — the tenant is
  derived server-side from the authenticated context and enforced in the BFF and
  again by Postgres RLS. Cross-tenant access surfaces as `404`.
- Access is the triple gate **Subscription ∧ Feature-Flag ∧ Permission**; a
  failure of any is `403 FORBIDDEN`.

---

## Checklist for a new endpoint

- [ ] Path is `/v1/<kebab-plural>`; ids are path params.
- [ ] Single → raw resource; list → `{ data, page }` with keyset pagination.
- [ ] Errors go through the global filter (never hand-roll a body).
- [ ] Validation via DTOs (`whitelist`), errors flattened into `details`.
- [ ] List declares its whitelisted `filter` fields, `sort` fields, and default sort.
- [ ] Create/`POST` and money actions honour `Idempotency-Key`.
- [ ] Access gated by subscription + feature flag + permission (ADR-003).
- [ ] Documented in the module's contract under [`docs/api/`](api/README.md) and in OpenAPI.

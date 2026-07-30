# Master Data API Contract

**Status:** ✅ Delivered — **EPIC-7** · **Base path:** `/v1/master-data` ·
**Feature key:** `master-data` · **Access:** authenticated + three-layer gated

Shared reference data every other module builds on: currencies, country configs,
governorates, order labels/reasons, product categories, units, and shipping
zones. Served as a cached, authoritative source. Follows
[../api-conventions.md](../api-conventions.md).

## Resources

One generic engine (a resource registry + generic controller/service/repository)
serves eight collections. Three are **system reference** (product data, the same
in every tenant, **read-only via the API**, written only by the idempotent system
seed); five are **tenant-editable** (each company curates its own rows).

| Resource             | Scope  | Key    | Attributes                                 | Notes                                 |
| -------------------- | ------ | ------ | ------------------------------------------ | ------------------------------------- |
| `currencies`         | system | `code` | `name`, `symbol`, `decimalDigits`          | ISO-4217. Read-only.                  |
| `country-configs`    | system | `code` | `name`, `defaultCurrencyCode`, `phoneCode` | ISO-3166 α-2. Read-only.              |
| `governorates`       | system | `id`   | `countryCode`, `name`                      | Per country. Read-only.               |
| `units`              | tenant | `id`   | `name`, `code`                             | Units of measure.                     |
| `product-categories` | tenant | `id`   | `name`, `parentId`                         | Self-nesting (same-tenant ref).       |
| `order-labels`       | tenant | `id`   | `name`, `color`                            | `color` is a hex swatch.              |
| `order-reasons`      | tenant | `id`   | `name`, `kind`                             | `kind` ∈ cancellation/return/general. |
| `shipping-zones`     | tenant | `id`   | `name`, `countryCode`                      | Shipping grouping.                    |

Every row also carries `active` (soft-delete flag), `createdAt`, `updatedAt`. The
key is exposed as `id` in responses (the ISO `code` for the code-keyed reference
tables).

## Endpoints

| Method | Path                              | Purpose                         | Permission           |
| ------ | --------------------------------- | ------------------------------- | -------------------- |
| GET    | `/v1/master-data`                 | List the resources (discovery). | `master-data.read`   |
| GET    | `/v1/master-data/{resource}`      | List (keyset, cached source).   | `master-data.read`   |
| POST   | `/v1/master-data/{resource}`      | Create (tenant only).           | `master-data.manage` |
| GET    | `/v1/master-data/{resource}/{id}` | Read one.                       | `master-data.read`   |
| PATCH  | `/v1/master-data/{resource}/{id}` | Update (tenant only).           | `master-data.manage` |
| DELETE | `/v1/master-data/{resource}/{id}` | Deactivate (soft-delete).       | `master-data.manage` |

- Every route is gated by **Subscription ∧ Feature-Flag (`master-data`) ∧
  Permission** (ADR-003); any failure is `403 FORBIDDEN`.
- A **write to a system resource** (`currencies`/`country-configs`/`governorates`)
  is `403 FORBIDDEN` — that data is system-managed (edited via a code change +
  re-seed, never the API).
- Unknown `{resource}` → `404 NOT_FOUND`. Unknown `{id}` (or another tenant's
  row) → `404 NOT_FOUND`.
- Create returns `201` with a `Location` header; delete returns `204`.

## List parameters

- **Pagination:** keyset only (`limit` 1–100 default 25, opaque `cursor`).
- **Filter `active`:** `true` (default — active only), `false` (inactive only),
  or `all`.
- **Search `q`:** substring, case-insensitive, over the resource's searchable
  fields (`name`, plus `code` where present).
- **Resource filters:** `order-reasons?kind=`, `governorates?countryCode=`,
  `product-categories?parentId=`, `shipping-zones?countryCode=`. An unknown
  filter param → `400 VALIDATION_FAILED`.
- **Sort (whitelist):** `name` (default) and `createdAt`, each optionally
  `-`-prefixed; the key's tie-breaker (`id`/`code`) keeps cursors stable. A
  non-whitelisted sort → `400 VALIDATION_FAILED`.

## Validation

Bodies are validated to the api-conventions §4 shape: required/typed fields,
trimmed strings, length/range/enum checks, hex-color check for `color`, uuid
check for `parentId`; unknown properties are rejected. A same-tenant reference
that does not resolve (`parentId`) → `422 UNPROCESSABLE_ENTITY`. A unique clash
(e.g. a duplicate name within the company) → `409 CONFLICT`.

## Events emitted (ADR-004)

- `master_data.changed` — payload `{ resource, id, change }` where `change` ∈
  `created`/`updated`/`deactivated`. Emitted through the EPIC-6 event bus on every
  write, **alongside** the durable `audit_log` write (audit is the source of
  truth; the event is additive). Consumers (later modules that cache reference
  data) invalidate on it. See [../events.md](../events.md).

## Caching

The service memoizes the **active** set per `(resource, scope)` for 60s
(`scope` = the companyId for tenant resources, `system` otherwise) as the cached
reference source later modules read on hot paths. Every write invalidates that
entry, so reads are fresh after a change.

## Notes

- System reference data is **system-seeded** (idempotent): currencies (EGP, USD,
  EUR, SAR, AED), country configs (EG + SA + AE), and Egypt's 27 governorates.
  See `packages/database/src/seed/master-data/`.
- Deletes are soft (`active=false`) to preserve historical references; a later
  `PATCH … { "active": true }` reactivates a row.
- Tenant tables carry the base columns + `FORCE` RLS scoped by `company_id`;
  system tables use public-read + null-context seed-write RLS (the EPIC-5 catalog
  pattern). Both enforced again by Postgres RLS (two-layer isolation).

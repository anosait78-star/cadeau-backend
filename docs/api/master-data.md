# Master Data API Contract

**Status:** ⬜ Draft — planned in **EPIC-7** · **Base path:** `/v1/master-data` ·
**Feature key:** `MASTER_DATA` · **Access:** authenticated + gated

Shared reference data every other module builds on: currencies, country configs,
governorates/shipping zones, order labels/reasons, product categories, and units.
Served as a cached, authoritative source. Draft — follows
[../api-conventions.md](../api-conventions.md).

## Resources

- `Currency`, `CountryConfig`, `Governorate`, `ShippingZone`,
  `OrderLabel`, `OrderReason`, `ProductCategory`, `Unit`.

## Planned endpoints

Per collection (`{resource}` ∈ the resources above), the standard CRUD shape:

| Method | Path                              | Purpose                  | Permission           |
| ------ | --------------------------------- | ------------------------ | -------------------- |
| GET    | `/v1/master-data/{resource}`      | List (keyset, cached).   | `master-data.read`   |
| POST   | `/v1/master-data/{resource}`      | Create. Idempotency-Key. | `master-data.manage` |
| GET    | `/v1/master-data/{resource}/{id}` | Read one.                | `master-data.read`   |
| PATCH  | `/v1/master-data/{resource}/{id}` | Update.                  | `master-data.manage` |
| DELETE | `/v1/master-data/{resource}/{id}` | Deactivate.              | `master-data.manage` |

## List parameters

- Filter: `active`, plus resource-specific (`countryCode`, `governorateId`, …).
- Sort (whitelist): `name`, `-createdAt,id` (default varies per resource).
- Search `q`: over `name`/`code`.

## Events emitted (ADR-004)

- `master_data.changed` (with `resource` + `id`) — consumers invalidate caches.

## Notes

- Some reference data is **system-seeded** (idempotent) and read-only per tenant;
  others are tenant-editable. Each resource states which in EPIC-7.
- Deletes are soft (`active=false`) to preserve historical references.

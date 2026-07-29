# Core Data + Security Layer (EPIC-3)

EPIC-3 establishes the **data-layer security foundation** every tenant table
builds on — not the domain tables themselves. Tenant tables
(companies/members/profiles) are owned by **EPIC-4 (Auth)**, access tables by
**EPIC-5**, and domain tables by **EPIC-7+**. This epic delivers the _patterns_
and the first foundation table (`audit_log`).

> **Governed by** ADR-001 (security first) and ADR-003 (server-enforced access).
> Builds on the M1.4 RLS primitive `app.current_company_id()` — see
> [database.md](database.md).

## Two-layer tenant isolation

Every tenant-scoped access passes **two independent checks** (Roadmap §1); both
must agree and neither is trusted alone:

1. **Application layer (BFF):** repositories scope and stamp every query by
   `company_id` using the helpers in
   [`repository.ts`](../packages/database/src/repository.ts) —
   `scopedWhere`, `stampForCreate`, `stampForUpdate`.
2. **Database layer (RLS):** Postgres Row-Level Security re-enforces the same
   isolation. Policies reference `app.current_company_id()`, which reads the
   per-transaction `app.company_id` GUC set by `withTenantTransaction`.

**RLS is `FORCE`d**, so it applies even to the role that owns the tables (the one
the BFF connects as) — isolation cannot be bypassed by table ownership.

## Base table conventions (§16.2)

Every tenant table created by later epics carries these columns:

| Column                                  | Notes                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| `id uuid`                               | PK, `DEFAULT gen_random_uuid()` (pgcrypto, from M1.4).                           |
| `company_id uuid`                       | Tenant key. Indexed; RLS-scoped; never accepted from the client.                 |
| `created_by` / `updated_by uuid`        | Acting member (nullable until Auth — EPIC-4). Stamped by the repository helpers. |
| `created_at` / `updated_at timestamptz` | `DEFAULT now()`. `updated_at` is refreshed by the DB trigger below.              |

And each attaches the reusable trigger + RLS policy pattern:

```sql
-- updated_at is authoritative at the database, never trusted from the client:
CREATE TRIGGER <table>_touch_updated_at BEFORE UPDATE ON public.<table>
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.<table> FORCE  ROW LEVEL SECURITY;
CREATE POLICY <table>_tenant ON public.<table>
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());
```

`app.touch_updated_at()` is created once (EPIC-3) and reused by every table.
Models stay in the default `public` schema (multi-schema is a Prisma preview
feature, forbidden by ADR-001); the `app` schema holds only helper functions.

## `audit_log`

The first foundation table: an **append-only**, tenant-isolated audit trail
([model](../packages/database/prisma/schema.prisma),
[migration](../packages/database/prisma/migrations/20260729000000_audit_log_and_conventions/migration.sql)).

- Columns: `id`, `company_id`, `actor_id?`, `action`, `entity_type`, `entity_id?`,
  `changes jsonb?`, `request_id?`, `created_at`.
- **Append-only enforced by RLS:** only `SELECT` and `INSERT` policies exist (both
  tenant-scoped). With RLS enabled and no `UPDATE`/`DELETE` policy, those commands
  are denied for everyone — rows are immutable at the database.
- Indexed for keyset reads: `(company_id, created_at DESC, id DESC)` and for
  entity history `(company_id, entity_type, entity_id)`.

## Keyset pagination

The project's only list-pagination strategy (Roadmap §16.3,
[api-conventions §5](api-conventions.md)). [`keyset.ts`](../packages/database/src/keyset.ts):

- `clampLimit(requested, { defaultLimit, maxLimit })` — default 25, max 100.
- `encodeCursor` / `decodeCursor` — opaque, url-safe tokens over the last row's
  sort keys; malformed cursors raise `InvalidCursorError`.
- `buildKeysetPage(rows, limit, toCursor)` — fetch `limit + 1` rows; the extra row
  determines `hasMore` and `nextCursor` without a count query. Returns the
  `{ data, page: { limit, nextCursor, hasMore } }` envelope from api-conventions §5.

Callers translate a decoded cursor into their table's keyset `WHERE` predicate
(e.g. `createdAt < :createdAt OR (createdAt = :createdAt AND id < :id)`).

## Verification

The TS helpers (keyset, repository) are unit-tested (Vitest). The migration —
`touch_updated_at`, `audit_log`, RLS policies, indexes — is validated by the CI
**`database`** job (`migrate deploy` + `migrate status` + idempotent seed on real
PostgreSQL), the same gate M1.4 established.

# Health API Contract

**Status:** ✅ Implemented (EPIC-1 / M1.5) · **Base path:** `/v1/health` ·
**Access:** public (no auth, no feature gate) · **Feature key:** — (infrastructure)

Liveness/readiness probes. Single status resources returned raw (per
[conventions §2.1](../api-conventions.md#21-single-resource)). See
[backend-foundation.md](../backend-foundation.md).

## Resources

- `Liveness` — `{ status: "ok", uptimeSeconds }`.
- `Readiness` — `{ status: "ok" | "degraded" | "down", uptimeSeconds, dependencies: { database: { status, latencyMs, error? } } }`.

## Endpoints

| Method | Path               | Purpose                                             | Permission |
| ------ | ------------------ | --------------------------------------------------- | ---------- |
| GET    | `/v1/health`       | Liveness — process is up. Always `200`.             | public     |
| GET    | `/v1/health/ready` | Readiness — dependency probes. `200` with `status`. | public     |

## List parameters

None (no collections).

## Events emitted

None.

## Notes

- Readiness returns `200` even when `degraded`; callers key off the `status`
  field, not the HTTP status. The database probe never throws.
- No tenant scoping — these are infrastructure probes.

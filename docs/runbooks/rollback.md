# Rollback Runbook

How to safely undo a bad change to Cadeau CRM. Covers the three layers of the
Rollback Strategy (Roadmap §2.3): **database**, **application**, and **features**.
Every release must have a completed copy of the pre-deployment checklist at the end
of this document before it ships.

> Principle: **prefer rolling _forward_** with a corrective migration/deploy over
> destructive rollback. The Expand → Migrate → Contract pattern is what makes going
> back safe; never rewrite migration history that has been applied to a shared
> environment.

---

## 1. Feature rollback (fastest — no deploy)

If the problem is isolated to a feature, disable its flag. This is the first thing to
try because it takes effect immediately without a deploy (soft rollback).

1. Toggle the feature's flag off (Super Admin panel / feature-flag store — available
   from EPIC-5).
2. Confirm the feature is gone from menu, pages, and APIs (three-layer access).
3. File a follow-up to fix forward.

_Not applicable during M1.4 (no feature flags yet) — listed here as the standing
first response once EPIC-5 lands._

---

## 2. Application rollback (redeploy the previous image)

The application ships as immutable, digest-pinned container images, so rollback is
re-deploying the last known-good image.

1. Identify the last good image digest from the deploy log / registry.
2. Re-deploy that digest to the target environment.
3. Verify `GET /v1/health` is green (health endpoint lands in M1.5) and error rates
   return to baseline.

**Compatibility rule:** only roll the app back to a version whose expected schema is
still present. Because migrations are Expand/Contract, the previous app version keeps
working against the newer schema **as long as the destructive Contract migration for
those objects has not run yet**. If a Contract migration has already dropped something
the old app needs, roll the database back first (§3) or fix forward.

---

## 3. Database rollback

Order of preference: **(a) corrective forward migration → (b) documented per-migration
down step → (c) Point-in-Time Recovery.**

### 3a. Corrective forward migration (preferred)

Write a new migration that reverses the unwanted change (e.g. drop the column a bad
migration added, or re-add one it removed) and apply it forward:

```bash
pnpm --filter @cadeau/database db:migrate:deploy
```

This keeps history append-only and is auditable. Prefer it whenever the change is not
data-destructive.

### 3b. Per-migration rollback step

Every migration that touches data or is not trivially reversible must ship with a
documented rollback in its PR description (the reverse SQL and its data impact). To roll
back one migration in a shared environment, apply that reverse SQL as a **new** forward
migration (do **not** delete the applied migration directory or edit
`_prisma_migrations`).

For the M1.4 infrastructure migration (`20260728000000_init_infrastructure`), the reverse
is (destructive — removes the RLS primitive and extensions; only for a full teardown):

```sql
DROP FUNCTION IF EXISTS app.current_company_id();
DROP SCHEMA IF EXISTS app;      -- only if nothing else depends on it
DROP EXTENSION IF EXISTS citext;
DROP EXTENSION IF EXISTS pgcrypto;
```

### 3c. Point-in-Time Recovery (last resort — data loss window)

When a migration or bad write corrupted data and neither 3a nor 3b is sufficient:

1. **Stop writes** to the affected database (scale the app to zero / maintenance mode).
2. Restore the automated backup and replay WAL to a timestamp **just before** the bad
   change (PITR).
3. Reconcile any writes that happened after that timestamp (from logs / the events
   stream) and communicate the recovery window.
4. Bring the app back and verify health.

> PITR and automated backups are provided by the managed Postgres platform in
> staging/production. **Local development has no PITR** — use `db:reset` to rebuild.

### Local development reset (dev only)

```bash
pnpm --filter @cadeau/database db:reset   # drops, re-migrates, re-seeds — DEV ONLY
```

---

## 4. Verifying a rollback

- Migrations: `pnpm --filter @cadeau/database db:migrate:status` shows the expected state.
- Database health: `GET /v1/health` green (M1.5+).
- Seed integrity: `pnpm --filter @cadeau/database db:seed` runs clean and idempotent.
- Errors/latency back to baseline; no tenant-isolation regressions.

---

## 5. Pre-deployment checklist (complete before every release)

- [ ] Last known-good image digest recorded for app rollback.
- [ ] Every migration in this release is Expand/Contract-safe (no destructive Contract
      in the same release that introduces the new shape).
- [ ] Each data-touching migration has a documented reverse + data-impact note.
- [ ] Automated backup / PITR confirmed available for the target database.
- [ ] Feature flags identified for any risky new behaviour (soft rollback path).
- [ ] This runbook's steps validated against staging.

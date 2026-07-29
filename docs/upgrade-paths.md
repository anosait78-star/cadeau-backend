# Dependency Upgrade Paths & Policy

This document records the reasoning behind major-version pins that are deliberate
engineering decisions, and the policy for moving off them. It exists so that a
pin is never mistaken for neglect or an accident of the local environment: each
one is a decision with explicit trigger conditions, risks, and a verification
gate that must pass before we move.

The controlling principle is **ADR-001 (Security First)**: we run **Stable
releases only** and we do not adopt a new major until it is both stable _and_
verified against our own gates. Being on the newest major is not a goal;
being on a **secure, supported, verifiable** major is.

---

## Prisma — pinned to `6.x` (currently `6.19.3`)

### Why Prisma 6, and not Prisma 7?

Prisma 6 is chosen because it is, today, the version that gives us the strongest
combination of **stability, ecosystem compatibility, and verifiability** for our
stack (NestJS + strict TypeScript/`NodeNext` + `@cadeau/database` as a build-time
library package). This is an architectural decision about the ORM foundation the
whole data layer sits on — **not** a workaround for any local tooling gap.

To be explicit, because it has been asked: **the pin is not caused by Docker not
being installed on a developer machine, nor by any dev-environment limitation.**
The database CI job already runs migrations and the seed against a real
PostgreSQL 17 service on every push (`.github/workflows/ci.yml` → `database`
job), so the schema and client are exercised on real Postgres regardless of any
one workstation. The reasons Prisma 6 is the right base right now are:

1. **Maturity of the major.** Prisma 6 has a long line of stable patch releases,
   a settled generator (`prisma-client-js`) output contract, and well-understood
   behaviour under our constraints. We build the data layer on a version whose
   sharp edges are already known and documented, not on the newest one whose
   edges we would be discovering ourselves.
2. **Compatibility with our strict module setup.** The client output is verified
   to consume cleanly under our `NodeNext` + strict-CJS/ESM interop settings and
   the monorepo's build pipeline (`prisma generate && tsc`). This is a concrete
   compatibility property we depend on, not a preference.
3. **Supply-chain and audit posture (ADR-001).** A mature major has a mature
   advisory history: we can assess its CVE surface with confidence and the
   stable-only gate (`scripts/check-stable-only.mjs`) passes cleanly (with the
   single documented `-<int>.<commit>` engine-pin exemption).
4. **Change budget.** Epic 1 is foundation work. Introducing a brand-new ORM
   major here would spend risk budget on the tool instead of on the domain. We
   adopt new majors deliberately, between epics, behind the gate below — never
   implicitly during foundation build-out.

### When do we move to Prisma 7?

We plan the move; we do not drift into it. Migration is scheduled — not
automatic — when **all** of the following hold:

- Prisma 7 has been **stable (GA)** for a sustained period (target: **≥ 2–3
  months** of stable patch releases with no open Critical/High regression that
  affects us), so early-adopter churn has settled.
- Prisma 7 (its client generator and query engine) is **verified compatible**
  with our stack: NestJS integration, strict `NodeNext` TypeScript, our build
  pipeline, and PostgreSQL 17.
- The move lands **between epics, at a quality gate** — never mid-epic — with its
  own ADR/changelog entry, so the decision and its blast radius are recorded.
- No adopted feature or fix we need is gated behind an _unstable_ Prisma 7
  channel (that would violate ADR-001 on its own).

There is no "upgrade because it is newer." There is only "upgrade because 7 is
now the more stable, more secure, fully-verified base, and the cost of moving is
paid deliberately."

### Upgrade preconditions (checklist)

Before we change the pin, every box must be ticked:

- [ ] Prisma 7 latest is **Stable** (no `alpha`/`beta`/`rc`/`next`/`canary` in the
      resolved tree — the stable-only gate must stay green).
- [ ] `pnpm audit --audit-level high` is clean for the new tree (no unresolved
      Critical/High) — ADR-001.
- [ ] A migration/compatibility note is written (this file is updated) capturing
      breaking changes that touch us (generator output, client API, migration
      engine, connection handling).
- [ ] A rollback path is defined and rehearsed (revert the version bump + lockfile;
      no forward-only migration is coupled to the ORM bump itself).
- [ ] Owner sign-off recorded at the epic quality gate.

### Verification steps (run before merging the bump)

Perform on a dedicated branch; do not merge until all are green:

1. **Isolate the change.** Bump `prisma` and `@prisma/client` to the exact target
   `7.x` in `packages/database/package.json` only. Refresh the lockfile with
   `pnpm install`. Nothing else in the same commit.
2. **Stable-only gate:** `node scripts/check-stable-only.mjs` — must pass.
3. **SCA:** `pnpm audit --audit-level high` — no Critical/High.
4. **Regenerate & type-check:** `pnpm --filter @cadeau/database build` then
   `pnpm type-check` across the monorepo — the generated client must compile
   under strict `NodeNext`.
5. **Unit/integration tests:** `pnpm test` — full suite green (coverage held).
6. **Real-Postgres run (CI parity):** the `database` CI job must pass end to end —
   `migrate deploy` → `migrate status` (no drift) → `db:seed` twice (idempotent).
7. **RLS behaviour unchanged:** tenant-context / `withTenantTransaction` tests
   still pass — no change in how `app.company_id` GUC isolation behaves.
8. **Architecture tests:** `pnpm arch:check` — the client's new output must not
   introduce a forbidden import or a cross-layer/cross-feature edge.
9. **Build:** `pnpm build` for the whole workspace.

### Risks (and how we contain them)

| Risk                                                             | Containment                                                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Generator output changes break strict-TS consumption             | Caught by step 4 (regenerate + `type-check`) before merge.                                                                           |
| Migration-engine behaviour drift on real Postgres                | Caught by step 6 (`migrate deploy` + `status` + double seed on PG 17).                                                               |
| New/renamed client API breaks call sites                         | Caught by steps 4–5; call sites live behind the infrastructure layer only (arch test enforces it), so the blast radius is contained. |
| A transitive dep of Prisma 7 introduces a Critical/High advisory | Caught by step 3 (`pnpm audit`); blocks the bump per ADR-001.                                                                        |
| Silent adoption of an unstable channel                           | Caught by step 2 (stable-only gate).                                                                                                 |
| Regression discovered after merge                                | Rollback path (revert bump + lockfile) is defined as a precondition; ORM bump is decoupled from any forward-only data migration.     |

---

## General policy for major-version upgrades

This is the default for **every** dependency, not just Prisma:

- **Stable only, always** (ADR-001). Pre-release channels never enter the tree;
  the stable-only gate enforces it in CI.
- **Adopt majors deliberately, at epic quality gates** — not mid-epic, not as a
  drive-by. Each major bump is isolated in its own commit with a lockfile refresh
  and nothing else.
- **Every bump passes the full gate set** before merge: format, lint, type-check,
  tests, build, `pnpm audit --audit-level high`, stable-only, architecture tests,
  and (for anything touching data) the `database` CI job on real Postgres.
- **Pin exact versions.** No `^`/`~` ranges for the tools that define our
  foundation; upgrades are explicit, reviewed edits to `package.json` + lockfile.
- **Record the decision.** A deliberate pin that lags the latest major gets an
  entry in this file explaining _why we are here_ and _what triggers the move_ —
  so the pin is always a documented decision, never an unexplained lag.

> A pin that is documented here is a **decision**. A pin that is not is a **bug**.

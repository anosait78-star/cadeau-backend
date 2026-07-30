# Permission Matrix — EPIC-5

The canonical, seeded access catalog: features, permissions, plans, and the six
permission templates. This is **reference data that lives in code**
([`packages/database/src/seed/access/catalog.ts`](../packages/database/src/seed/access/catalog.ts))
and is upserted idempotently into every environment. Adding a module = adding a
feature key here, **no core change** (ADR-0003 / ADR-0004).

> If this table and the seed ever disagree, the seed wins — update this doc.

---

## 1. Feature catalog

Nine permissioned features plus `ai` (globally inactive by default — ADR-0004).
`access` is intentionally **not** a feature: access management is core (always on),
so its permissions are feature-independent.

| Feature key     | Name                   | Category   | Globally active  | Owned by         |
| --------------- | ---------------------- | ---------- | ---------------- | ---------------- |
| `master-data`   | Master Data            | platform   | ✅               | EPIC-7           |
| `products`      | Products               | catalog    | ✅               | EPIC-8           |
| `inventory`     | Inventory & Warehouses | operations | ✅               | EPIC-9           |
| `customers`     | Customers              | operations | ✅               | EPIC-10          |
| `orders`        | Orders                 | operations | ✅               | EPIC-11          |
| `shipping`      | Shipping               | operations | ✅               | EPIC-12          |
| `finance`       | Finance & Compliance   | finance    | ✅               | EPIC-13          |
| `analytics`     | Analytics              | insights   | ✅               | EPIC-14          |
| `notifications` | Notifications          | operations | ✅               | EPIC-15          |
| `ai`            | AI                     | insights   | ❌ (kill switch) | v1.2+ (ADR-0004) |

## 2. Permission catalog

Two feature-independent `access.*` permissions, plus a `read` / `manage` pair per
permissioned feature. A permission is **effective only when its gating feature is
effective** (the `feature_permissions` edge); `access.*` has no edge and is always
available to a member who holds it.

| Permission key     | Gated by feature | Meaning                                      |
| ------------------ | ---------------- | -------------------------------------------- |
| `access.read`      | — (core)         | View access, features, permission templates  |
| `access.manage`    | — (core)         | Assign permissions/templates to members      |
| `<feature>.read`   | `<feature>`      | View that feature's data                     |
| `<feature>.manage` | `<feature>`      | Create / update / delete that feature's data |

…for each of the nine permissioned features → **20 permission keys total**
(`access.read`, `access.manage`, and 9 × {`read`,`manage`}).

## 3. Plans → features

| Feature \ Plan  | `free` | `standard` | `pro` |
| --------------- | :----: | :--------: | :---: |
| `master-data`   |   ✅   |     ✅     |  ✅   |
| `products`      |   ✅   |     ✅     |  ✅   |
| `customers`     |   ✅   |     ✅     |  ✅   |
| `orders`        |   ✅   |     ✅     |  ✅   |
| `inventory`     |   —    |     ✅     |  ✅   |
| `shipping`      |   —    |     ✅     |  ✅   |
| `notifications` |   —    |     ✅     |  ✅   |
| `finance`       |   —    |     —      |  ✅   |
| `analytics`     |   —    |     —      |  ✅   |

Add-ons (`add_ons`) grant a feature **beyond** the plan; per-company flags
(`company_feature_flags`) can force a feature on or off for one company. Both are
set by a Super-Admin. The `ai` feature is off globally and cannot be enabled by any
plan/add-on/flag until its kill switch is lifted.

## 4. Templates → permissions (the six role presets)

`R` = read, `M` = manage, `R+M` = both (the `.read` and `.manage` keys for that
feature). Under **access**, only **Owner** holds `access.manage` (`R+M`) —
assigning permissions is an Owner/Super-Admin act; the others that can view the
access screens hold `access.read` (`R`).

| Feature \ Template | Owner | Store Manager | Call Center | Warehouse | Finance | Marketing |
| ------------------ | :---: | :-----------: | :---------: | :-------: | :-----: | :-------: |
| **access**         |  R+M  |       R       |      —      |     —     |    R    |     —     |
| `master-data`      |  R+M  |       —       |      —      |     —     |    —    |     —     |
| `products`         |  R+M  |      R+M      |      —      |     R     |    —    |     —     |
| `inventory`        |  R+M  |      R+M      |      —      |    R+M    |    —    |     —     |
| `customers`        |  R+M  |      R+M      |     R+M     |     —     |    —    |     R     |
| `orders`           |  R+M  |      R+M      |     R+M     |     R     |    R    |     —     |
| `shipping`         |  R+M  |      R+M      |      —      |    R+M    |    —    |     —     |
| `finance`          |  R+M  |       R       |      —      |     —     |   R+M   |     —     |
| `analytics`        |  R+M  |       R       |      —      |     —     |    R    |     R     |
| `notifications`    |  R+M  |       —       |      —      |     —     |    —    |    R+M    |

**Reading the matrix.** These are the _template_ grants. A member's **effective**
permission is `template ± member_permissions overrides`, then filtered so a
permission is dropped unless its feature is effective for the company (plan ∪
add-ons ∩ globally-active, with flag overrides). Example: a **Store Manager** in a
`free`-plan company holds `finance.read` by template but it is **not effective** —
`finance` is not in the `free` plan, so the gating edge removes it. Enabling the
`finance` add-on (or upgrading to `pro`) makes it effective with no permission
change.

## 5. Worked resolution example

A **Store Manager** on the **`standard`** plan, with a member override granting
`analytics.manage`:

1. **Features effective** = standard plan {`master-data`,`products`,`customers`,
   `orders`,`inventory`,`shipping`,`notifications`} ∩ globally-active = same set
   (no `finance`, no `analytics`).
2. **Permissions** = Store Manager template ± overrides:
   template gives `orders/products/inventory/customers/shipping` R+M,
   `analytics/finance` R, `access.read`; override adds `analytics.manage`.
3. **Feature gating** drops `finance.read` (no `finance` feature) and **both**
   `analytics.read` and the overridden `analytics.manage` (no `analytics` feature).
4. **Effective** = `access.read` + R+M on orders/products/inventory/customers/
   shipping. The `analytics.manage` override sits dormant until analytics becomes
   effective (pro plan or add-on) — then it activates with no further change.

This is exactly the behaviour unit-tested in
[`capabilities.test.ts`](../apps/api/src/shared/access/capabilities.test.ts).

## See also

- [access-review.md](access-review.md) — the model review.
- [api/access.md](api/access.md) — endpoint contract.

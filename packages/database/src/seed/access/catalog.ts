/**
 * The EPIC-5 access catalog — the single source of truth for the system
 * reference data the access model resolves against: the feature catalog, the
 * permission catalog and its feature edges, the subscription plans, and the six
 * permission templates. The seeders in `./access-seeders.ts` upsert exactly
 * this, idempotently, so the catalog lives in code and ships to every
 * environment (ADR-004: adding a module = adding a key here, no core change).
 */

/** A feature in the catalog. `active: false` is a platform-wide kill switch. */
export interface FeatureDef {
  readonly key: string;
  readonly name: string;
  readonly category: string;
  readonly active: boolean;
}

/** A subscription plan and the feature keys it includes. */
export interface PlanDef {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly features: readonly string[];
}

/** A permission template (role preset) and the permission keys it grants. */
export interface TemplateDef {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly string[];
}

/**
 * Feature keys owned by later epics. `access` is deliberately NOT a feature —
 * access management is core (always on), so its permissions are
 * feature-independent. `ai` ships inactive (ADR-004: AI out by default).
 */
export const FEATURES: readonly FeatureDef[] = [
  { key: "master-data", name: "Master Data", category: "platform", active: true },
  { key: "products", name: "Products", category: "catalog", active: true },
  { key: "inventory", name: "Inventory & Warehouses", category: "operations", active: true },
  { key: "customers", name: "Customers", category: "operations", active: true },
  { key: "orders", name: "Orders", category: "operations", active: true },
  { key: "shipping", name: "Shipping", category: "operations", active: true },
  { key: "finance", name: "Finance & Compliance", category: "finance", active: true },
  { key: "analytics", name: "Analytics", category: "insights", active: true },
  { key: "notifications", name: "Notifications", category: "operations", active: true },
  {
    key: "storefront_integration",
    name: "Storefront Integration",
    category: "operations",
    active: true,
  },
  { key: "ai", name: "AI", category: "insights", active: false },
];

/** Feature keys that carry `read`/`manage` permissions gated by that feature. */
const PERMISSIONED_FEATURES: readonly string[] = [
  "master-data",
  "products",
  "inventory",
  "customers",
  "orders",
  "shipping",
  "finance",
  "analytics",
  "notifications",
];

/** A catalog permission: its key, a human description, and its gating feature (if any). */
export interface PermissionDef {
  readonly key: string;
  readonly description: string;
  /** The feature that must be enabled for this permission to be effective; null ⇒ core. */
  readonly feature: string | null;
}

/**
 * The permission catalog: two feature-independent `access.*` permissions plus a
 * `read`/`manage` pair per permissioned feature (each gated by its feature).
 */
export const PERMISSIONS: readonly PermissionDef[] = [
  {
    key: "access.read",
    description: "View access, features, and permission templates",
    feature: null,
  },
  {
    key: "access.manage",
    description: "Assign permissions and templates to members",
    feature: null,
  },
  ...PERMISSIONED_FEATURES.flatMap((feature): PermissionDef[] => [
    { key: `${feature}.read`, description: `View ${feature}`, feature },
    { key: `${feature}.manage`, description: `Create, update, and delete ${feature}`, feature },
  ]),
  // Storefront integration has a single management permission (no separate
  // `.read`): the ingestion routes are API-key-gated, not permission-gated,
  // so there is nothing for a read-only permission to gate here.
  {
    key: "integrations.manage",
    description: "Create, rotate, and revoke storefront connections",
    feature: "storefront_integration",
  },
];

/** Every permission key — the Owner template grants all of them. */
export const ALL_PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((p) => p.key);

/** The `read`/`manage` permission keys for a set of features. */
function perms(features: readonly string[], levels: readonly ("read" | "manage")[]): string[] {
  return features.flatMap((f) => levels.map((l) => `${f}.${l}`));
}

export const PLANS: readonly PlanDef[] = [
  {
    code: "free",
    name: "Free",
    description: "Core operations for a single small store.",
    features: ["master-data", "products", "customers", "orders"],
  },
  {
    code: "standard",
    name: "Standard",
    description: "Growing stores: inventory, shipping, and notifications.",
    features: [
      "master-data",
      "products",
      "customers",
      "orders",
      "inventory",
      "shipping",
      "notifications",
    ],
  },
  {
    code: "pro",
    name: "Pro",
    description: "Everything: finance, compliance, and analytics.",
    features: [
      "master-data",
      "products",
      "customers",
      "orders",
      "inventory",
      "shipping",
      "notifications",
      "finance",
      "analytics",
      "storefront_integration",
    ],
  },
];

export const TEMPLATES: readonly TemplateDef[] = [
  {
    key: "owner",
    name: "Owner",
    description: "Full access to everything in the company.",
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    key: "store_manager",
    name: "Store Manager",
    description: "Runs day-to-day operations across the store.",
    permissions: [
      "access.read",
      "integrations.manage",
      ...perms(["orders", "products", "inventory", "customers", "shipping"], ["read", "manage"]),
      ...perms(["analytics", "finance"], ["read"]),
    ],
  },
  {
    key: "call_center",
    name: "Call Center",
    description: "Handles orders and customer contact.",
    permissions: perms(["orders", "customers"], ["read", "manage"]),
  },
  {
    key: "warehouse",
    name: "Warehouse",
    description: "Manages stock, fulfilment, and shipping.",
    permissions: [
      ...perms(["inventory", "shipping"], ["read", "manage"]),
      ...perms(["products", "orders"], ["read"]),
    ],
  },
  {
    key: "finance",
    name: "Finance",
    description: "Owns finance, invoicing, and reconciliation.",
    permissions: [
      "access.read",
      ...perms(["finance"], ["read", "manage"]),
      ...perms(["analytics", "orders"], ["read"]),
    ],
  },
  {
    key: "marketing",
    name: "Marketing",
    description: "Analytics and customer engagement.",
    permissions: [
      ...perms(["analytics", "customers"], ["read"]),
      ...perms(["notifications"], ["read", "manage"]),
    ],
  },
];

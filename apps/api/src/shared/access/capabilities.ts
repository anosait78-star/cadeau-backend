/**
 * The three-layer access model (ADR-0003), expressed as pure data + functions so
 * the resolution logic is trivially unit-testable and free of I/O. A request is
 * allowed only when **Subscription ∧ Feature-Flag ∧ Permission** all agree; a
 * failure of any layer denies (rendered as `403 FORBIDDEN` by the guard).
 */

/** The resolved, cacheable capability set for one (user, company) pair. */
export interface EffectiveCapabilities {
  /** Feature keys enabled for the company (plan ∪ add-ons, overridden by flags, ∩ globally-active). */
  readonly features: readonly string[];
  /** Permission keys the member effectively holds (template ± overrides, gated by feature). */
  readonly permissions: readonly string[];
}

/** What a route/menu/button requires. Both optional; both must hold when present. */
export interface CapabilityRequirement {
  readonly feature?: string;
  readonly permission?: string;
}

/** The raw access facts for a (user, company), as read from the database. */
export interface AccessData {
  /** Feature keys included by the company's subscribed plan. */
  readonly planFeatureKeys: readonly string[];
  /** Feature keys that are globally active (a platform kill switch removes them). */
  readonly activeFeatureKeys: readonly string[];
  /** Per-company feature overrides. */
  readonly featureFlags: readonly { readonly featureKey: string; readonly enabled: boolean }[];
  /** Feature keys granted as add-ons beyond the plan. */
  readonly addOnFeatureKeys: readonly string[];
  /** The member's role / template key, or null when they are not an active member. */
  readonly role: string | null;
  /** Permission keys the member's role template grants. */
  readonly rolePermissionKeys: readonly string[];
  /** Per-member permission grant/revoke overrides. */
  readonly memberPermissions: readonly {
    readonly permissionKey: string;
    readonly granted: boolean;
  }[];
  /** Feature → permission gating edges (a permission here needs its feature enabled). */
  readonly featurePermissionEdges: readonly {
    readonly permissionKey: string;
    readonly featureKey: string;
  }[];
}

/** The empty capability set — the answer whenever there is no active tenant. */
export const EMPTY_CAPABILITIES: EffectiveCapabilities = { features: [], permissions: [] };

/**
 * Resolve the effective capabilities from raw access data.
 *
 * Features: start from the plan, add add-ons, apply per-company on/off flags,
 * then intersect with the globally-active set (a globally-inactive feature is
 * never effective for anyone).
 *
 * Permissions: start from the role template, apply per-member grant/revoke
 * overrides, then drop any permission whose gating feature is not effective.
 * Permissions with no gating edge (the core `access.*` ones) are feature-independent.
 */
export function resolveCapabilities(data: AccessData): EffectiveCapabilities {
  const active = new Set(data.activeFeatureKeys);

  const features = new Set(data.planFeatureKeys);
  for (const key of data.addOnFeatureKeys) features.add(key);
  for (const flag of data.featureFlags) {
    if (flag.enabled) features.add(flag.featureKey);
    else features.delete(flag.featureKey);
  }
  const effectiveFeatures = new Set([...features].filter((key) => active.has(key)));

  const permissions = new Set(data.rolePermissionKeys);
  for (const override of data.memberPermissions) {
    if (override.granted) permissions.add(override.permissionKey);
    else permissions.delete(override.permissionKey);
  }

  // A permission may be gated by one or more features; require ALL of them.
  const gates = new Map<string, Set<string>>();
  for (const edge of data.featurePermissionEdges) {
    const set = gates.get(edge.permissionKey) ?? new Set<string>();
    set.add(edge.featureKey);
    gates.set(edge.permissionKey, set);
  }
  const effectivePermissions = [...permissions].filter((permission) => {
    const required = gates.get(permission);
    if (required === undefined) return true;
    for (const featureKey of required) {
      if (!effectiveFeatures.has(featureKey)) return false;
    }
    return true;
  });

  return {
    features: [...effectiveFeatures].sort(),
    permissions: effectivePermissions.sort(),
  };
}

/** Whether a capability set satisfies a requirement (both feature and permission when given). */
export function can(caps: EffectiveCapabilities, requirement: CapabilityRequirement): boolean {
  if (requirement.feature !== undefined && !caps.features.includes(requirement.feature)) {
    return false;
  }
  if (requirement.permission !== undefined && !caps.permissions.includes(requirement.permission)) {
    return false;
  }
  return true;
}

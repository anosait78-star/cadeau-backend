/**
 * The vendor group status machine (Vendor Accounts, Phase 3,
 * docs/api/orders.md). Purely organizational — no stock effect, no reason
 * requirement, unlike the Parent Order machine in {@link ./order-status}.
 *
 * Two rules live here, because two very different actors move these groups:
 *
 * - A **vendor** moves their own group **forward only**, but may jump any
 *   distance ahead ({@link canVendorAdvance}). The original rule was one step
 *   at a time; it was relaxed on the product owner's call, because a vendor who
 *   packed and handed over an order in one go should not have to click through
 *   the states they already passed. Going backward stays closed to them — that
 *   would mean un-saying something they already did.
 * - A **company manager** may set any state, in either direction
 *   ({@link canOverrideVendorGroupStatus}), to correct a vendor's mistake.
 *   Gated by the `orders.vendor_groups.override` permission, not by this
 *   module — the domain only says what is representable, never who may do it.
 *
 * A vendor group always starts at `"new"` (set only by the Parent Order's own
 * `processing` transition — see `OrdersRepository.materializeVendorGroups`).
 */

/** The 4 vendor group lifecycle states, in lifecycle order. */
export const VENDOR_GROUP_STATUSES = ["new", "processing", "ready", "delivered"] as const;

export type VendorGroupStatus = (typeof VENDOR_GROUP_STATUSES)[number];

/** A status's position in the lifecycle. */
function rank(status: VendorGroupStatus): number {
  return VENDOR_GROUP_STATUSES.indexOf(status);
}

export function isValidVendorGroupStatus(value: string): value is VendorGroupStatus {
  return (VENDOR_GROUP_STATUSES as readonly string[]).includes(value);
}

/**
 * Whether a **vendor** may move their own group from `from` to `to`: strictly
 * forward, any distance (`new → delivered` is legal), never backward and never
 * a no-op. `"delivered"` is terminal for them.
 */
export function canVendorAdvance(from: VendorGroupStatus, to: VendorGroupStatus): boolean {
  return rank(to) > rank(from);
}

/**
 * Whether a **company manager** holding `orders.vendor_groups.override` may set
 * the group from `from` to `to`. Any real change in either direction; only a
 * no-op is rejected, so the audit trail never carries an empty transition.
 */
export function canOverrideVendorGroupStatus(
  from: VendorGroupStatus,
  to: VendorGroupStatus,
): boolean {
  return from !== to;
}

/** The states a vendor may advance to from `from` (for the UI's drop targets). */
export function nextVendorGroupStates(from: VendorGroupStatus): readonly VendorGroupStatus[] {
  return VENDOR_GROUP_STATUSES.filter((status) => canVendorAdvance(from, status));
}

/**
 * A read-only, computed-on-the-fly aggregate across an order's vendor groups
 * (Vendor Accounts, Phase 8). Per the master spec: the Parent Order's own
 * `status`/transition machine is never touched by this — it is purely a
 * derived summary for tracking UIs, recomputed fresh on every read from
 * whatever `OrderVendorGroup.status` rows exist at that moment (never
 * persisted, no new column, no new event).
 *
 * The **least advanced** status among all groups wins — the slowest vendor is
 * the bottleneck. Matches the spec's worked example: 4 of 5 vendors
 * `delivered` and 1 still `new` aggregates to `"new"`, not `"delivered"`,
 * because the order as a whole isn't done until every vendor is.
 *
 * `null` when the order has no vendor groups at all (a non-multi-vendor
 * order) — there is nothing to aggregate, and callers should fall back to
 * showing nothing rather than a misleading status.
 */
export function aggregateVendorOrderStatus(
  groups: readonly { readonly status: string }[],
): VendorGroupStatus | null {
  if (groups.length === 0) return null;
  const ranks = groups
    .map((g) => VENDOR_GROUP_STATUSES.indexOf(g.status as VendorGroupStatus))
    .filter((r) => r !== -1); // ignore any row in an unrecognized status, defensively
  if (ranks.length === 0) return null;
  return VENDOR_GROUP_STATUSES[Math.min(...ranks)]!;
}

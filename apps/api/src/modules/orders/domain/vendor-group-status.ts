/**
 * The vendor group status machine (Vendor Accounts, Phase 3,
 * docs/api/orders.md). Purely organizational — no stock effect, no reason
 * requirement, unlike the Parent Order machine in {@link ./order-status}.
 * Strictly forward, one step at a time, no skipping and no reverse: a vendor
 * group always starts at `"new"` (set only by the Parent Order's own
 * `processing` transition — see `OrdersRepository.materializeVendorGroups`)
 * and a vendor advances it themselves, one step per call, until `"delivered"`
 * (terminal).
 */

/** The 4 vendor group lifecycle states, in lifecycle order. */
export const VENDOR_GROUP_STATUSES = ["new", "processing", "ready", "delivered"] as const;

export type VendorGroupStatus = (typeof VENDOR_GROUP_STATUSES)[number];

/**
 * The legal transitions: each state may only advance to the single next state
 * in the sequence. `"delivered"` is terminal (empty set) — matches the user's
 * explicit rule ("جديد → جاهز ممنوع", no jumping ahead and no going back).
 */
const TRANSITIONS: Readonly<Record<VendorGroupStatus, readonly VendorGroupStatus[]>> = {
  new: ["processing"],
  processing: ["ready"],
  ready: ["delivered"],
  delivered: [],
};

export function isValidVendorGroupStatus(value: string): value is VendorGroupStatus {
  return (VENDOR_GROUP_STATUSES as readonly string[]).includes(value);
}

/** Whether `to` is the single legal next state from `from`. */
export function canTransitionVendorGroup(from: VendorGroupStatus, to: VendorGroupStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The states reachable from `from` (for the UI's allowed-transition hints). */
export function nextVendorGroupStates(from: VendorGroupStatus): readonly VendorGroupStatus[] {
  return TRANSITIONS[from];
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
    .filter((rank) => rank !== -1); // ignore any row in an unrecognized status, defensively
  if (ranks.length === 0) return null;
  return VENDOR_GROUP_STATUSES[Math.min(...ranks)]!;
}

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

import { apiFetch } from "@/lib/api-client";

/** One item within a vendor group — no cost snapshot (Vendor Accounts, Phase 3/4). */
export interface VendorGroupItem {
  readonly id: string;
  readonly variantId: string;
  readonly nameSnapshot: string;
  readonly quantity: number;
  readonly price: number;
  /** The product's display image, or null (Vendor Accounts, Phase 7). */
  readonly imageUrl: string | null;
}

/** The 4-state vendor group lifecycle. */
export const VENDOR_GROUP_STATUSES = ["new", "processing", "ready", "delivered"] as const;
export type VendorGroupStatus = (typeof VENDOR_GROUP_STATUSES)[number];

/**
 * Every status a vendor may move `from` to: strictly forward, but any distance
 * ahead — a vendor who packed and handed the order over in one go sets
 * `"delivered"` directly rather than clicking through what they already did.
 * Backward is closed to them (only a manager holding
 * `orders.vendor_groups.override` can walk a group back), so this is also
 * exactly the set of drop targets the orders board may accept.
 *
 * Mirrors `nextVendorGroupStates` in the API's own domain module; the server
 * is still the authority — a stale client that offers a status the server
 * refuses just gets a `422`.
 */
export function forwardVendorStatuses(from: VendorGroupStatus): readonly VendorGroupStatus[] {
  const start = VENDOR_GROUP_STATUSES.indexOf(from);
  return VENDOR_GROUP_STATUSES.slice(start + 1);
}

/** The immediate next status, or `null` at `"delivered"` — the primary action. */
export function nextVendorStatus(from: VendorGroupStatus): VendorGroupStatus | null {
  return forwardVendorStatuses(from)[0] ?? null;
}

/** My slice of one order (Vendor Accounts, Phase 3/4). */
export interface VendorGroup {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: number;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly warehouseCode: string | null;
  readonly vendorMemberId: string | null;
  readonly vendorName: string | null;
  readonly status: VendorGroupStatus;
  /** When `status` (or the group) last changed. */
  readonly updatedAt: string;
  readonly items: readonly VendorGroupItem[];
}

/**
 * `GET /v1/vendor/order-groups` — my own vendor groups, across every order,
 * newest first. Guarded server-side by session only (not `orders.read`); a
 * caller with no active vendor membership gets an empty list, not an error.
 */
export function listMyVendorGroups(): Promise<{ data: VendorGroup[] }> {
  return apiFetch<{ data: VendorGroup[] }>("/vendor/order-groups");
}

/**
 * `POST /v1/vendor/order-groups/{id}/status` — move one of my groups forward
 * to any later status. `404` if it isn't mine; `422` if `toStatus` is backward
 * or the status it already holds; `409` if it moved underneath me (reload and
 * retry).
 */
export function advanceVendorGroupStatus(
  groupId: string,
  toStatus: VendorGroupStatus,
): Promise<VendorGroup> {
  return apiFetch<VendorGroup>(`/vendor/order-groups/${groupId}/status`, {
    method: "POST",
    body: { toStatus },
  });
}

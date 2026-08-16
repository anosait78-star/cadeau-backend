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

/** The single next status a vendor group may move to (strictly forward, no skipping). */
export const NEXT_VENDOR_GROUP_STATUS: Record<VendorGroupStatus, VendorGroupStatus | null> = {
  new: "processing",
  processing: "ready",
  ready: "delivered",
  delivered: null,
};

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
 * `POST /v1/vendor/order-groups/{id}/status` — advance one of my groups by
 * exactly one step. `404` if it isn't mine; `422` on an illegal jump/skip;
 * `409` if it already moved (reload and retry).
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

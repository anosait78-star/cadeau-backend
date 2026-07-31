/**
 * Shipment domain views (EPIC-12): the shapes the application layer returns,
 * decoupled from the Prisma rows. Money is always integer minor units
 * (api-conventions §money), matching orders.
 */

import type { ShipmentStatus } from "./shipment-status";

/** A shipment as it appears on read (list and detail are the same shape today). */
export interface ShipmentView {
  readonly id: string;
  readonly orderId: string;
  readonly carrier: string;
  readonly trackingNumber: string;
  readonly status: ShipmentStatus;
  /** Integer minor units; deducted from the order's collectedAmount at delivery (D4). */
  readonly fee: number;
  /** Metadata flag only (D3) — no PDF is stored or rendered in this epic. */
  readonly waybillIssued: boolean;
  readonly deliveredAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * The outcome of a create that may have been an idempotent **replay** (same
 * `Idempotency-Key`). A replay wrote nothing, so the service records no audit
 * row and emits no event — the same contract as orders/customers.
 */
export interface ShipmentWriteResult {
  readonly shipment: ShipmentView;
  readonly replayed: boolean;
}

/** The outcome of a status transition, carrying what the service needs to emit. */
export interface ShipmentStatusChangeResult {
  readonly shipment: ShipmentView;
  readonly fromStatus: ShipmentStatus;
  readonly toStatus: ShipmentStatus;
  /**
   * The shipping fee deducted from the order's `collectedAmount` on this
   * transition — positive only when this transition delivered the shipment
   * (D4); `0` otherwise.
   */
  readonly feeDeducted: number;
}

/** One item's outcome in a bulk operation (atomic per item, reported per item). */
export interface BulkShipmentResult {
  readonly orderId: string;
  readonly ok: boolean;
  readonly shipmentId?: string;
  /** Present when `ok` is false: the api-conventions error code. */
  readonly error?: { readonly code: string; readonly message: string };
}

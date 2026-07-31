import { apiFetch, ApiError } from "@/lib/api-client";

/**
 * Client for `/v1/shipping` (contract: docs/api/shipping.md). Money is always
 * integer minor units. There is no general shipment list endpoint yet — the
 * order detail looks up a shipment by its order id (M12.5).
 */

/** The 6 shipment lifecycle states (docs/epic-12-design.md). */
export const SHIPMENT_STATUSES = [
  "created",
  "picked_up",
  "in_transit",
  "delivered",
  "returned",
  "cancelled",
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** A shipment (list and detail are the same shape). */
export interface Shipment {
  readonly id: string;
  readonly orderId: string;
  readonly carrier: string;
  readonly trackingNumber: string;
  readonly status: ShipmentStatus;
  readonly fee: number;
  readonly waybillIssued: boolean;
  readonly deliveredAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** An available carrier (behind the carrier-abstraction, today: `manual` only). */
export interface Carrier {
  readonly key: string;
}

/** Waybill metadata (no PDF in this epic). */
export interface Waybill {
  readonly shipmentId: string;
  readonly carrier: string;
  readonly trackingNumber: string;
}

/** `GET /v1/shipping/carriers` — available carriers. */
export function listCarriers(): Promise<{ data: Carrier[] }> {
  return apiFetch<{ data: Carrier[] }>("/shipping/carriers");
}

/**
 * `GET /v1/shipping/orders/{orderId}/shipment` — the most recent shipment for
 * an order, or `null` when the order has no shipment yet (404).
 */
export async function getShipmentForOrder(orderId: string): Promise<Shipment | null> {
  try {
    return await apiFetch<Shipment>(`/shipping/orders/${orderId}/shipment`);
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

/** `POST /v1/shipping/shipments` — create a shipment for an order. */
export function createShipment(orderId: string): Promise<Shipment> {
  return apiFetch<Shipment>("/shipping/shipments", { method: "POST", body: { orderId } });
}

/** `POST /v1/shipping/shipments/{id}/status` — transition status (also used to cancel). */
export function transitionShipment(
  id: string,
  toStatus: ShipmentStatus,
  note?: string | null,
): Promise<Shipment> {
  return apiFetch<Shipment>(`/shipping/shipments/${id}/status`, {
    method: "POST",
    body: { toStatus, ...(note !== undefined && note !== null ? { note } : {}) },
  });
}

/** `POST /v1/shipping/shipments/{id}/waybill` — waybill metadata (no PDF in this epic). */
export function issueWaybill(id: string): Promise<Waybill> {
  return apiFetch<Waybill>(`/shipping/shipments/${id}/waybill`, { method: "POST" });
}

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

/** An available carrier + this tenant's connection state (`manual` is always connected). */
export interface Carrier {
  readonly key: string;
  readonly connected: boolean;
  readonly pickupLocationWarning: boolean;
  readonly connectedAt: string | null;
}

/** Waybill metadata (no PDF in this epic). */
export interface Waybill {
  readonly shipmentId: string;
  readonly carrier: string;
  readonly trackingNumber: string;
}

/** `GET /v1/shipping/carriers` — available carriers + connection state. */
export function listCarriers(): Promise<{ data: Carrier[] }> {
  return apiFetch<{ data: Carrier[] }>("/shipping/carriers");
}

/** `POST /v1/shipping/carriers/{carrier}/connect` — validates the key before saving it. */
export function connectCarrier(carrier: string, apiKey: string): Promise<Carrier> {
  return apiFetch<Carrier>(`/shipping/carriers/${carrier}/connect`, {
    method: "POST",
    body: { apiKey },
  });
}

/** `DELETE /v1/shipping/carriers/{carrier}/connect` — disconnect a carrier. */
export function disconnectCarrier(carrier: string): Promise<void> {
  return apiFetch<void>(`/shipping/carriers/${carrier}/connect`, { method: "DELETE" });
}

/** A Bosta city (address-mapping picker). */
export interface BostaCity {
  readonly id: string;
  readonly name: string;
  readonly nameAr: string | null;
}

/** A Bosta district within a city (address-mapping picker). */
export interface BostaDistrict {
  readonly districtId: string;
  readonly districtName: string;
  readonly zoneId: string;
  readonly zoneName: string;
}

/** `GET /v1/shipping/bosta/cities` — Bosta's public city catalog. */
export function listBostaCities(): Promise<{ data: BostaCity[] }> {
  return apiFetch<{ data: BostaCity[] }>("/shipping/bosta/cities");
}

/** `GET /v1/shipping/bosta/cities/{cityId}/districts` — Bosta's districts for a city. */
export function listBostaDistricts(cityId: string): Promise<{ data: BostaDistrict[] }> {
  return apiFetch<{ data: BostaDistrict[] }>(
    `/shipping/bosta/cities/${encodeURIComponent(cityId)}/districts`,
  );
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

/** Bosta-specific fields collected in the carrier-select step (no longer collected on the customer/order forms). */
export interface CreateShipmentBostaFields {
  readonly bostaCityId?: string;
  readonly bostaCityName?: string;
  readonly bostaDistrictId?: string;
  readonly notes?: string;
  /** Declared goods value, integer minor units. */
  readonly goodsValue?: number;
  /** Overrides the receiver first/last name otherwise derived from the customer's own name. */
  readonly recipientFirstName?: string;
  readonly recipientLastName?: string;
  /** A second contact number for the receiver. */
  readonly recipientPhone2?: string;
  /** Lets the receiver open the package before accepting it. */
  readonly allowToOpenPackage?: boolean;
}

/**
 * `POST /v1/shipping/shipments` — create a shipment for an order. `carrier`
 * is the client's choice from the carrier-select step; omitted, the server
 * auto-detects (the company's active connection, else `manual`). `bosta`
 * fields are only meaningful when `carrier === "bosta"`.
 */
export function createShipment(
  orderId: string,
  carrier?: string,
  bosta?: CreateShipmentBostaFields,
): Promise<Shipment> {
  return apiFetch<Shipment>("/shipping/shipments", {
    method: "POST",
    body: {
      orderId,
      ...(carrier !== undefined ? { carrier } : {}),
      ...(bosta?.bostaCityId !== undefined ? { bostaCityId: bosta.bostaCityId } : {}),
      ...(bosta?.bostaCityName !== undefined ? { bostaCityName: bosta.bostaCityName } : {}),
      ...(bosta?.bostaDistrictId !== undefined ? { bostaDistrictId: bosta.bostaDistrictId } : {}),
      ...(bosta?.notes !== undefined ? { notes: bosta.notes } : {}),
      ...(bosta?.goodsValue !== undefined ? { goodsValue: bosta.goodsValue } : {}),
      ...(bosta?.recipientFirstName !== undefined
        ? { recipientFirstName: bosta.recipientFirstName }
        : {}),
      ...(bosta?.recipientLastName !== undefined
        ? { recipientLastName: bosta.recipientLastName }
        : {}),
      ...(bosta?.recipientPhone2 !== undefined ? { recipientPhone2: bosta.recipientPhone2 } : {}),
      ...(bosta?.allowToOpenPackage !== undefined
        ? { allowToOpenPackage: bosta.allowToOpenPackage }
        : {}),
    },
  });
}

/** One order's outcome in a bulk shipment-creation call. */
export interface BulkShipmentResultItem {
  readonly orderId: string;
  readonly ok: boolean;
  readonly shipmentId?: string;
  readonly error?: { readonly code: string; readonly message: string };
}

/** `POST /v1/shipping/shipments/bulk` — create shipments for several orders at once. */
export function bulkCreateShipments(
  orderIds: string[],
): Promise<{ results: BulkShipmentResultItem[] }> {
  return apiFetch<{ results: BulkShipmentResultItem[] }>("/shipping/shipments/bulk", {
    method: "POST",
    body: { orderIds },
  });
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

/**
 * `POST /v1/shipping/shipments/{id}/status` with `toStatus: "cancelled"` —
 * cancels the shipment through the official carrier API (no local faking).
 */
export function cancelShipment(id: string, note?: string | null): Promise<Shipment> {
  return transitionShipment(id, "cancelled", note);
}

/** `POST /v1/shipping/shipments/{id}/waybill` — waybill metadata (no PDF in this epic). */
export function issueWaybill(id: string): Promise<Waybill> {
  return apiFetch<Waybill>(`/shipping/shipments/${id}/waybill`, { method: "POST" });
}

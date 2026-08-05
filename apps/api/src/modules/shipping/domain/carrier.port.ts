import type { ShipmentStatus } from "./shipment-status";

/** What the application layer asks a carrier to dispatch. */
export interface CarrierCreateShipmentInput {
  readonly companyId: string;
  readonly orderId: string;
  /** Explicit carrier choice from the client (e.g. the "select a carrier" step before creating a shipment). Falls back to the company's active connection when omitted. */
  readonly carrier?: string;
  /**
   * Bosta-specific: city/district chosen in the "select a carrier" step,
   * taking precedence over the customer's saved address mapping (the
   * customer/order forms no longer collect this — it's entered once, at
   * shipment-creation time). Ignored by carriers other than Bosta.
   */
  readonly bostaCityId?: string;
  readonly bostaCityName?: string;
  readonly bostaDistrictId?: string;
  /** Free-text note for the courier (e.g. package contents). Best-effort passthrough — not persisted on our side. */
  readonly notes?: string;
  /** Declared goods value, integer minor units — folded into the note sent to the carrier (no dedicated field in our schema or confirmed in Bosta's own payload shape). */
  readonly goodsValue?: number;
}

/**
 * What a carrier hands back once a shipment is booked with it. `carrier` is
 * the adapter's own key — the repository stamps `shipments.carrier` from
 * here (never from `CarrierPort.name`), so a router that dispatches between
 * several adapters stamps the *actual* carrier that handled the call.
 */
export interface CarrierShipmentHandle {
  readonly trackingNumber: string;
  readonly carrier: string;
}

/** A carrier's tracking read, mapped onto our own {@link ShipmentStatus} lifecycle. */
export interface CarrierTrackingInfo {
  readonly trackingNumber: string;
  readonly status: ShipmentStatus;
}

/** Waybill metadata only (decision D3) — no PDF body in this epic. */
export interface CarrierWaybillInfo {
  readonly trackingNumber: string;
  readonly carrier: string;
}

/**
 * The carrier-abstraction port (EPIC-12, decision D1). No module outside
 * `modules/shipping/infrastructure` may know a carrier's name or call it
 * directly — the application layer depends only on this interface.
 *
 * The only implementation shipped in EPIC-12 is {@link ManualCarrierAdapter}
 * (no external HTTP calls; a locally-generated tracking number). A real
 * carrier (Bosta, …) is a future, additive implementation of the same port —
 * orders/shipments never change when it lands.
 */
export interface CarrierPort {
  /** The carrier key this adapter implements (matches `shipments.carrier`). */
  readonly name: string;
  createShipment(input: CarrierCreateShipmentInput): Promise<CarrierShipmentHandle>;
  /** `companyId` is always in scope at every call site (the repository's own tenant lock). */
  getTracking(companyId: string, trackingNumber: string): Promise<CarrierTrackingInfo>;
  generateWaybill(companyId: string, trackingNumber: string): Promise<CarrierWaybillInfo>;
  cancelShipment(companyId: string, trackingNumber: string): Promise<void>;
}

/** DI token for {@link CarrierPort}. */
export const CARRIER_PORT = Symbol("CARRIER_PORT");

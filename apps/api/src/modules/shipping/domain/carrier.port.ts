import type { ShipmentStatus } from "./shipment-status";

/** What the application layer asks a carrier to dispatch. */
export interface CarrierCreateShipmentInput {
  readonly companyId: string;
  readonly orderId: string;
}

/** What a carrier hands back once a shipment is booked with it. */
export interface CarrierShipmentHandle {
  readonly trackingNumber: string;
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
  getTracking(trackingNumber: string): Promise<CarrierTrackingInfo>;
  generateWaybill(trackingNumber: string): Promise<CarrierWaybillInfo>;
  cancelShipment(trackingNumber: string): Promise<void>;
}

/** DI token for {@link CarrierPort}. */
export const CARRIER_PORT = Symbol("CARRIER_PORT");

import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  CarrierCreateShipmentInput,
  CarrierPort,
  CarrierShipmentHandle,
  CarrierTrackingInfo,
  CarrierWaybillInfo,
} from "../domain/carrier.port";

/**
 * The only {@link CarrierPort} adapter shipped in EPIC-12 (decision D1). Makes
 * no external HTTP call: it assigns a locally-generated tracking number and
 * has no independent view of a shipment's status — status advances only
 * through the same webhook-inbox path a real carrier would use, or an
 * authenticated internal endpoint for manual status entry (both drive the
 * application layer's `transition`, never this adapter). `getTracking` here is
 * therefore a stub that a live carrier adapter would replace with a real API
 * call; the manual carrier has no upstream to poll.
 */
@Injectable()
export class ManualCarrierAdapter implements CarrierPort {
  readonly name = "manual";

  async createShipment(_input: CarrierCreateShipmentInput): Promise<CarrierShipmentHandle> {
    return Promise.resolve({
      trackingNumber: `MAN-${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      carrier: this.name,
    });
  }

  getTracking(_companyId: string, _trackingNumber: string): Promise<CarrierTrackingInfo> {
    return Promise.reject(new Error("The manual carrier has no upstream to poll for tracking."));
  }

  generateWaybill(_companyId: string, trackingNumber: string): Promise<CarrierWaybillInfo> {
    return Promise.resolve({ trackingNumber, carrier: this.name });
  }

  cancelShipment(_companyId: string, _trackingNumber: string): Promise<void> {
    return Promise.resolve();
  }
}

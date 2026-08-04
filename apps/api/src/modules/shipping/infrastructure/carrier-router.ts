import { Inject, Injectable } from "@nestjs/common";
import {
  CARRIER_CONNECTIONS_REPOSITORY,
  type CarrierConnectionsRepositoryPort,
} from "../domain/carrier-connections-repository.port";
import type {
  CarrierCreateShipmentInput,
  CarrierPort,
  CarrierShipmentHandle,
  CarrierTrackingInfo,
  CarrierWaybillInfo,
} from "../domain/carrier.port";
import { CarrierNotConnectedError } from "../domain/shipping.errors";
import { BostaCarrierAdapter } from "./bosta-carrier.adapter";
import { ManualCarrierAdapter } from "./manual-carrier.adapter";

/**
 * The single {@link CarrierPort} binding (`shipping.module.ts`). Dispatches
 * per company: `bosta` when the company has an active connection, `manual`
 * otherwise. This is the *only* place that knows more than one carrier
 * exists — everything upstream (the repository, the service) still depends
 * on the unchanged `CarrierPort` interface (D1).
 */
@Injectable()
export class CarrierRouter implements CarrierPort {
  /** No single fixed name — `shipments.carrier` is stamped from the handle each adapter returns. */
  readonly name = "router";

  constructor(
    @Inject(CARRIER_CONNECTIONS_REPOSITORY)
    private readonly connections: CarrierConnectionsRepositoryPort,
    private readonly manual: ManualCarrierAdapter,
    private readonly bosta: BostaCarrierAdapter,
  ) {}

  async createShipment(input: CarrierCreateShipmentInput): Promise<CarrierShipmentHandle> {
    const adapter = await this.resolve(input.companyId, input.carrier);
    return adapter.createShipment(input);
  }

  async getTracking(companyId: string, trackingNumber: string): Promise<CarrierTrackingInfo> {
    const adapter = await this.resolve(companyId);
    return adapter.getTracking(companyId, trackingNumber);
  }

  async generateWaybill(companyId: string, trackingNumber: string): Promise<CarrierWaybillInfo> {
    const adapter = await this.resolve(companyId);
    return adapter.generateWaybill(companyId, trackingNumber);
  }

  async cancelShipment(companyId: string, trackingNumber: string): Promise<void> {
    const adapter = await this.resolve(companyId);
    return adapter.cancelShipment(companyId, trackingNumber);
  }

  /**
   * With an explicit `carrier` (the client's choice from the "select a
   * carrier" step), dispatch to that carrier — requiring it to actually be
   * connected rather than silently falling back. Without one (status
   * transitions, waybills, cancellations — all operate on an *existing*
   * shipment whose carrier is already fixed), fall back to the legacy
   * auto-detect: Bosta if connected for this company, else the built-in
   * manual carrier.
   *
   * Known gap: the no-argument path reflects the company's *current*
   * connection, not the carrier a specific shipment was actually booked
   * through — cancelling an old Bosta shipment after disconnecting routes to
   * `manual` (a no-op) instead of Bosta. Acceptable for now
   * (disconnect-then-cancel is rare and non-destructive); revisit if it
   * proves to matter.
   */
  private async resolve(companyId: string, carrier?: string): Promise<CarrierPort> {
    if (carrier !== undefined) {
      if (carrier === "manual") return this.manual;
      if (carrier === "bosta") {
        const connection = await this.connections.findActive(companyId, "bosta");
        if (connection === null) throw new CarrierNotConnectedError("bosta");
        return this.bosta;
      }
      throw new CarrierNotConnectedError(carrier);
    }
    const bostaConnection = await this.connections.findActive(companyId, "bosta");
    return bostaConnection !== null ? this.bosta : this.manual;
  }
}

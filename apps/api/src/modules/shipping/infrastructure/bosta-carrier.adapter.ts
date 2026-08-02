import { Inject, Injectable } from "@nestjs/common";
import { type PrismaClient, setTenantContext } from "@cadeau/database";
import { decrypt } from "@cadeau/crypto";
import { APP_CONFIG, type InjectedAppConfig } from "../../../shared/config/config.tokens";
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
import type { ShipmentStatus } from "../domain/shipment-status";
import {
  CarrierNotConnectedError,
  CodLimitExceededError,
  CustomerAddressMissingError,
  CustomerAddressNotMappedError,
  ReferenceNotFoundError,
} from "../domain/shipping.errors";
import { BostaHttpClient } from "./bosta-http-client";
import { SHIPPING_PRISMA_CLIENT } from "./prisma-client.provider";

const CARRIER = "bosta";

/** Bosta's documented COD cap, in our integer minor units (piastres). */
const BOSTA_MAX_COD_MINOR = 30_000 * 100;

/** Bosta's "deliver" order type — the only kind this integration creates. */
const DELIVERY_TYPE = 10;

/**
 * Maps Bosta's `maskedState` progression (+ the separately observed
 * "Canceled" state) onto our own {@link ShipmentStatus} lifecycle. An
 * unrecognized value is deliberately **not** guessed at — the webhook
 * processor (Phase D) logs and skips instead of inventing a status.
 */
export const BOSTA_STATUS_MAP: Readonly<Record<string, ShipmentStatus>> = {
  Created: "created",
  "Picked up": "picked_up",
  "In Transit": "in_transit",
  "Out for delivery": "in_transit",
  Delivered: "delivered",
  Canceled: "cancelled",
};

interface BostaDeliveryResponse {
  readonly data: { readonly trackingNumber: string };
}

interface BostaTrackingResponse {
  readonly data: { readonly trackingNumber: string; readonly maskedState?: string };
}

/**
 * The real Bosta {@link CarrierPort} implementation. Loads everything it
 * needs (order, customer, address, the tenant's API key) itself — nothing
 * outside `modules/shipping/infrastructure` ever learns Bosta exists (D1).
 * No pickup address is ever sent: Bosta ships from the business's own
 * default pickup location, configured directly in their dashboard.
 */
@Injectable()
export class BostaCarrierAdapter implements CarrierPort {
  readonly name = CARRIER;

  constructor(
    @Inject(SHIPPING_PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(CARRIER_CONNECTIONS_REPOSITORY)
    private readonly connections: CarrierConnectionsRepositoryPort,
    @Inject(APP_CONFIG) private readonly config: InjectedAppConfig,
  ) {}

  async createShipment(input: CarrierCreateShipmentInput): Promise<CarrierShipmentHandle> {
    const apiKey = await this.requireApiKey(input.companyId);

    const { order, customer, address } = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, input.companyId);
      const order = await tx.order.findFirst({
        where: { id: input.orderId, companyId: input.companyId },
        select: { customerId: true, total: true, collectedAmount: true },
      });
      if (order === null) throw new ReferenceNotFoundError("orderId");

      const customer = await tx.customer.findFirst({
        where: { id: order.customerId, companyId: input.companyId },
        select: { name: true, phoneEncrypted: true },
      });
      if (customer === null) throw new ReferenceNotFoundError("customerId");

      const address = await tx.customerAddress.findFirst({
        where: {
          customerId: order.customerId,
          companyId: input.companyId,
          isActive: true,
          isDefault: true,
        },
        select: {
          lineEncrypted: true,
          landmark: true,
          bostaCityId: true,
          bostaDistrictId: true,
          bostaCityName: true,
        },
      });
      if (address === null) throw new CustomerAddressMissingError();
      if (
        address.bostaCityId === null ||
        address.bostaDistrictId === null ||
        address.bostaCityName === null
      ) {
        throw new CustomerAddressNotMappedError(CARRIER);
      }
      return { order, customer, address };
    });

    const codMinor = Math.max(0, Number(order.total) - Number(order.collectedAmount));
    if (codMinor > BOSTA_MAX_COD_MINOR) {
      throw new CodLimitExceededError(CARRIER, BOSTA_MAX_COD_MINOR);
    }

    const phone = decrypt(customer.phoneEncrypted, this.config.encryption.key);
    const line = decrypt(address.lineEncrypted, this.config.encryption.key);
    const [firstName, ...rest] = customer.name.trim().split(/\s+/);

    const client = new BostaHttpClient(this.config.shipping.bostaBaseUrl);
    const response = await client.request<BostaDeliveryResponse>(
      "POST",
      "deliveries?apiVersion=1",
      apiKey,
      {
        type: DELIVERY_TYPE,
        cod: codMinor / 100,
        dropOffAddress: {
          city: address.bostaCityName,
          districtId: address.bostaDistrictId,
          firstLine: line,
          ...(address.landmark !== null ? { secondLine: address.landmark } : {}),
        },
        businessReference: input.orderId,
        uniqueBusinessReference: input.orderId,
        receiver: {
          firstName: firstName ?? customer.name,
          ...(rest.length > 0 ? { lastName: rest.join(" ") } : {}),
          phone,
        },
      },
    );

    return { trackingNumber: response.data.trackingNumber, carrier: CARRIER };
  }

  async getTracking(companyId: string, trackingNumber: string): Promise<CarrierTrackingInfo> {
    const apiKey = await this.requireApiKey(companyId);
    const client = new BostaHttpClient(this.config.shipping.bostaBaseUrl);
    const response = await client.request<BostaTrackingResponse>(
      "GET",
      `deliveries/business/${encodeURIComponent(trackingNumber)}`,
      apiKey,
    );
    const mapped =
      response.data.maskedState !== undefined
        ? BOSTA_STATUS_MAP[response.data.maskedState]
        : undefined;
    return { trackingNumber, status: mapped ?? "created" };
  }

  async generateWaybill(companyId: string, trackingNumber: string): Promise<CarrierWaybillInfo> {
    // Metadata only (decision D3) — no PDF body. A live key is still required
    // so a disconnected carrier can't silently "succeed".
    await this.requireApiKey(companyId);
    return { trackingNumber, carrier: CARRIER };
  }

  async cancelShipment(companyId: string, trackingNumber: string): Promise<void> {
    const apiKey = await this.requireApiKey(companyId);
    const client = new BostaHttpClient(this.config.shipping.bostaBaseUrl);
    await client.request(
      "PUT",
      `deliveries/business/${encodeURIComponent(trackingNumber)}/terminate`,
      apiKey,
    );
  }

  /** Confirms the pickup-location probe would still work isn't repeated here — just decrypts the stored key. */
  private async requireApiKey(companyId: string): Promise<string> {
    const connection = await this.connections.findActive(companyId, CARRIER);
    if (connection === null) throw new CarrierNotConnectedError(CARRIER);
    return decrypt(connection.apiKeyEncrypted, this.config.encryption.key);
  }
}

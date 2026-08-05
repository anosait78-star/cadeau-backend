import { Inject, Injectable } from "@nestjs/common";
import {
  type PrismaClient,
  setTenantContext,
  stampForCreate,
  stampForUpdate,
} from "@cadeau/database";
import type { CarrierConnectionView } from "../domain/carrier-connection.entity";
import type {
  CarrierConnectionsRepositoryPort,
  UpsertCarrierConnectionInput,
} from "../domain/carrier-connections-repository.port";
import { SHIPPING_PRISMA_CLIENT } from "./prisma-client.provider";

const CONNECTION_SELECT = {
  id: true,
  carrier: true,
  isActive: true,
  pickupLocationWarning: true,
  connectedAt: true,
} as const;

const CONNECTION_SECRET_SELECT = {
  apiKeyEncrypted: true,
  webhookTokenHash: true,
} as const;

/**
 * Prisma-backed {@link CarrierConnectionsRepositoryPort}. Every operation
 * binds the tenant via `setTenantContext`, mirroring `ShippingRepository`.
 * The encrypted key/token-hash are only ever selected by {@link findActive}
 * (used exclusively by carrier adapters, never by anything that serializes
 * a response) — {@link list} deliberately omits them.
 */
@Injectable()
export class CarrierConnectionsRepository implements CarrierConnectionsRepositoryPort {
  constructor(@Inject(SHIPPING_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async list(companyId: string): Promise<CarrierConnectionView[]> {
    const rows = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return tx.carrierConnection.findMany({
        where: { companyId },
        select: CONNECTION_SELECT,
      });
    });
    return rows.map((row) => ({
      id: row.id,
      carrier: row.carrier,
      connected: row.isActive,
      pickupLocationWarning: row.pickupLocationWarning,
      connectedAt: row.connectedAt.toISOString(),
    }));
  }

  async findActive(
    companyId: string,
    carrier: string,
  ): Promise<{ apiKeyEncrypted: string; webhookTokenHash: string } | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return tx.carrierConnection.findFirst({
        where: { companyId, carrier, isActive: true },
        select: CONNECTION_SECRET_SELECT,
      });
    });
    return row;
  }

  async upsert(input: UpsertCarrierConnectionInput): Promise<CarrierConnectionView> {
    const actor = { companyId: input.companyId, actorId: input.actorId };
    const row = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, input.companyId);
      return tx.carrierConnection.upsert({
        where: {
          companyId_carrier: {
            companyId: input.companyId,
            carrier: input.carrier,
          },
        },
        create: stampForCreate(actor, {
          carrier: input.carrier,
          apiKeyEncrypted: input.apiKeyEncrypted,
          webhookTokenHash: input.webhookTokenHash,
          pickupLocationWarning: input.pickupLocationWarning,
          isActive: true,
          connectedBy: input.actorId,
          connectedAt: new Date(),
        }),
        update: stampForUpdate(actor, {
          apiKeyEncrypted: input.apiKeyEncrypted,
          webhookTokenHash: input.webhookTokenHash,
          pickupLocationWarning: input.pickupLocationWarning,
          isActive: true,
          connectedBy: input.actorId,
          connectedAt: new Date(),
        }),
        select: CONNECTION_SELECT,
      });
    });
    return {
      id: row.id,
      carrier: row.carrier,
      connected: row.isActive,
      pickupLocationWarning: row.pickupLocationWarning,
      connectedAt: row.connectedAt.toISOString(),
    };
  }

  async deactivate(companyId: string, carrier: string, actorId: string): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      const existing = await tx.carrierConnection.findFirst({
        where: { companyId, carrier, isActive: true },
        select: { id: true },
      });
      if (existing === null) return null;
      await tx.carrierConnection.update({
        where: { id: existing.id },
        data: { isActive: false, updatedBy: actorId },
      });
      return existing.id;
    });
  }
}

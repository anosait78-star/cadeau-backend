import { Inject, Injectable } from "@nestjs/common";
import {
  buildKeysetPage,
  clampLimit,
  decodeCursor,
  InvalidCursorError,
  type CursorValues,
  type KeysetPage,
  Prisma,
  type PrismaClient,
  setTenantContext,
  stampForCreate,
} from "@cadeau/database";
import type { VendorWarehouseMappingView } from "../domain/vendor-warehouse-mapping.entity";
import type {
  CreateVendorWarehouseMappingInput,
  VendorWarehouseMappingsRepositoryPort,
} from "../domain/vendor-warehouse-mappings-repository.port";
import type { WriteActor } from "../domain/storefront-connections-repository.port";
import {
  DuplicateVendorMappingError,
  InvalidListCursorError,
  WarehouseNotFoundError,
} from "../domain/storefront.errors";
import { INTEGRATIONS_PRISMA_CLIENT } from "./prisma-client.provider";

type Tx = Prisma.TransactionClient;

const MAPPING_SELECT = {
  id: true,
  connectionId: true,
  externalVendorId: true,
  warehouseId: true,
  createdAt: true,
  updatedAt: true,
} as const;

type MappingRow = Prisma.StorefrontConnectionVendorWarehouseGetPayload<{
  select: typeof MAPPING_SELECT;
}>;

/**
 * Prisma-backed {@link VendorWarehouseMappingsRepositoryPort} (multi-vendor
 * discovery, 2026-08-10). Every operation runs tenant-bound — unlike the
 * ingestion guard's API-key lookup, there is no pre-tenant read here: the
 * hot read path ({@link findWarehouseId}) is always called from inside
 * `StorefrontIngestionService`, which already knows the tenant from the
 * resolved connection.
 */
@Injectable()
export class VendorWarehouseMappingsRepository implements VendorWarehouseMappingsRepositoryPort {
  constructor(@Inject(INTEGRATIONS_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findWarehouseId(
    companyId: string,
    connectionId: string,
    externalVendorId: string,
  ): Promise<string | null> {
    return this.tenantTx(companyId, async (tx) => {
      const row = await tx.storefrontConnectionVendorWarehouse.findFirst({
        where: { companyId, connectionId, externalVendorId },
        select: { warehouseId: true },
      });
      return row === null ? null : row.warehouseId;
    });
  }

  async list(
    companyId: string,
    connectionId: string,
    limit: number,
    cursor?: string,
  ): Promise<KeysetPage<VendorWarehouseMappingView>> {
    const take = clampLimit(limit);
    const decoded = this.decodeCursor(cursor);
    const where: Prisma.StorefrontConnectionVendorWarehouseWhereInput = { companyId, connectionId };
    if (decoded !== null) {
      const p = decoded["p"] as string;
      const t = decoded["t"] as string;
      where.AND = [
        {
          OR: [
            { createdAt: { lt: new Date(p) } },
            { AND: [{ createdAt: new Date(p) }, { id: { lt: t } }] },
          ],
        },
      ];
    }
    const rows = await this.tenantTx(companyId, (tx) =>
      tx.storefrontConnectionVendorWarehouse.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: take + 1,
        select: MAPPING_SELECT,
      }),
    );
    const views = rows.map((r) => this.toView(r));
    return buildKeysetPage(views, take, (v) => ({ p: v.createdAt, t: v.id }));
  }

  async create(
    actor: WriteActor,
    data: CreateVendorWarehouseMappingInput,
  ): Promise<VendorWarehouseMappingView> {
    return this.tenantTx(actor.companyId, async (tx) => {
      await this.assertWarehouse(tx, actor.companyId, data.warehouseId);
      try {
        const row = await tx.storefrontConnectionVendorWarehouse.create({
          data: stampForCreate(actor, {
            connectionId: data.connectionId,
            externalVendorId: data.externalVendorId,
            warehouseId: data.warehouseId,
          }) as Prisma.StorefrontConnectionVendorWarehouseUncheckedCreateInput,
          select: MAPPING_SELECT,
        });
        return this.toView(row);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new DuplicateVendorMappingError();
        }
        throw error;
      }
    });
  }

  async delete(companyId: string, connectionId: string, id: string): Promise<boolean> {
    return this.tenantTx(companyId, async (tx) => {
      const { count } = await tx.storefrontConnectionVendorWarehouse.deleteMany({
        where: { id, companyId, connectionId },
      });
      return count > 0;
    });
  }

  // ---- internals -----------------------------------------------------------

  private tenantTx<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx);
    });
  }

  private async assertWarehouse(tx: Tx, companyId: string, warehouseId: string): Promise<void> {
    const found = await tx.warehouse.findFirst({
      where: { id: warehouseId, companyId },
      select: { id: true },
    });
    if (found === null) throw new WarehouseNotFoundError();
  }

  private toView(row: MappingRow): VendorWarehouseMappingView {
    return {
      id: row.id,
      connectionId: row.connectionId,
      externalVendorId: row.externalVendorId,
      warehouseId: row.warehouseId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private decodeCursor(raw: string | undefined): CursorValues | null {
    if (raw === undefined) return null;
    try {
      return decodeCursor(raw);
    } catch (error) {
      if (error instanceof InvalidCursorError) throw new InvalidListCursorError();
      throw error;
    }
  }
}

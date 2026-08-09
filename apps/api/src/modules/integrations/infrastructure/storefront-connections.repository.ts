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
  stampForUpdate,
} from "@cadeau/database";
import type {
  StorefrontConnectionStatus,
  StorefrontConnectionView,
  StorefrontPlatform,
} from "../domain/storefront-connection.entity";
import {
  type ConnectionKeyCandidate,
  type CreateConnectionInput,
  type StorefrontConnectionsRepositoryPort,
  type UpdateConnectionInput,
  type WriteActor,
} from "../domain/storefront-connections-repository.port";
import {
  DuplicateConnectionLabelError,
  InvalidListCursorError,
  WarehouseNotFoundError,
} from "../domain/storefront.errors";
import { INTEGRATIONS_PRISMA_CLIENT } from "./prisma-client.provider";

type Tx = Prisma.TransactionClient;

const CONNECTION_SELECT = {
  id: true,
  label: true,
  platform: true,
  apiKeyPrefix: true,
  defaultWarehouseId: true,
  status: true,
  lastEventAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ConnectionRow = Prisma.StorefrontConnectionGetPayload<{ select: typeof CONNECTION_SELECT }>;

/**
 * Prisma-backed {@link StorefrontConnectionsRepositoryPort}. Every management
 * operation binds the tenant via `setTenantContext`, mirroring
 * `CarrierConnectionsRepository`. {@link findActiveByKeyPrefix} is the one
 * deliberate exception (D3): it runs with no tenant bound, relying on the
 * `storefront_connections_select` policy widened for exactly this lookup.
 */
@Injectable()
export class StorefrontConnectionsRepository implements StorefrontConnectionsRepositoryPort {
  constructor(@Inject(INTEGRATIONS_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async list(
    companyId: string,
    limit: number,
    cursor?: string,
  ): Promise<KeysetPage<StorefrontConnectionView>> {
    const take = clampLimit(limit);
    const decoded = this.decodeCursor(cursor);
    const where: Prisma.StorefrontConnectionWhereInput = { companyId };
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
      tx.storefrontConnection.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: take + 1,
        select: CONNECTION_SELECT,
      }),
    );
    const views = rows.map((r) => this.toView(r));
    return buildKeysetPage(views, take, (v) => ({ p: v.createdAt, t: v.id }));
  }

  async findById(companyId: string, id: string): Promise<StorefrontConnectionView | null> {
    return this.tenantTx(companyId, async (tx) => {
      const row = await tx.storefrontConnection.findFirst({
        where: { id, companyId },
        select: CONNECTION_SELECT,
      });
      return row === null ? null : this.toView(row);
    });
  }

  async create(actor: WriteActor, data: CreateConnectionInput): Promise<StorefrontConnectionView> {
    return this.tenantTx(actor.companyId, async (tx) => {
      await this.assertWarehouse(tx, actor.companyId, data.defaultWarehouseId);
      try {
        const row = await tx.storefrontConnection.create({
          data: stampForCreate(actor, {
            label: data.label,
            platform: data.platform ?? "generic",
            apiKeyHash: data.apiKeyHash,
            apiKeyPrefix: data.apiKeyPrefix,
            defaultWarehouseId: data.defaultWarehouseId ?? null,
            webhookSecretEncrypted: data.webhookSecretEncrypted ?? null,
          }) as Prisma.StorefrontConnectionUncheckedCreateInput,
          select: CONNECTION_SELECT,
        });
        return this.toView(row);
      } catch (error) {
        throw this.mapWriteError(error);
      }
    });
  }

  async update(
    actor: WriteActor,
    id: string,
    data: UpdateConnectionInput,
  ): Promise<StorefrontConnectionView | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      await this.assertWarehouse(tx, actor.companyId, data.defaultWarehouseId);
      const where = { id, companyId: actor.companyId };
      const patch: Record<string, unknown> = {};
      if (data.label !== undefined) patch["label"] = data.label;
      if (data.defaultWarehouseId !== undefined)
        patch["defaultWarehouseId"] = data.defaultWarehouseId;
      if (data.status !== undefined) patch["status"] = data.status;
      if (data.webhookSecretEncrypted !== undefined)
        patch["webhookSecretEncrypted"] = data.webhookSecretEncrypted;
      try {
        const { count } = await tx.storefrontConnection.updateMany({
          where,
          data: stampForUpdate(actor, patch) as Prisma.StorefrontConnectionUncheckedUpdateManyInput,
        });
        if (count === 0) return null;
      } catch (error) {
        throw this.mapWriteError(error);
      }
      const row = await tx.storefrontConnection.findFirst({ where, select: CONNECTION_SELECT });
      return row === null ? null : this.toView(row);
    });
  }

  async rotateKey(
    actor: WriteActor,
    id: string,
    apiKeyHash: string,
    apiKeyPrefix: string,
  ): Promise<StorefrontConnectionView | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const where = { id, companyId: actor.companyId };
      const { count } = await tx.storefrontConnection.updateMany({
        where,
        data: stampForUpdate(actor, {
          apiKeyHash,
          apiKeyPrefix,
        }) as Prisma.StorefrontConnectionUncheckedUpdateManyInput,
      });
      if (count === 0) return null;
      const row = await tx.storefrontConnection.findFirst({ where, select: CONNECTION_SELECT });
      return row === null ? null : this.toView(row);
    });
  }

  async revoke(actor: WriteActor, id: string): Promise<StorefrontConnectionView | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const where = { id, companyId: actor.companyId };
      const { count } = await tx.storefrontConnection.updateMany({
        where,
        data: stampForUpdate(actor, {
          status: "revoked",
          revokedAt: new Date(),
        }) as Prisma.StorefrontConnectionUncheckedUpdateManyInput,
      });
      if (count === 0) return null;
      const row = await tx.storefrontConnection.findFirst({ where, select: CONNECTION_SELECT });
      return row === null ? null : this.toView(row);
    });
  }

  async findActiveByKeyPrefix(apiKeyPrefix: string): Promise<readonly ConnectionKeyCandidate[]> {
    // Deliberately NOT tenant-bound (D3), and deliberately NOT wrapped in
    // setTenantContext's transaction — see storefront_connections_select,
    // widened for exactly this pre-tenant lookup.
    const rows = await this.prisma.storefrontConnection.findMany({
      where: { apiKeyPrefix, status: "active" },
      select: {
        id: true,
        companyId: true,
        platform: true,
        defaultWarehouseId: true,
        apiKeyHash: true,
        webhookSecretEncrypted: true,
        createdBy: true,
      },
    });
    return rows.map((row) => ({
      connectionId: row.id,
      companyId: row.companyId,
      platform: row.platform as StorefrontPlatform,
      defaultWarehouseId: row.defaultWarehouseId,
      apiKeyHash: row.apiKeyHash,
      webhookSecretEncrypted: row.webhookSecretEncrypted,
      actorId: row.createdBy,
    }));
  }

  async touchLastEventAt(companyId: string, id: string): Promise<void> {
    await this.tenantTx(companyId, async (tx) => {
      await tx.storefrontConnection.updateMany({
        where: { id, companyId },
        data: { lastEventAt: new Date() },
      });
    });
  }

  // ---- internals -----------------------------------------------------------

  private tenantTx<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx);
    });
  }

  private async assertWarehouse(
    tx: Tx,
    companyId: string,
    warehouseId: string | null | undefined,
  ): Promise<void> {
    if (warehouseId === null || warehouseId === undefined) return;
    const found = await tx.warehouse.findFirst({
      where: { id: warehouseId, companyId },
      select: { id: true },
    });
    if (found === null) throw new WarehouseNotFoundError();
  }

  private toView(row: ConnectionRow): StorefrontConnectionView {
    return {
      id: row.id,
      label: row.label,
      platform: row.platform as StorefrontPlatform,
      apiKeyPrefix: row.apiKeyPrefix,
      defaultWarehouseId: row.defaultWarehouseId,
      status: row.status as StorefrontConnectionStatus,
      lastEventAt: row.lastEventAt === null ? null : row.lastEventAt.toISOString(),
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

  private mapWriteError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return new DuplicateConnectionLabelError();
    }
    return error;
  }
}

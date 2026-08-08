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
} from "@cadeau/database";
import type {
  StorefrontEventStatus,
  StorefrontEventType,
  StorefrontWebhookEventView,
} from "../domain/storefront-connection.entity";
import type {
  EnqueueResult,
  StorefrontWebhookInboxPort,
} from "../domain/storefront-webhook-inbox.port";
import { InvalidListCursorError } from "../domain/storefront.errors";
import { INTEGRATIONS_PRISMA_CLIENT } from "./prisma-client.provider";

type Tx = Prisma.TransactionClient;

const EVENT_SELECT = {
  id: true,
  connectionId: true,
  eventType: true,
  externalId: true,
  status: true,
  error: true,
  internalEntityId: true,
  attemptCount: true,
  receivedAt: true,
  processedAt: true,
} as const;

type EventRow = Prisma.StorefrontWebhookEventGetPayload<{ select: typeof EVENT_SELECT }>;

/**
 * Prisma-backed {@link StorefrontWebhookInboxPort} (D7). Every operation runs
 * tenant-bound — unlike shipping's inbox, there is no cross-tenant claim step
 * in v1 (no auto-retry worker).
 */
@Injectable()
export class StorefrontWebhookInboxRepository implements StorefrontWebhookInboxPort {
  constructor(@Inject(INTEGRATIONS_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async enqueue(
    companyId: string,
    connectionId: string,
    eventType: StorefrontEventType,
    externalId: string,
    payload: unknown,
  ): Promise<EnqueueResult> {
    return this.tenantTx(companyId, async (tx) => {
      try {
        const row = await tx.storefrontWebhookEvent.create({
          data: {
            companyId,
            connectionId,
            eventType,
            externalId,
            payload: payload as Prisma.InputJsonValue,
            status: "pending",
            attemptCount: 1,
            receivedAt: new Date(),
          } as Prisma.StorefrontWebhookEventUncheckedCreateInput,
          select: EVENT_SELECT,
        });
        return { event: this.toView(row), enqueued: true };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existing = await tx.storefrontWebhookEvent.findFirst({
            where: { connectionId, eventType, externalId },
            select: EVENT_SELECT,
          });
          if (existing !== null) return { event: this.toView(existing), enqueued: false };
        }
        throw error;
      }
    });
  }

  async markProcessed(companyId: string, id: string, internalEntityId: string): Promise<void> {
    await this.tenantTx(companyId, async (tx) => {
      await tx.storefrontWebhookEvent.updateMany({
        where: { id, companyId },
        data: { status: "processed", internalEntityId, error: null, processedAt: new Date() },
      });
    });
  }

  async markFailed(companyId: string, id: string, error: string): Promise<void> {
    await this.tenantTx(companyId, async (tx) => {
      await tx.storefrontWebhookEvent.updateMany({
        where: { id, companyId },
        data: { status: "failed", error },
      });
    });
  }

  async findById(companyId: string, id: string): Promise<StorefrontWebhookEventView | null> {
    return this.tenantTx(companyId, async (tx) => {
      const row = await tx.storefrontWebhookEvent.findFirst({
        where: { id, companyId },
        select: EVENT_SELECT,
      });
      return row === null ? null : this.toView(row);
    });
  }

  async getPayload(companyId: string, id: string): Promise<unknown | null> {
    return this.tenantTx(companyId, async (tx) => {
      const row = await tx.storefrontWebhookEvent.findFirst({
        where: { id, companyId },
        select: { payload: true },
      });
      return row === null ? null : row.payload;
    });
  }

  async incrementAttempt(companyId: string, id: string): Promise<void> {
    await this.tenantTx(companyId, async (tx) => {
      await tx.storefrontWebhookEvent.updateMany({
        where: { id, companyId },
        data: { attemptCount: { increment: 1 } },
      });
    });
  }

  async list(
    companyId: string,
    connectionId: string,
    limit: number,
    cursor?: string,
    status?: StorefrontEventStatus,
    eventType?: StorefrontEventType,
  ): Promise<KeysetPage<StorefrontWebhookEventView>> {
    const take = clampLimit(limit);
    const decoded = this.decodeCursor(cursor);
    const where: Prisma.StorefrontWebhookEventWhereInput = { companyId, connectionId };
    if (status !== undefined) where.status = status;
    if (eventType !== undefined) where.eventType = eventType;
    if (decoded !== null) {
      const p = decoded["p"] as string;
      const t = decoded["t"] as string;
      where.AND = [
        {
          OR: [
            { receivedAt: { lt: new Date(p) } },
            { AND: [{ receivedAt: new Date(p) }, { id: { lt: t } }] },
          ],
        },
      ];
    }
    const rows = await this.tenantTx(companyId, (tx) =>
      tx.storefrontWebhookEvent.findMany({
        where,
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: take + 1,
        select: EVENT_SELECT,
      }),
    );
    const views = rows.map((r) => this.toView(r));
    return buildKeysetPage(views, take, (v) => ({ p: v.receivedAt, t: v.id }));
  }

  // ---- internals -----------------------------------------------------------

  private tenantTx<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx);
    });
  }

  private toView(row: EventRow): StorefrontWebhookEventView {
    return {
      id: row.id,
      connectionId: row.connectionId,
      eventType: row.eventType as StorefrontEventType,
      externalId: row.externalId,
      status: row.status as StorefrontEventStatus,
      error: row.error,
      internalEntityId: row.internalEntityId,
      attemptCount: row.attemptCount,
      receivedAt: row.receivedAt.toISOString(),
      processedAt: row.processedAt === null ? null : row.processedAt.toISOString(),
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

import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient, setTenantContext, withTransaction } from "@cadeau/database";
import type { PendingWebhookEvent, WebhookInboxPort } from "../domain/webhook-inbox.port";
import { computeNextAttempt } from "../domain/webhook-retry-policy";
import { SHIPPING_PRISMA_CLIENT } from "./prisma-client.provider";

type Tx = Prisma.TransactionClient;

interface ClaimedRow {
  id: string;
  company_id: string;
  carrier: string;
  carrier_event_id: string;
  payload: unknown;
  attempts: number;
}

/**
 * Prisma-backed webhook inbox (EPIC-12 M12.4). `enqueue` runs tenant-bound
 * (the ingestion route already resolved the company from the signed path);
 * `claimBatch` deliberately runs with no tenant bound at all — it is the
 * retry worker's platform-level cross-tenant claim, the one access pattern
 * the M12.4 migration widened this table's SELECT/UPDATE policies for.
 * `markProcessed`/`markFailed` are handed the claimed row's own `companyId`
 * and go back to being ordinary tenant-bound writes.
 */
@Injectable()
export class WebhookInboxRepository implements WebhookInboxPort {
  constructor(@Inject(SHIPPING_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async enqueue(
    companyId: string,
    carrier: string,
    carrierEventId: string,
    payload: unknown,
  ): Promise<{ enqueued: boolean }> {
    return this.tenantTx(companyId, async (tx) => {
      try {
        await tx.shippingWebhookEvent.create({
          data: {
            companyId,
            carrier,
            carrierEventId,
            payload: payload as Prisma.InputJsonValue,
            status: "pending",
            attempts: 0,
            nextAttemptAt: new Date(),
          } as Prisma.ShippingWebhookEventUncheckedCreateInput,
        });
        return { enqueued: true };
      } catch (error) {
        // Duplicate (carrier, carrierEventId): idempotent no-op (D2).
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return { enqueued: false };
        }
        throw error;
      }
    });
  }

  async claimBatch(limit: number): Promise<readonly PendingWebhookEvent[]> {
    return withTransaction(this.prisma, async (tx) => {
      const rows = await tx.$queryRaw<ClaimedRow[]>`
        WITH due AS (
          SELECT id FROM public.shipping_webhook_events
           WHERE status IN ('pending', 'failed')
             AND next_attempt_at IS NOT NULL
             AND next_attempt_at <= now()
           ORDER BY created_at ASC
           LIMIT ${limit}
           FOR UPDATE SKIP LOCKED
        )
        UPDATE public.shipping_webhook_events e
           SET status = 'processing', updated_at = now()
          FROM due
         WHERE e.id = due.id
        RETURNING e.id, e.company_id, e.carrier, e.carrier_event_id, e.payload, e.attempts`;
      return rows.map((row) => ({
        id: row.id,
        companyId: row.company_id,
        carrier: row.carrier,
        carrierEventId: row.carrier_event_id,
        payload: row.payload,
        attempts: row.attempts,
      }));
    });
  }

  async markProcessed(companyId: string, id: string): Promise<void> {
    await this.tenantTx(companyId, async (tx) => {
      await tx.shippingWebhookEvent.updateMany({
        where: { id, companyId },
        data: { status: "processed", processedAt: new Date() },
      });
    });
  }

  async markFailed(companyId: string, id: string, attempts: number): Promise<void> {
    const nextAttemptAt = computeNextAttempt(attempts);
    await this.tenantTx(companyId, async (tx) => {
      await tx.shippingWebhookEvent.updateMany({
        where: { id, companyId },
        data: { status: "failed", attempts, nextAttemptAt },
      });
    });
  }

  private tenantTx<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx);
    });
  }
}

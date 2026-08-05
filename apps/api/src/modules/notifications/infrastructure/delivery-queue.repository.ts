import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient, setTenantContext, withTransaction } from "@cadeau/database";
import type { DeliveryQueuePort, PendingDelivery } from "../domain/delivery-queue.port";
import { computeNextAttempt } from "../domain/delivery-retry-policy";
import { NOTIFICATIONS_PRISMA_CLIENT } from "./prisma-client.provider";

type Tx = Prisma.TransactionClient;

interface ClaimedRow {
  id: string;
  company_id: string;
  notification_id: string;
  push_subscription_id: string;
  attempts: number;
}

/**
 * Prisma-backed outbound delivery queue (EPIC-15, decision D2). `enqueue`
 * runs tenant-bound (the dispatch handler already knows its company);
 * `claimBatch` runs with no tenant bound at all — the retry worker's
 * platform-level cross-tenant claim, the access pattern the M15.1 migration's
 * split SELECT/UPDATE policies permit from the start. The joined notification/
 * subscription details a claimed row needs are then fetched per-row,
 * tenant-bound with that row's own `companyId` — RLS on `notifications`/
 * `push_subscriptions` was never widened, so this two-step read is the
 * straightforward way to stay inside it. `markProcessed`/`markFailed` are
 * handed the claimed row's own `companyId` and go back to being ordinary
 * tenant-bound writes.
 */
@Injectable()
export class DeliveryQueueRepository implements DeliveryQueuePort {
  constructor(@Inject(NOTIFICATIONS_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async enqueue(
    companyId: string,
    notificationId: string,
    pushSubscriptionId: string,
  ): Promise<void> {
    await this.tenantTx(companyId, async (tx) => {
      await tx.notificationDelivery.create({
        data: {
          companyId,
          notificationId,
          pushSubscriptionId,
          channel: "web_push",
          status: "pending",
          attempts: 0,
          nextAttemptAt: new Date(),
        } as Prisma.NotificationDeliveryUncheckedCreateInput,
      });
    });
  }

  async claimBatch(limit: number): Promise<readonly PendingDelivery[]> {
    const claimed = await withTransaction(this.prisma, async (tx) => {
      const rows = await tx.$queryRaw<ClaimedRow[]>`
        WITH due AS (
          SELECT id FROM public.notification_deliveries
           WHERE status IN ('pending', 'failed')
             AND next_attempt_at IS NOT NULL
             AND next_attempt_at <= now()
           ORDER BY created_at ASC
           LIMIT ${limit}
           FOR UPDATE SKIP LOCKED
        )
        UPDATE public.notification_deliveries d
           SET status = 'processing', updated_at = now()
          FROM due
         WHERE d.id = due.id
        RETURNING d.id, d.company_id, d.notification_id, d.push_subscription_id, d.attempts`;
      return rows;
    });

    const results: PendingDelivery[] = [];
    for (const row of claimed) {
      const details = await this.tenantTx(row.company_id, async (tx) => {
        const notification = await tx.notification.findUnique({
          where: { id: row.notification_id },
          select: { title: true, body: true, payload: true },
        });
        const subscription = await tx.pushSubscription.findUnique({
          where: { id: row.push_subscription_id },
          select: { endpoint: true, p256dh: true, auth: true },
        });
        return { notification, subscription };
      });
      // The notification or subscription may have been deleted since the
      // delivery was enqueued (e.g. the user removed the subscription) — skip,
      // there is nothing left to send.
      if (details.notification === null || details.subscription === null) continue;
      results.push({
        id: row.id,
        companyId: row.company_id,
        notificationId: row.notification_id,
        pushSubscriptionId: row.push_subscription_id,
        attempts: row.attempts,
        notification: details.notification,
        subscription: details.subscription,
      });
    }
    return results;
  }

  async markProcessed(companyId: string, id: string): Promise<void> {
    await this.tenantTx(companyId, async (tx) => {
      await tx.notificationDelivery.updateMany({
        where: { id, companyId },
        data: { status: "processed", processedAt: new Date() },
      });
    });
  }

  async markFailed(
    companyId: string,
    id: string,
    attempts: number,
    lastError: string,
  ): Promise<void> {
    const nextAttemptAt = computeNextAttempt(attempts);
    await this.tenantTx(companyId, async (tx) => {
      await tx.notificationDelivery.updateMany({
        where: { id, companyId },
        data: { status: "failed", attempts, nextAttemptAt, lastError: lastError.slice(0, 2000) },
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

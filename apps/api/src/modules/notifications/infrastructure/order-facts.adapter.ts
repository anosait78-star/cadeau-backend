import { Inject, Injectable } from "@nestjs/common";
import { type PrismaClient, setTenantContext } from "@cadeau/database";
import type { OrderFacts, OrderFactsPort } from "../domain/order-facts.port";
import { NOTIFICATIONS_PRISMA_CLIENT } from "./prisma-client.provider";

/** Reads `orders.assigneeId`/`orderNumber` tenant-bound (EPIC-15, decision D6). */
@Injectable()
export class OrderFactsAdapter implements OrderFactsPort {
  constructor(@Inject(NOTIFICATIONS_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findById(companyId: string, orderId: string): Promise<OrderFacts | null> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return tx.order.findUnique({
        where: { id: orderId },
        select: { assigneeId: true, orderNumber: true },
      });
    });
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { type PrismaClient, setTenantContext } from "@cadeau/database";
import type {
  OrderFacts,
  OrderFactsPort,
  OrderVendorGroupRecipient,
} from "../domain/order-facts.port";
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

  async listVendorGroupRecipients(
    companyId: string,
    orderId: string,
  ): Promise<readonly OrderVendorGroupRecipient[]> {
    const groups = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return tx.orderVendorGroup.findMany({
        where: { orderId, companyId },
        select: {
          id: true,
          warehouseId: true,
          warehouse: {
            select: {
              vendorMembers: {
                where: { role: "vendor", status: "active" },
                select: { userId: true },
                take: 1,
              },
            },
          },
        },
      });
    });
    return groups.flatMap((group): OrderVendorGroupRecipient[] => {
      const vendor = group.warehouse.vendorMembers[0];
      if (vendor === undefined) return []; // no vendor has joined this warehouse yet
      return [
        {
          orderVendorGroupId: group.id,
          warehouseId: group.warehouseId,
          vendorUserId: vendor.userId,
        },
      ];
    });
  }
}

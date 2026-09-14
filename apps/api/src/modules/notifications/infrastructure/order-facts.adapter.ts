import { Inject, Injectable } from "@nestjs/common";
import { type PrismaClient, setTenantContext } from "@cadeau/database";
import { AccessResolverService } from "../../../shared/access/access-resolver.service";
import type {
  OrderFacts,
  OrderFactsPort,
  OrderVendorGroupRecipient,
} from "../domain/order-facts.port";
import { NOTIFICATIONS_PRISMA_CLIENT } from "./prisma-client.provider";

/**
 * The permission that means "may act on an order". Deliberately
 * `orders.manage` and not `orders.read`: read is a viewing grant that
 * analytics/finance roles also carry, while a new-order notification is a call
 * to act on it.
 */
const ORDERS_ACT_PERMISSION = "orders.manage";

/** Reads `orders.assigneeId`/`orderNumber` tenant-bound (EPIC-15, decision D6). */
@Injectable()
export class OrderFactsAdapter implements OrderFactsPort {
  constructor(
    @Inject(NOTIFICATIONS_PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly access: AccessResolverService,
  ) {}

  async findById(companyId: string, orderId: string): Promise<OrderFacts | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return tx.order.findUnique({
        where: { id: orderId },
        select: {
          assigneeId: true,
          orderNumber: true,
          total: true,
          customer: { select: { name: true } },
        },
      });
    });
    if (row === null) return null;
    return {
      assigneeId: row.assigneeId,
      orderNumber: row.orderNumber,
      customerName: row.customer.name,
      // `total` is stored as BigInt minor units; the notification payload is
      // JSON, and an order total is never near 2^53.
      totalMinor: Number(row.total),
    };
  }

  /**
   * The permission half is resolved through {@link AccessResolverService}
   * rather than a hand-written join, so "who may act on orders" cannot drift
   * from what the guards enforce: templates, per-member overrides and feature
   * gating are all applied by the one `resolveCapabilities` implementation.
   * The owner half is a direct membership read precisely *because* it must not
   * depend on that resolution — an owner hears about a new order even if the
   * orders feature or the permission was taken away from their membership.
   */
  async listNewOrderRecipients(
    companyId: string,
    excludeProfileId: string | null,
  ): Promise<readonly string[]> {
    const [owners, members] = await Promise.all([
      this.prisma.$transaction(async (tx) => {
        await setTenantContext(tx, companyId);
        return tx.companyMember.findMany({
          where: { companyId, role: "owner", status: "active" },
          select: { userId: true },
        });
      }),
      this.access.resolveCompanyMembers(companyId),
    ]);

    const recipients = new Set<string>(owners.map((owner) => owner.userId));
    for (const member of members) {
      if (member.permissions.includes(ORDERS_ACT_PERMISSION)) recipients.add(member.userId);
    }
    if (excludeProfileId !== null) recipients.delete(excludeProfileId);
    return [...recipients];
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

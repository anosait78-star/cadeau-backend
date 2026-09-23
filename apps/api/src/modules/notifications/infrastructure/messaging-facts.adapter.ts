import { Inject, Injectable } from "@nestjs/common";
import { type PrismaClient, setTenantContext } from "@cadeau/database";
import { AccessResolverService } from "../../../shared/access/access-resolver.service";
import type { MessagingFactsPort, MessagingThreadFacts } from "../domain/messaging-facts.port";
import { NOTIFICATIONS_PRISMA_CLIENT } from "./prisma-client.provider";

/**
 * The permission that means "may see and manage vendor conversations" — the
 * audience for a message a vendor sent (EPIC-17 M17.5), mirroring how
 * `messaging.controller.ts` gates the staff-only routes.
 */
const MESSAGING_MANAGE_PERMISSION = "messaging.manage";

/**
 * Reads `message_threads`/`company_members` tenant-bound (EPIC-17 M17.5),
 * the same "own Prisma client, own tenant transaction" idiom
 * `OrderFactsAdapter` uses for `orders` — this module never imports from
 * `modules/messaging`.
 *
 * `setTenantContext` sets only `app.company_id`, never a per-member session
 * variable, so `message_threads`' RLS policy's
 * `app.current_member_warehouse_id() IS NULL` branch is always true here —
 * this reads a thread the same way staff would, which is what a system-level
 * fact lookup should do.
 */
@Injectable()
export class MessagingFactsAdapter implements MessagingFactsPort {
  constructor(
    @Inject(NOTIFICATIONS_PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly access: AccessResolverService,
  ) {}

  async findThreadVendor(
    companyId: string,
    threadId: string,
  ): Promise<MessagingThreadFacts | null> {
    const thread = await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return tx.messageThread.findUnique({
        where: { id: threadId },
        select: { vendorMember: { select: { userId: true } } },
      });
    });
    if (thread === null) return null;
    return { vendorUserId: thread.vendorMember.userId };
  }

  async listMessagingManageRecipients(
    companyId: string,
    excludeProfileId: string | null,
  ): Promise<readonly string[]> {
    const members = await this.access.resolveCompanyMembers(companyId);
    const recipients = new Set<string>();
    for (const member of members) {
      if (member.permissions.includes(MESSAGING_MANAGE_PERMISSION)) recipients.add(member.userId);
    }
    if (excludeProfileId !== null) recipients.delete(excludeProfileId);
    return [...recipients];
  }
}

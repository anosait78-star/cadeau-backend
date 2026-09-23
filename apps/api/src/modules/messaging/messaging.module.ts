import { Module } from "@nestjs/common";
import { systemClockProvider } from "../../shared/time/clock";
import { MESSAGING_AUDIT } from "./domain/messaging-audit.port";
import { MESSAGING_REPOSITORY } from "./domain/messaging-repository.port";
import { MessagingService } from "./application/messaging.service";
import { MessagingAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { messagingPrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { MessagingRepository } from "./infrastructure/messaging.repository";
import { MessagingController } from "./presentation/messaging.controller";

/**
 * Vendor messaging module (composition root, EPIC-17). One conversation per
 * vendor, between that vendor and the company's staff. Reads the shared
 * `warehouses`/`company_members`/`profiles` tables directly under its own
 * Prisma client and tenant transaction — the sibling-module idiom `reviews`
 * uses for `orders`, never an import from another module. The three-layer
 * resolver + guards come from the global `AccessCoreModule`.
 */
@Module({
  controllers: [MessagingController],
  providers: [
    MessagingService,
    // `JwtAuthGuard` is constructed per-module and injects CLOCK, so every
    // module that mounts it has to provide the clock itself.
    systemClockProvider,
    messagingPrismaClientProvider,
    { provide: MESSAGING_REPOSITORY, useClass: MessagingRepository },
    { provide: MESSAGING_AUDIT, useClass: MessagingAuditLogAdapter },
  ],
  exports: [MessagingService],
})
export class MessagingModule {}

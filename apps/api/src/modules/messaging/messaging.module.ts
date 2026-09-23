import { Module } from "@nestjs/common";
import { systemClockProvider } from "../../shared/time/clock";
import { IMAGE_PROCESSOR } from "./domain/image-processor.port";
import { MESSAGING_AUDIT } from "./domain/messaging-audit.port";
import { MESSAGING_REPOSITORY } from "./domain/messaging-repository.port";
import { MessagingService } from "./application/messaging.service";
import { MessagingAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { fileStorageProvider } from "./infrastructure/file-storage.provider";
import { OrphanAttachmentSweeper } from "./infrastructure/orphan-attachment-sweeper";
import { messagingPrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { MessagingRepository } from "./infrastructure/messaging.repository";
import { SharpImageProcessor } from "./infrastructure/sharp-image-processor";
import { MessagingController } from "./presentation/messaging.controller";

/**
 * Vendor messaging module (composition root, EPIC-17). One conversation per
 * vendor, between that vendor and the company's staff, carrying text and
 * images. Reads the shared `warehouses`/`company_members`/`profiles` tables
 * directly under its own Prisma client and tenant transaction — the
 * sibling-module idiom `reviews` uses for `orders`, never an import from
 * another module. The three-layer resolver + guards come from the global
 * `AccessCoreModule`; the event bus (`message.created`, EPIC-17 M17.5) from
 * the global `EventBusModule`.
 */
@Module({
  controllers: [MessagingController],
  providers: [
    MessagingService,
    OrphanAttachmentSweeper,
    // `JwtAuthGuard` is constructed per-module and injects CLOCK, so every
    // module that mounts it has to provide the clock itself.
    systemClockProvider,
    messagingPrismaClientProvider,
    fileStorageProvider,
    { provide: MESSAGING_REPOSITORY, useClass: MessagingRepository },
    { provide: MESSAGING_AUDIT, useClass: MessagingAuditLogAdapter },
    { provide: IMAGE_PROCESSOR, useClass: SharpImageProcessor },
  ],
  exports: [MessagingService, OrphanAttachmentSweeper],
})
export class MessagingModule {}

import { Module } from "@nestjs/common";
import { systemClockProvider } from "../../shared/time/clock";
import { ShippingService } from "./application/shipping.service";
import { CARRIER_PORT } from "./domain/carrier.port";
import { SHIPPING_AUDIT } from "./domain/shipping-audit.port";
import { SHIPPING_REPOSITORY } from "./domain/shipping-repository.port";
import { ShippingAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { ManualCarrierAdapter } from "./infrastructure/manual-carrier.adapter";
import { shippingPrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { ShippingRepository } from "./infrastructure/shipping.repository";

/**
 * Shipping feature module (composition root, EPIC-12 M12.2). Wires the service
 * to the Prisma repository (which owns order validation, the carrier dispatch
 * and the fee deduction on delivery) and the durable audit adapter. The only
 * {@link CarrierPort} bound today is {@link ManualCarrierAdapter} (decision
 * D1) — a real carrier is an additive provider swap, never a caller change.
 * No controller yet (presentation lands in M12.3); the event bus comes from
 * the global {@link EventBusModule}.
 */
@Module({
  providers: [
    ShippingService,
    systemClockProvider,
    shippingPrismaClientProvider,
    { provide: CARRIER_PORT, useClass: ManualCarrierAdapter },
    { provide: SHIPPING_REPOSITORY, useClass: ShippingRepository },
    { provide: SHIPPING_AUDIT, useClass: ShippingAuditLogAdapter },
  ],
  exports: [ShippingService],
})
export class ShippingModule {}

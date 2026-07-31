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
import { ShippingController } from "./presentation/shipping.controller";

/**
 * Shipping feature module (composition root, EPIC-12). Wires the service to
 * the Prisma repository (which owns order validation, the carrier dispatch
 * and the fee deduction on delivery), the durable audit adapter, and the
 * `/v1/shipping` controller (M12.3 — carriers/shipments/bulk/detail/status/
 * waybill; the inbound webhook route is separate, added in M12.4). The only
 * {@link CarrierPort} bound today is {@link ManualCarrierAdapter} (decision
 * D1) — a real carrier is an additive provider swap, never a caller change.
 * The three-layer resolver + guards come from the global
 * {@link AccessCoreModule}; the event bus from {@link EventBusModule}.
 */
@Module({
  controllers: [ShippingController],
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

import { Module } from "@nestjs/common";
import { systemClockProvider } from "../../shared/time/clock";
import { REVIEWS_AUDIT } from "./domain/reviews-audit.port";
import { REVIEWS_REPOSITORY } from "./domain/reviews-repository.port";
import { ReviewsService } from "./application/reviews.service";
import { ReviewsAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { reviewsPrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { ReviewsRepository } from "./infrastructure/reviews.repository";
import { ReviewsController } from "./presentation/reviews.controller";

/**
 * Order reviews feature module (composition root). A one-time, immutable
 * customer review of a delivered/completed order — quality/packaging/shipping
 * star ratings plus what kind of product it was. Reads/writes the shared
 * `orders`/`order_reviews` tables directly under its own Prisma client and
 * tenant transaction (the same sibling-module idiom `shipping` uses to read
 * `orders` — never an import from `modules/orders`). The three-layer
 * resolver + guards come from the global `AccessCoreModule`.
 */
@Module({
  controllers: [ReviewsController],
  providers: [
    ReviewsService,
    systemClockProvider,
    reviewsPrismaClientProvider,
    { provide: REVIEWS_REPOSITORY, useClass: ReviewsRepository },
    { provide: REVIEWS_AUDIT, useClass: ReviewsAuditLogAdapter },
  ],
  exports: [ReviewsService],
})
export class ReviewsModule {}

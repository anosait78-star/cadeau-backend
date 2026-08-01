import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { AppConfig } from "@cadeau/config";
import { APP_CONFIG } from "../../../shared/config/config.tokens";
import { DeliveryProcessorService } from "../application/delivery-processor.service";

/** How often the worker polls for due deliveries. */
const POLL_INTERVAL_MS = 5_000;
/** Max deliveries claimed per poll tick. */
const BATCH_SIZE = 20;

/**
 * Retry worker for the outbound delivery queue (EPIC-15, decision D2) —
 * copies `WebhookRetryWorker` (EPIC-12 M12.4) exactly, applied to
 * `notification_deliveries` instead of `shipping_webhook_events`. Polls on a
 * fixed interval and processes due rows via
 * {@link DeliveryProcessorService.processBatch}.
 *
 * Skipped entirely under test (`config.isTest`) for the same reason as its
 * shipping counterpart: the e2e boot doesn't mock this module's Prisma
 * client, and a real `setInterval` hitting a possibly-absent database would
 * be background noise at best.
 */
@Injectable()
export class DeliveryRetryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryRetryWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly processor: DeliveryProcessorService,
  ) {}

  onModuleInit(): void {
    if (this.config.isTest) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    // setInterval does not wait for the previous tick to finish; guard
    // against overlapping runs if a poll ever runs long.
    if (this.ticking) return;
    this.ticking = true;
    try {
      const result = await this.processor.processBatch(BATCH_SIZE);
      if (result.processed > 0 || result.failed > 0) {
        this.logger.log(
          `Delivery retry tick: ${result.processed} processed, ${result.failed} failed.`,
        );
      }
    } catch (error) {
      this.logger.error(
        "Delivery retry tick failed unexpectedly.",
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.ticking = false;
    }
  }
}

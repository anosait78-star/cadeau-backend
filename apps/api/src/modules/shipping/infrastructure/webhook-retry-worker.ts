import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { AppConfig } from "@cadeau/config";
import { APP_CONFIG } from "../../../shared/config/config.tokens";
import { WebhookProcessorService } from "../application/webhook-processor.service";

/** How often the worker polls for due events. */
const POLL_INTERVAL_MS = 5_000;
/** Max events claimed per poll tick. */
const BATCH_SIZE = 20;

/**
 * Retry worker for the webhook inbox (EPIC-12 M12.4, decision D2). Polls
 * `shipping_webhook_events` on a fixed interval and processes due rows via
 * {@link WebhookProcessorService.processBatch}.
 *
 * Skipped entirely under test (`config.isTest`): the e2e boot
 * (`Test.createTestingModule({ imports: [AppModule] })`, see
 * `health.e2e.test.ts`/`auth.e2e.test.ts`) does not mock this module's
 * Prisma client, and a real `setInterval` hitting a possibly-absent database
 * would be background noise at best.
 *
 * A single in-process `setInterval` is enough here — one API instance per
 * environment today, no horizontal scale-out — and the claim query's
 * `FOR UPDATE SKIP LOCKED` (`webhook-inbox.repository.ts`) means it would
 * stay correct even if there were more than one.
 */
@Injectable()
export class WebhookRetryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookRetryWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly processor: WebhookProcessorService,
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
          `Webhook retry tick: ${result.processed} processed, ${result.failed} failed.`,
        );
      }
    } catch (error) {
      this.logger.error(
        "Webhook retry tick failed unexpectedly.",
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.ticking = false;
    }
  }
}

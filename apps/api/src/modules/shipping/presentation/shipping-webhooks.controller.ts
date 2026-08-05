import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AppErrors } from "../../../shared/errors/app-exception";
import { WebhookProcessorService } from "../application/webhook-processor.service";
import { WebhookSignatureGuard } from "./webhook-signature.guard";

/**
 * Inbound carrier webhook (EPIC-12 M12.4, contract: docs/api/shipping.md).
 * A separate controller from {@link ShippingController}: this route carries
 * no `JwtAuthGuard`/`AccessGuard` — {@link WebhookSignatureGuard} is its only
 * gate. The company comes from the **signed path**
 * (`{carrier}/{companyId}`), never the body (ADR-0003), so the row's tenant
 * is always known before any DB read (see the M12.1 migration's header).
 *
 * The body is intentionally untyped (`Record<string, unknown>`, not a
 * class-validator DTO): a real carrier's payload carries fields we don't
 * control and shouldn't reject sight-unseen. Only `eventId` (the uniqueness
 * key) is checked here; the rest is stored as-is and interpreted by
 * {@link WebhookProcessorService} when the retry worker processes the row.
 */
@ApiTags("shipping")
@Controller("shipping/webhooks")
@UseGuards(WebhookSignatureGuard)
export class ShippingWebhooksController {
  constructor(private readonly processor: WebhookProcessorService) {}

  @Post(":carrier/:companyId")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Inbound carrier callback (queued, signature-verified)",
    operationId: "shippingWebhook",
  })
  async receive(
    @Param("carrier") carrier: string,
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ received: boolean }> {
    const eventId = body["eventId"];
    if (typeof eventId !== "string" || eventId.length === 0) {
      throw AppErrors.badRequest("Webhook payload is missing eventId.");
    }
    // 202 either way: a duplicate eventId is an idempotent no-op (D2), not an
    // error — the carrier should never see a failure for a replayed callback.
    await this.processor.ingest(companyId, carrier, eventId, body);
    return { received: true };
  }
}

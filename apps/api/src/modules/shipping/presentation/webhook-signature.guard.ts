import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { AppConfig } from "@cadeau/config";
import { verifyWebhookSignature } from "@cadeau/crypto";
import type { Request } from "express";
import { APP_CONFIG } from "../../../shared/config/config.tokens";
import { AppErrors } from "../../../shared/errors/app-exception";

/** The header carrying the hex HMAC-SHA256 signature over the raw request body. */
const SIGNATURE_HEADER = "x-webhook-signature";

/**
 * Verifies an inbound carrier webhook's HMAC-SHA256 signature against the
 * exact raw request bytes (`req.rawBody`, enabled in `main.ts`) before the
 * payload is trusted (EPIC-12 M12.4). This route carries **no**
 * `JwtAuthGuard`/`AccessGuard` — the signature is the entire trust boundary,
 * the same role `RateLimitGuard` plays for the public register/login/refresh
 * routes (neither is registered as an explicit module provider; Nest
 * instantiates a `@UseGuards()` class directly, resolving its constructor
 * deps from whatever's available — here, the globally-provided `APP_CONFIG`).
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const signature = request.headers[SIGNATURE_HEADER];
    if (typeof signature !== "string" || signature.length === 0) {
      throw AppErrors.unauthorized("Missing webhook signature.");
    }
    if (request.rawBody === undefined) {
      throw AppErrors.unauthorized("Raw body unavailable for signature verification.");
    }
    try {
      verifyWebhookSignature(request.rawBody, signature, this.config.shipping.webhookSigningSecret);
    } catch {
      throw AppErrors.unauthorized("Invalid webhook signature.");
    }
    return true;
  }
}

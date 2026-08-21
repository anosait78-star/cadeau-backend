import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { AppConfig } from "@cadeau/config";
import { decrypt, verifyPassword, verifyWooCommerceWebhookSignature } from "@cadeau/crypto";
import type { Request } from "express";
import { APP_CONFIG } from "../../../shared/config/config.tokens";
import { AppErrors } from "../../../shared/errors/app-exception";
import type { ResolvedStorefrontConnection } from "../domain/storefront-connection.entity";
import {
  STOREFRONT_CONNECTIONS_REPOSITORY,
  type StorefrontConnectionsRepositoryPort,
} from "../domain/storefront-connections-repository.port";

/** The number of leading characters of the plaintext key stored as `apiKeyPrefix`. */
const PREFIX_LENGTH = 8;

/** The header WooCommerce sends its inbound-webhook HMAC signature in. */
const WOOCOMMERCE_SIGNATURE_HEADER = "x-wc-webhook-signature";

/** A request after {@link StorefrontApiKeyGuard} has attached the resolved connection. */
export interface StorefrontIngestionRequest extends Request {
  storefrontConnection?: ResolvedStorefrontConnection;
}

/**
 * Authenticates the two ingestion routes (`POST .../orders`,
 * `POST .../products`) by API key instead of JWT (storefront-integration
 * §D3). The key's non-secret {@link PREFIX_LENGTH}-char prefix narrows the
 * candidate set (almost always to one row — {@link
 * StorefrontConnectionsRepositoryPort.findActiveByKeyPrefix} runs with no
 * tenant bound, see the widened `storefront_connections_select` RLS policy);
 * each candidate's hash is then verified with `verifyPassword`, exactly like
 * a login flow narrows by email before verifying the password hash. The
 * resolved `companyId`/`connectionId` are attached to the request — **never**
 * trust a `companyId`-shaped field in the request body (D3).
 *
 * This route carries no `JwtAuthGuard`/`AccessGuard` — the API key is the
 * primary trust boundary, the same role `WebhookSignatureGuard` plays for
 * inbound carrier webhooks. When the resolved connection is `platform:
 * "woocommerce"` AND has a webhook secret configured
 * (`webhookSecretEncrypted`), this guard additionally verifies WooCommerce's
 * own `X-WC-Webhook-Signature` against the exact raw request bytes — a
 * SUPPLEMENTARY check, opt-in per connection, layered on top of the API key
 * rather than replacing it (a connection with no secret configured behaves
 * exactly as before: API key only).
 *
 * That supplementary check only applies to `.../orders` and `.../products` —
 * the two routes WooCommerce's own `WC_Webhook::deliver()` actually dispatches
 * (and therefore the only ones that can ever carry a genuine
 * `X-WC-Webhook-Signature`, computed by WooCommerce core itself from the
 * connection's configured secret). `.../vendors` is not a native WooCommerce
 * webhook delivery — it's a hand-built request a WPCode snippet fires
 * directly on the storefront's `wcfmmp_new_store_created` action — so it is
 * never signature-checked; the API key alone remains its full trust boundary
 * (vendor auto-registration, 2026-08-21).
 */
@Injectable()
export class StorefrontApiKeyGuard implements CanActivate {
  constructor(
    @Inject(STOREFRONT_CONNECTIONS_REPOSITORY)
    private readonly repo: StorefrontConnectionsRepositoryPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RawBodyRequest<StorefrontIngestionRequest>>();
    const header = request.headers["authorization"];
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      throw AppErrors.unauthorized("Missing storefront API key.");
    }
    const apiKey = header.slice("Bearer ".length).trim();
    if (apiKey.length < PREFIX_LENGTH) {
      throw AppErrors.unauthorized("Invalid storefront API key.");
    }
    const prefix = apiKey.slice(0, PREFIX_LENGTH);
    const candidates = await this.repo.findActiveByKeyPrefix(prefix);
    for (const candidate of candidates) {
      if (!(await verifyPassword(apiKey, candidate.apiKeyHash))) continue;
      if (
        candidate.platform === "woocommerce" &&
        candidate.webhookSecretEncrypted !== null &&
        this.isNativeWebhookRoute(request)
      ) {
        this.verifyWooCommerceSignature(request, candidate.webhookSecretEncrypted);
      }
      request.storefrontConnection = {
        connectionId: candidate.connectionId,
        companyId: candidate.companyId,
        platform: candidate.platform,
        defaultWarehouseId: candidate.defaultWarehouseId,
        actorId: candidate.actorId,
      };
      return true;
    }
    throw AppErrors.unauthorized("Invalid storefront API key.");
  }

  /**
   * `true` only for `.../orders` and `.../products` — the two routes
   * WooCommerce's own webhook delivery actually posts to. `.../vendors`
   * (and any future non-native route added under this guard) is exempt: it
   * can never carry a WooCommerce-computed signature, so requiring one would
   * just lock every caller out regardless of how valid their API key is.
   */
  private isNativeWebhookRoute(request: RawBodyRequest<StorefrontIngestionRequest>): boolean {
    return /\/(orders|products)$/.test(request.path);
  }

  /** @throws an `AppException` (401) if the header is missing or the signature doesn't match. */
  private verifyWooCommerceSignature(
    request: RawBodyRequest<StorefrontIngestionRequest>,
    webhookSecretEncrypted: string,
  ): void {
    const signature = request.headers[WOOCOMMERCE_SIGNATURE_HEADER];
    if (typeof signature !== "string" || signature.length === 0) {
      throw AppErrors.unauthorized("Missing WooCommerce webhook signature.");
    }
    if (request.rawBody === undefined) {
      throw AppErrors.unauthorized("Raw body unavailable for signature verification.");
    }
    let secret: string;
    try {
      secret = decrypt(webhookSecretEncrypted, this.config.encryption.key);
    } catch {
      throw AppErrors.unauthorized("This connection's webhook secret could not be read.");
    }
    if (!verifyWooCommerceWebhookSignature(request.rawBody, signature, secret)) {
      throw AppErrors.unauthorized("Invalid WooCommerce webhook signature.");
    }
  }
}

import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { verifyPassword } from "@cadeau/crypto";
import type { Request } from "express";
import { AppErrors } from "../../../shared/errors/app-exception";
import type { ResolvedStorefrontConnection } from "../domain/storefront-connection.entity";
import {
  STOREFRONT_CONNECTIONS_REPOSITORY,
  type StorefrontConnectionsRepositoryPort,
} from "../domain/storefront-connections-repository.port";

/** The number of leading characters of the plaintext key stored as `apiKeyPrefix`. */
const PREFIX_LENGTH = 8;

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
 * entire trust boundary, the same role `WebhookSignatureGuard` plays for
 * inbound carrier webhooks.
 */
@Injectable()
export class StorefrontApiKeyGuard implements CanActivate {
  constructor(
    @Inject(STOREFRONT_CONNECTIONS_REPOSITORY)
    private readonly repo: StorefrontConnectionsRepositoryPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StorefrontIngestionRequest>();
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
      if (await verifyPassword(apiKey, candidate.apiKeyHash)) {
        request.storefrontConnection = {
          connectionId: candidate.connectionId,
          companyId: candidate.companyId,
          defaultWarehouseId: candidate.defaultWarehouseId,
          actorId: candidate.actorId,
        };
        return true;
      }
    }
    throw AppErrors.unauthorized("Invalid storefront API key.");
  }
}

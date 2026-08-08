import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { AppErrors } from "../../../shared/errors/app-exception";
import type { ResolvedStorefrontConnection } from "../domain/storefront-connection.entity";
import type { StorefrontIngestionRequest } from "./storefront-api-key.guard";

/**
 * Injects the {@link ResolvedStorefrontConnection} attached by {@link
 * StorefrontApiKeyGuard}. Must be used on a route protected by that guard;
 * if absent — the guard was forgotten — it fails closed with a `401` rather
 * than handing the handler an undefined connection.
 */
export const CurrentStorefrontConnection = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ResolvedStorefrontConnection => {
    const request = context.switchToHttp().getRequest<StorefrontIngestionRequest>();
    if (request.storefrontConnection === undefined) {
      throw AppErrors.unauthorized();
    }
    return request.storefrontConnection;
  },
);

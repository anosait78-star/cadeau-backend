import { Inject, Injectable } from "@nestjs/common";
import type { StorefrontAdapterResolverPort } from "../domain/storefront-adapter-resolver.port";
import {
  GENERIC_STOREFRONT_ADAPTER,
  WOOCOMMERCE_STOREFRONT_ADAPTER,
  type StorefrontAdapterPort,
} from "../domain/storefront-adapter.port";
import type { StorefrontPlatform } from "../domain/storefront-connection.entity";
import { UnsupportedPlatformError } from "../domain/storefront.errors";

/**
 * The only place in this module that branches on `platform` (storefront-
 * integration §D8). Depends on {@link StorefrontAdapterPort} through DI
 * tokens, never on the concrete `GenericJsonAdapter`/`WooCommerceAdapter`
 * classes (those live in `infrastructure/` — reaching into them directly
 * would violate `layer-application-no-outer`); `integrations.module.ts`
 * binds each token to its concrete class. Adding a new platform (Salla/Zid/
 * Shopify) is: implement `StorefrontAdapterPort`, add one more token +
 * module binding, register it in the `switch` below — nothing in
 * `StorefrontIngestionService` or any domain service changes.
 */
@Injectable()
export class StorefrontAdapterResolver implements StorefrontAdapterResolverPort {
  constructor(
    @Inject(GENERIC_STOREFRONT_ADAPTER) private readonly generic: StorefrontAdapterPort,
    @Inject(WOOCOMMERCE_STOREFRONT_ADAPTER) private readonly woocommerce: StorefrontAdapterPort,
  ) {}

  resolve(platform: StorefrontPlatform): StorefrontAdapterPort {
    switch (platform) {
      case "generic":
        return this.generic;
      case "woocommerce":
        return this.woocommerce;
      case "salla":
      case "zid":
      case "shopify":
        throw new UnsupportedPlatformError(platform);
      default: {
        const exhaustive: never = platform;
        throw new UnsupportedPlatformError(exhaustive as string);
      }
    }
  }
}

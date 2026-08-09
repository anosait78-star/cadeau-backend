import type { StorefrontAdapterPort } from "./storefront-adapter.port";
import type { StorefrontPlatform } from "./storefront-connection.entity";

/**
 * Picks the {@link StorefrontAdapterPort} to use for one connection's
 * `platform` (storefront-integration §D8). The ingestion pipeline itself
 * (`StorefrontIngestionService`) never branches on platform — it asks this
 * port once per request and calls the same `parseOrder`/`parseProduct`
 * either way. Adding a new platform (Salla/Zid/Shopify) means registering
 * one more adapter here, never touching the ingestion service.
 */
export interface StorefrontAdapterResolverPort {
  /** @throws {@link UnsupportedPlatformError} (storefront.errors) if `platform` has no registered adapter. */
  resolve(platform: StorefrontPlatform): StorefrontAdapterPort;
}

/** DI token for {@link StorefrontAdapterResolverPort}. */
export const STOREFRONT_ADAPTER_RESOLVER = Symbol("STOREFRONT_ADAPTER_RESOLVER");

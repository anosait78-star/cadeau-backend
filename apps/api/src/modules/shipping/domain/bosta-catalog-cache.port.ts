/**
 * Port for the in-process Bosta city/district catalog cache. The application
 * layer depends on this, never on the concrete cache (`layer-application-no-outer`).
 */
export interface BostaCatalogCachePort {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
}

/** DI token for {@link BostaCatalogCachePort}. */
export const BOSTA_CATALOG_CACHE = Symbol("BOSTA_CATALOG_CACHE");

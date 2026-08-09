/**
 * Storefront integration domain views (storefront-integration §5/§6.1). The
 * shapes the application layer returns and the presentation layer renders —
 * decoupled from the Prisma row. `apiKeyHash` never appears in any view.
 */

/** The platforms a connection may declare (v1 ships only `generic`, D8). */
export const STOREFRONT_PLATFORMS = ["generic", "salla", "zid", "shopify", "woocommerce"] as const;
export type StorefrontPlatform = (typeof STOREFRONT_PLATFORMS)[number];

/** The lifecycle states of a connection. */
export const STOREFRONT_CONNECTION_STATUSES = ["active", "paused", "revoked"] as const;
export type StorefrontConnectionStatus = (typeof STOREFRONT_CONNECTION_STATUSES)[number];

/** A connected storefront, safe to render (no secret material). */
export interface StorefrontConnectionView {
  readonly id: string;
  readonly label: string;
  readonly platform: StorefrontPlatform;
  /** Non-secret first few characters of the plaintext key, for display only. */
  readonly apiKeyPrefix: string;
  readonly defaultWarehouseId: string | null;
  readonly status: StorefrontConnectionStatus;
  readonly lastEventAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Returned exactly once — from create and from rotate-key — carrying the
 * plaintext API key. Never persisted, never returned again (storefront-
 * integration §6.1).
 */
export interface StorefrontConnectionWithSecret {
  readonly connection: StorefrontConnectionView;
  readonly apiKey: string;
}

/** The event kinds a webhook row records (mirrors the DB CHECK). */
export const STOREFRONT_EVENT_TYPES = ["order", "product"] as const;
export type StorefrontEventType = (typeof STOREFRONT_EVENT_TYPES)[number];

/** The processing states a webhook row can be in (mirrors the DB CHECK). */
export const STOREFRONT_EVENT_STATUSES = ["pending", "processed", "failed"] as const;
export type StorefrontEventStatus = (typeof STOREFRONT_EVENT_STATUSES)[number];

/** A row in the append-first webhook inbox (storefront-integration §D7). */
export interface StorefrontWebhookEventView {
  readonly id: string;
  readonly connectionId: string;
  readonly eventType: StorefrontEventType;
  readonly externalId: string;
  readonly status: StorefrontEventStatus;
  readonly error: string | null;
  readonly internalEntityId: string | null;
  readonly attemptCount: number;
  readonly receivedAt: string;
  readonly processedAt: string | null;
}

/**
 * The connection resolved by {@link StorefrontApiKeyGuard} and attached to the
 * request (D3: tenant + routing info come from the key alone). `actorId` is
 * the connection's own `createdBy` — the admin who set it up — used to
 * attribute system-originated writes so they satisfy the same
 * `created_by`/`actor_id` FK constraints (e.g. `order_activities`) a
 * JWT-authenticated write would; `null` only if that admin's profile has
 * since been removed, in which case ingestion fails closed (§ingestion
 * service) rather than attributing a write to nobody.
 */
export interface ResolvedStorefrontConnection {
  readonly connectionId: string;
  readonly companyId: string;
  readonly platform: StorefrontPlatform;
  readonly defaultWarehouseId: string | null;
  readonly actorId: string | null;
}

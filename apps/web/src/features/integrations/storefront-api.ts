import { apiFetch } from "@/lib/api-client";

/**
 * Client for `/v1/integrations/storefront` management endpoints (contract:
 * docs/api/storefront.md §6.1). The two ingestion endpoints
 * (`/orders`, `/products`) are called by the storefront itself with its own
 * API key, not from this app — out of scope here.
 */

/** `storefront_connections.platform` — v1 ships only `generic` (D8). */
export const STOREFRONT_PLATFORMS = ["generic", "salla", "zid", "shopify", "woocommerce"] as const;
export type StorefrontPlatform = (typeof STOREFRONT_PLATFORMS)[number];

/** A connection's lifecycle state. `revoked` is terminal. */
export const STOREFRONT_CONNECTION_STATUSES = ["active", "paused", "revoked"] as const;
export type StorefrontConnectionStatus = (typeof STOREFRONT_CONNECTION_STATUSES)[number];

/** `storefront_webhook_events.event_type`. */
export const STOREFRONT_EVENT_TYPES = ["order", "product"] as const;
export type StorefrontEventType = (typeof STOREFRONT_EVENT_TYPES)[number];

/** `storefront_webhook_events.status`. */
export const STOREFRONT_EVENT_STATUSES = ["pending", "processed", "failed"] as const;
export type StorefrontEventStatus = (typeof STOREFRONT_EVENT_STATUSES)[number];

/** One connected store (masked `apiKeyPrefix` — never the plaintext key). */
export interface StorefrontConnection {
  readonly id: string;
  readonly label: string;
  readonly platform: string;
  readonly apiKeyPrefix: string;
  readonly defaultWarehouseId: string | null;
  readonly status: string;
  readonly lastEventAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A connection right after create/rotate-key — carries the plaintext `apiKey`.
 * Returned exactly once; the API never exposes it again (D1/D2).
 */
export interface StorefrontConnectionWithKey extends StorefrontConnection {
  readonly apiKey: string;
}

/** One row of the `storefront_webhook_events` inbox (D7). */
export interface StorefrontWebhookEvent {
  readonly id: string;
  readonly eventType: string;
  readonly externalId: string;
  readonly status: string;
  readonly error: string | null;
  readonly internalEntityId: string | null;
  readonly attemptCount: number;
  readonly receivedAt: string;
  readonly processedAt: string | null;
}

/** A keyset page (api-conventions §5). */
export interface Page<T> {
  readonly data: T[];
  readonly page: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

export interface CreateConnectionInput {
  readonly label: string;
  readonly platform?: StorefrontPlatform;
  readonly defaultWarehouseId?: string | null;
  /** Optional platform webhook signing secret (e.g. WooCommerce's). Write-only — never read back. */
  readonly webhookSecret?: string;
}

export interface UpdateConnectionInput {
  readonly label?: string;
  readonly defaultWarehouseId?: string | null;
  readonly status?: "active" | "paused";
  /** Set/replace the webhook secret; `null` clears it, omit to leave unchanged. */
  readonly webhookSecret?: string | null;
}

/** The outcome of a manual reprocess of one `failed` event. */
export interface ReprocessResult {
  readonly entityId: string;
  readonly status: "created" | "updated" | "duplicate";
}

/** `GET /v1/integrations/storefront/connections` — keyset, `createdAt desc, id desc`. */
export function listStorefrontConnections(params?: {
  cursor?: string;
  limit?: number;
}): Promise<Page<StorefrontConnection>> {
  const query = new URLSearchParams();
  if (params?.cursor !== undefined) query.set("cursor", params.cursor);
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  const qs = query.toString();
  return apiFetch<Page<StorefrontConnection>>(
    `/integrations/storefront/connections${qs.length > 0 ? `?${qs}` : ""}`,
  );
}

/** `POST /v1/integrations/storefront/connections` — response includes the plaintext key once. */
export function createStorefrontConnection(
  body: CreateConnectionInput,
): Promise<StorefrontConnectionWithKey> {
  return apiFetch<StorefrontConnectionWithKey>("/integrations/storefront/connections", {
    method: "POST",
    body,
  });
}

/** `GET /v1/integrations/storefront/connections/{connectionId}` — masked detail. */
export function getStorefrontConnection(connectionId: string): Promise<StorefrontConnection> {
  return apiFetch<StorefrontConnection>(
    `/integrations/storefront/connections/${encodeURIComponent(connectionId)}`,
  );
}

/** `PATCH /v1/integrations/storefront/connections/{connectionId}` — label / defaultWarehouseId / status. */
export function updateStorefrontConnection(
  connectionId: string,
  body: UpdateConnectionInput,
): Promise<StorefrontConnection> {
  return apiFetch<StorefrontConnection>(
    `/integrations/storefront/connections/${encodeURIComponent(connectionId)}`,
    { method: "PATCH", body },
  );
}

/**
 * `POST .../connections/{connectionId}/rotate-key` — old key stops working
 * immediately; the new plaintext key is returned once, same shape as create.
 */
export function rotateStorefrontConnectionKey(
  connectionId: string,
): Promise<StorefrontConnectionWithKey> {
  return apiFetch<StorefrontConnectionWithKey>(
    `/integrations/storefront/connections/${encodeURIComponent(connectionId)}/rotate-key`,
    { method: "POST" },
  );
}

/** `POST .../connections/{connectionId}/revoke` — terminal; irreversible. */
export function revokeStorefrontConnection(connectionId: string): Promise<StorefrontConnection> {
  return apiFetch<StorefrontConnection>(
    `/integrations/storefront/connections/${encodeURIComponent(connectionId)}/revoke`,
    { method: "POST" },
  );
}

/** `GET .../connections/{connectionId}/events` — keyset, `receivedAt desc, id desc`. */
export function listStorefrontEvents(
  connectionId: string,
  params?: {
    cursor?: string;
    limit?: number;
    status?: StorefrontEventStatus;
    eventType?: StorefrontEventType;
  },
): Promise<Page<StorefrontWebhookEvent>> {
  const query = new URLSearchParams();
  if (params?.cursor !== undefined) query.set("cursor", params.cursor);
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.status !== undefined) query.set("status", params.status);
  if (params?.eventType !== undefined) query.set("eventType", params.eventType);
  const qs = query.toString();
  return apiFetch<Page<StorefrontWebhookEvent>>(
    `/integrations/storefront/connections/${encodeURIComponent(connectionId)}/events${
      qs.length > 0 ? `?${qs}` : ""
    }`,
  );
}

/** `POST .../connections/{connectionId}/events/{eventId}/reprocess` — manually re-run one `failed` event. */
export function reprocessStorefrontEvent(
  connectionId: string,
  eventId: string,
): Promise<ReprocessResult> {
  return apiFetch<ReprocessResult>(
    `/integrations/storefront/connections/${encodeURIComponent(connectionId)}/events/${encodeURIComponent(
      eventId,
    )}/reprocess`,
    { method: "POST" },
  );
}

import type { KeysetPage } from "@cadeau/database";
import type {
  StorefrontConnectionStatus,
  StorefrontConnectionView,
  StorefrontPlatform,
} from "./storefront-connection.entity";

/**
 * A candidate row for API-key verification (storefront-integration §D1/D3).
 * `hashPassword`/scrypt salts every hash independently, so a hash can't be
 * looked up by equality — the guard narrows by the key's non-secret
 * `apiKeyPrefix` (usually to exactly one row) and verifies each candidate's
 * `apiKeyHash` with `verifyPassword`, exactly like the login flow narrows by
 * email before verifying the password hash.
 */
export interface ConnectionKeyCandidate {
  readonly connectionId: string;
  readonly companyId: string;
  readonly platform: StorefrontPlatform;
  readonly defaultWarehouseId: string | null;
  readonly apiKeyHash: string;
  /** AES-256-GCM ciphertext of the platform webhook secret, or `null` if none is configured. */
  readonly webhookSecretEncrypted: string | null;
  /** The connection's `createdBy` — see {@link ResolvedStorefrontConnection}. */
  readonly actorId: string | null;
}

/** The tenant + acting member for a write. */
export interface WriteActor {
  readonly companyId: string;
  readonly actorId: string;
}

/** Fields accepted when creating a connection. The hash/prefix are already derived. */
export interface CreateConnectionInput {
  readonly label: string;
  readonly platform?: StorefrontPlatform;
  readonly apiKeyHash: string;
  readonly apiKeyPrefix: string;
  readonly defaultWarehouseId?: string | null;
  /** Already-encrypted (AES-256-GCM) webhook secret, if the caller supplied one. */
  readonly webhookSecretEncrypted?: string | null;
}

/** Partial update for a connection; omitted keys are left unchanged. */
export interface UpdateConnectionInput {
  readonly label?: string;
  readonly defaultWarehouseId?: string | null;
  readonly status?: "active" | "paused";
  /** Already-encrypted (AES-256-GCM); `null` clears it, `undefined` leaves it unchanged. */
  readonly webhookSecretEncrypted?: string | null;
}

/** A raw (unvalidated) page request. */
export interface RawConnectionListQuery {
  readonly limit?: string;
  readonly cursor?: string;
}

/**
 * Port for reading/writing storefront connections (D1/D2/D3). The Prisma
 * adapter binds the tenant under RLS for every management operation; the one
 * exception is {@link findActiveByKeyHash}, which necessarily runs BEFORE a
 * tenant is known (the key IS what determines the tenant) — see the
 * `storefront_connections_select` RLS policy widened for exactly this.
 */
export interface StorefrontConnectionsRepositoryPort {
  list(
    companyId: string,
    limit: number,
    cursor?: string,
  ): Promise<KeysetPage<StorefrontConnectionView>>;

  findById(companyId: string, id: string): Promise<StorefrontConnectionView | null>;

  create(actor: WriteActor, data: CreateConnectionInput): Promise<StorefrontConnectionView>;

  update(
    actor: WriteActor,
    id: string,
    data: UpdateConnectionInput,
  ): Promise<StorefrontConnectionView | null>;

  /** Replace the key hash/prefix for one connection; other connections are untouched (D1). */
  rotateKey(
    actor: WriteActor,
    id: string,
    apiKeyHash: string,
    apiKeyPrefix: string,
  ): Promise<StorefrontConnectionView | null>;

  /** Terminal: `status = 'revoked'`. A new connection must be created to reconnect. */
  revoke(actor: WriteActor, id: string): Promise<StorefrontConnectionView | null>;

  /**
   * All `status = 'active'` connections whose `apiKeyPrefix` matches (almost
   * always zero or one row). Runs with no tenant bound — the widened
   * `storefront_connections_select` RLS policy is exactly for this lookup
   * (D3: tenant comes from the key alone, never the payload).
   */
  findActiveByKeyPrefix(apiKeyPrefix: string): Promise<readonly ConnectionKeyCandidate[]>;

  /** Best-effort bookkeeping touch; failures here must never fail ingestion. */
  touchLastEventAt(companyId: string, id: string): Promise<void>;
}

/** DI token for {@link StorefrontConnectionsRepositoryPort}. */
export const STOREFRONT_CONNECTIONS_REPOSITORY = Symbol("STOREFRONT_CONNECTIONS_REPOSITORY");

export type { StorefrontConnectionStatus };

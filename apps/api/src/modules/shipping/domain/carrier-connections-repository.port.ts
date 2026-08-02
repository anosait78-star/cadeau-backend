import type { CarrierConnectionView } from "./carrier-connection.entity";

/** Fields persisted when a connection is created or reactivated. */
export interface UpsertCarrierConnectionInput {
  readonly companyId: string;
  readonly carrier: string;
  /** Already-encrypted (`@cadeau/crypto`); the repository never sees plaintext. */
  readonly apiKeyEncrypted: string;
  /** SHA-256 hash of the raw webhook token; the raw token is never stored. */
  readonly webhookTokenHash: string;
  readonly pickupLocationWarning: boolean;
  readonly actorId: string;
}

/**
 * Port for reading/writing per-tenant carrier connections. The Prisma adapter
 * binds the tenant under RLS for every unit of work, mirroring every other
 * tenant-scoped repository in this codebase (`data-access-only-in-infrastructure`).
 */
export interface CarrierConnectionsRepositoryPort {
  /** The company's connections, active or not (settings screen shows both states). */
  list(companyId: string): Promise<CarrierConnectionView[]>;

  /** An active connection's decrypted-ready row, or `null` if none/inactive. Used by adapters. */
  findActive(
    companyId: string,
    carrier: string,
  ): Promise<{ readonly apiKeyEncrypted: string; readonly webhookTokenHash: string } | null>;

  /** Create or reactivate a connection (idempotent per `(companyId, carrier)`). */
  upsert(input: UpsertCarrierConnectionInput): Promise<CarrierConnectionView>;

  /** Soft-disconnect (`is_active = false`). Returns the deactivated row's id, or `null` if none matched. */
  deactivate(companyId: string, carrier: string, actorId: string): Promise<string | null>;
}

/** DI token for {@link CarrierConnectionsRepositoryPort}. */
export const CARRIER_CONNECTIONS_REPOSITORY = Symbol("CARRIER_CONNECTIONS_REPOSITORY");

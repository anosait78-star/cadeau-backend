import type { KeysetPage } from "@cadeau/database";
import type { VendorWarehouseMappingView } from "./vendor-warehouse-mapping.entity";
import type { WriteActor } from "./storefront-connections-repository.port";

/** Fields accepted when creating a vendor->warehouse mapping. */
export interface CreateVendorWarehouseMappingInput {
  readonly connectionId: string;
  readonly externalVendorId: string;
  readonly warehouseId: string;
}

/**
 * Port for the vendor->warehouse mapping table (multi-vendor discovery,
 * 2026-08-10). {@link findWarehouseId} is the hot read path used by
 * `StorefrontIngestionService` on every multi-vendor order; the rest is
 * admin management (create/list/delete), same access posture as
 * {@link StorefrontConnectionsRepositoryPort} (`integrations.manage`).
 */
export interface VendorWarehouseMappingsRepositoryPort {
  /** `null` when this vendor has no mapping on this connection — never guessed. */
  findWarehouseId(
    companyId: string,
    connectionId: string,
    externalVendorId: string,
  ): Promise<string | null>;

  list(
    companyId: string,
    connectionId: string,
    limit: number,
    cursor?: string,
  ): Promise<KeysetPage<VendorWarehouseMappingView>>;

  /** @throws {@link DuplicateVendorMappingError} if the vendor is already mapped on this connection. */
  create(
    actor: WriteActor,
    data: CreateVendorWarehouseMappingInput,
  ): Promise<VendorWarehouseMappingView>;

  /** `false` if no such mapping exists. */
  delete(companyId: string, connectionId: string, id: string): Promise<boolean>;
}

/** DI token for {@link VendorWarehouseMappingsRepositoryPort}. */
export const VENDOR_WAREHOUSE_MAPPINGS_REPOSITORY = Symbol("VENDOR_WAREHOUSE_MAPPINGS_REPOSITORY");

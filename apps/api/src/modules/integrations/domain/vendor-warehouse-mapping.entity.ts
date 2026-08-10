/**
 * Explicit, admin-managed marketplace vendor -> CRM warehouse routing for one
 * storefront connection (multi-vendor discovery, 2026-08-10). Never created
 * automatically — an unmapped vendor fails the ingestion event closed rather
 * than falling back to a default warehouse.
 */
export interface VendorWarehouseMappingView {
  readonly id: string;
  readonly connectionId: string;
  readonly externalVendorId: string;
  readonly warehouseId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

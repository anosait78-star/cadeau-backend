import { Inject, Injectable } from "@nestjs/common";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppErrors } from "../../../shared/errors/app-exception";
import { withErrorMapping } from "../../../shared/errors/with-error-mapping";
import type { VendorWarehouseMappingView } from "../domain/vendor-warehouse-mapping.entity";
import {
  VENDOR_WAREHOUSE_MAPPINGS_REPOSITORY,
  type VendorWarehouseMappingsRepositoryPort,
} from "../domain/vendor-warehouse-mappings-repository.port";
import { STOREFRONT_AUDIT, type StorefrontAuditPort } from "../domain/storefront-audit.port";
import {
  STOREFRONT_CONNECTIONS_REPOSITORY,
  type StorefrontConnectionsRepositoryPort,
} from "../domain/storefront-connections-repository.port";
import { DuplicateVendorMappingError, WarehouseNotFoundError } from "../domain/storefront.errors";

/** Fields accepted when mapping a vendor to a warehouse. */
export interface CreateVendorWarehouseMappingCommand {
  readonly externalVendorId: string;
  readonly warehouseId: string;
}

/**
 * Admin management of the vendor->warehouse routing table (multi-vendor
 * discovery, 2026-08-10). Gated by the controller's
 * `@RequireCapability({ feature: "storefront_integration", permission:
 * "integrations.manage" })` — same posture as `StorefrontConnectionsService`;
 * this service assumes an authorized caller.
 */
@Injectable()
export class VendorWarehouseMappingsService {
  constructor(
    @Inject(VENDOR_WAREHOUSE_MAPPINGS_REPOSITORY)
    private readonly repo: VendorWarehouseMappingsRepositoryPort,
    @Inject(STOREFRONT_CONNECTIONS_REPOSITORY)
    private readonly connections: StorefrontConnectionsRepositoryPort,
    @Inject(STOREFRONT_AUDIT) private readonly audit: StorefrontAuditPort,
  ) {}

  async list(
    principal: RequestPrincipal,
    connectionId: string,
    limit: number | undefined,
    cursor: string | undefined,
  ): Promise<KeysetPage<VendorWarehouseMappingView>> {
    const companyId = this.requireTenant(principal);
    await this.requireConnection(companyId, connectionId);
    return this.repo.list(companyId, connectionId, limit ?? 25, cursor);
  }

  async create(
    principal: RequestPrincipal,
    connectionId: string,
    data: CreateVendorWarehouseMappingCommand,
  ): Promise<VendorWarehouseMappingView> {
    const companyId = this.requireTenant(principal);
    await this.requireConnection(companyId, connectionId);
    const mapping: VendorWarehouseMappingView = await withErrorMapping(
      () =>
        this.repo.create(
          { companyId, actorId: principal.userId },
          { connectionId, externalVendorId: data.externalVendorId, warehouseId: data.warehouseId },
        ),
      (error) => this.mapError(error),
    );
    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "storefront_vendor_warehouse_mapping.created",
      entityType: "storefront_vendor_warehouse_mapping",
      entityId: mapping.id,
      changes: {
        connectionId,
        externalVendorId: mapping.externalVendorId,
        warehouseId: mapping.warehouseId,
      },
    });
    return mapping;
  }

  async delete(principal: RequestPrincipal, connectionId: string, id: string): Promise<void> {
    const companyId = this.requireTenant(principal);
    await this.requireConnection(companyId, connectionId);
    const deleted = await this.repo.delete(companyId, connectionId, id);
    if (!deleted) throw AppErrors.notFound("Vendor mapping not found.");
    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "storefront_vendor_warehouse_mapping.deleted",
      entityType: "storefront_vendor_warehouse_mapping",
      entityId: id,
      changes: { connectionId },
    });
  }

  // ---- internals -----------------------------------------------------------

  private async requireConnection(companyId: string, connectionId: string): Promise<void> {
    const connection = await this.connections.findById(companyId, connectionId);
    if (connection === null) throw AppErrors.notFound("Connection not found.");
  }

  private requireTenant(principal: RequestPrincipal): string {
    if (principal.companyId === null) {
      throw AppErrors.forbidden("Select an active company first.");
    }
    return principal.companyId;
  }

  private mapError(error: unknown): unknown {
    if (error instanceof DuplicateVendorMappingError) {
      return AppErrors.conflict(error.message, [
        { field: "externalVendorId", messages: [error.message] },
      ]);
    }
    if (error instanceof WarehouseNotFoundError) {
      return AppErrors.unprocessable(error.message, [
        { field: "warehouseId", messages: [error.message] },
      ]);
    }
    return error;
  }
}

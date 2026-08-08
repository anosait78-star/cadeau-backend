import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppErrors, AppException } from "../../../shared/errors/app-exception";
import { EVENT_BUS, type EventBusPort } from "../../../shared/events/event-bus.port";
import { CLOCK, type Clock } from "../../../shared/time/clock";
import {
  IMPORT_MAX_ROWS,
  mapImport,
  MissingMappedColumnError,
  parseCsv,
  type ImportMapping,
} from "../domain/csv-import";
import { parseProductListQuery, type RawProductListQuery } from "../domain/list-query";
import type {
  ProductVariantView,
  ProductView,
  ProductWithVariants,
} from "../domain/product.entity";
import { PRODUCTS_AUDIT, type ProductsAuditPort } from "../domain/products-audit.port";
import {
  PRODUCTS_REPOSITORY,
  type CreateProductInput,
  type CreateVariantInput,
  type ProductsRepositoryPort,
  type UpdateProductInput,
  type UpdateVariantInput,
} from "../domain/products-repository.port";
import {
  DuplicateProductError,
  InvalidListCursorError,
  ReferenceNotFoundError,
} from "../domain/products.errors";

/** One row's outcome in a CSV import (atomic per row). */
export interface ImportResult {
  readonly row: number;
  readonly ok: boolean;
  readonly productId?: string;
  readonly error?: { code: string; message: string };
}

/**
 * Orchestrates the products module (EPIC-8). It enforces the tenant scope
 * (every product operation requires an active company), delegates persistence
 * to the repository, and on every write records a durable audit row and emits
 * the matching `product.*` domain event. Access is gated by the controller's
 * `@RequireCapability`; this service assumes an authorized caller.
 */
@Injectable()
export class ProductsService {
  constructor(
    @Inject(PRODUCTS_REPOSITORY) private readonly repo: ProductsRepositoryPort,
    @Inject(PRODUCTS_AUDIT) private readonly audit: ProductsAuditPort,
    @Inject(EVENT_BUS) private readonly events: EventBusPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(
    principal: RequestPrincipal,
    rawQuery: RawProductListQuery,
  ): Promise<KeysetPage<ProductView>> {
    const companyId = this.requireTenant(principal);
    const { query, errors } = parseProductListQuery(rawQuery);
    if (query === undefined) {
      throw AppErrors.validation("Request validation failed", errors);
    }
    try {
      return await this.repo.list(companyId, query);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async getOne(principal: RequestPrincipal, id: string): Promise<ProductWithVariants> {
    const companyId = this.requireTenant(principal);
    const product = await this.repo.findById(companyId, id);
    if (product === null) throw AppErrors.notFound("Product not found.");
    return product;
  }

  async create(principal: RequestPrincipal, data: CreateProductInput): Promise<ProductView> {
    const companyId = this.requireTenant(principal);
    let row: ProductView;
    try {
      row = await this.repo.create({ companyId, actorId: principal.userId }, data);
    } catch (error) {
      throw this.mapError(error);
    }
    await this.auditProduct(companyId, principal.userId, "product.created", row);
    await this.emitProduct(companyId, principal.userId, "product.created", row.id);
    return row;
  }

  async update(
    principal: RequestPrincipal,
    id: string,
    data: UpdateProductInput,
  ): Promise<ProductView> {
    const companyId = this.requireTenant(principal);
    let row: ProductView | null;
    try {
      row = await this.repo.update({ companyId, actorId: principal.userId }, id, data);
    } catch (error) {
      throw this.mapError(error);
    }
    if (row === null) throw AppErrors.notFound("Product not found.");
    await this.auditProduct(companyId, principal.userId, "product.updated", row);
    await this.emitProduct(companyId, principal.userId, "product.updated", row.id);
    return row;
  }

  async archive(principal: RequestPrincipal, id: string): Promise<void> {
    const companyId = this.requireTenant(principal);
    const row = await this.repo.archive({ companyId, actorId: principal.userId }, id);
    if (row === null) throw AppErrors.notFound("Product not found.");
    await this.auditProduct(companyId, principal.userId, "product.archived", row);
    await this.emitProduct(companyId, principal.userId, "product.archived", row.id);
  }

  async listVariants(
    principal: RequestPrincipal,
    productId: string,
  ): Promise<readonly ProductVariantView[]> {
    const companyId = this.requireTenant(principal);
    const variants = await this.repo.listVariants(companyId, productId);
    if (variants === null) throw AppErrors.notFound("Product not found.");
    return variants;
  }

  async createVariant(
    principal: RequestPrincipal,
    productId: string,
    data: CreateVariantInput,
  ): Promise<ProductVariantView> {
    const companyId = this.requireTenant(principal);
    let variant: ProductVariantView | null;
    try {
      variant = await this.repo.createVariant(
        { companyId, actorId: principal.userId },
        productId,
        data,
      );
    } catch (error) {
      throw this.mapError(error);
    }
    if (variant === null) throw AppErrors.notFound("Product not found.");
    await this.auditVariant(companyId, principal.userId, "product.variant_created", variant);
    await this.emitProduct(companyId, principal.userId, "product.updated", productId);
    return variant;
  }

  async updateVariant(
    principal: RequestPrincipal,
    productId: string,
    variantId: string,
    data: UpdateVariantInput,
  ): Promise<ProductVariantView> {
    const companyId = this.requireTenant(principal);
    let variant: ProductVariantView | null;
    try {
      variant = await this.repo.updateVariant(
        { companyId, actorId: principal.userId },
        productId,
        variantId,
        data,
      );
    } catch (error) {
      throw this.mapError(error);
    }
    if (variant === null) throw AppErrors.notFound("Variant not found.");
    await this.auditVariant(companyId, principal.userId, "product.variant_updated", variant);
    await this.emitProduct(companyId, principal.userId, "product.updated", productId);
    return variant;
  }

  /**
   * Find an active variant by its exact `sku` within the tenant. Used by the
   * storefront-integration module to resolve an ingested order line's `sku`
   * to a `variantId` without duplicating any lookup logic (storefront-
   * integration §D4).
   */
  async findVariantBySku(
    principal: RequestPrincipal,
    sku: string,
  ): Promise<ProductVariantView | null> {
    const companyId = this.requireTenant(principal);
    return this.repo.findVariantBySku(companyId, sku);
  }

  /**
   * Import products from CSV with an explicit column mapping. Each mapped row
   * becomes one product (atomic per row); when `sku`/`barcode` is mapped it also
   * becomes that product's first variant. One bad row never fails the others.
   * Capped at {@link IMPORT_MAX_ROWS}.
   */
  async importProducts(
    principal: RequestPrincipal,
    csv: string,
    mapping: ImportMapping,
  ): Promise<{ results: ImportResult[] }> {
    this.requireTenant(principal);
    let mapped: ReturnType<typeof mapImport>;
    try {
      mapped = mapImport(parseCsv(csv), mapping);
    } catch (error) {
      if (error instanceof MissingMappedColumnError) {
        throw AppErrors.badRequest(error.message);
      }
      if (error instanceof RangeError) {
        throw AppErrors.badRequest(error.message);
      }
      throw error;
    }
    const { rows, errors } = mapped;
    if (rows.length > IMPORT_MAX_ROWS) {
      throw AppErrors.badRequest(`Import exceeds the ${IMPORT_MAX_ROWS}-row limit.`);
    }

    const results: ImportResult[] = errors.map((e) => ({
      row: e.row,
      ok: false,
      error: { code: "UNPROCESSABLE_ENTITY", message: e.message },
    }));

    for (const row of rows) {
      let productId: string | undefined;
      try {
        const product = await this.create(principal, {
          name: row.name,
          description: row.description,
          categoryId: row.categoryId,
          unitId: row.unitId,
        });
        productId = product.id;
        if (row.sku !== null || row.barcode !== null) {
          await this.createVariant(principal, product.id, {
            name: row.name,
            sku: row.sku,
            barcode: row.barcode,
          });
        }
        results.push({ row: row.row, ok: true, productId: product.id });
      } catch (error) {
        if (productId !== undefined) {
          // The product was created but its variant failed: don't leave an orphan.
          await this.archive(principal, productId).catch(() => undefined);
        }
        results.push({ row: row.row, ok: false, error: this.toImportError(error) });
      }
    }
    results.sort((a, b) => a.row - b.row);
    return { results };
  }

  // ---- internals -----------------------------------------------------------

  /** Render an import row failure into a stable code/message pair (no throw). */
  private toImportError(error: unknown): { code: string; message: string } {
    if (error instanceof AppException) {
      const payload = error.getResponse() as { code?: string; message?: string };
      return {
        code: payload.code ?? "UNPROCESSABLE_ENTITY",
        message: payload.message ?? "The product could not be created.",
      };
    }
    return { code: "INTERNAL", message: "The product could not be created." };
  }

  private async auditProduct(
    companyId: string,
    actorId: string,
    action: "product.created" | "product.updated" | "product.archived",
    row: ProductView,
  ): Promise<void> {
    await this.audit.record({
      companyId,
      actorId,
      action,
      entityType: "product",
      entityId: row.id,
      changes: row,
    });
  }

  private async auditVariant(
    companyId: string,
    actorId: string,
    action: "product.variant_created" | "product.variant_updated",
    row: ProductVariantView,
  ): Promise<void> {
    await this.audit.record({
      companyId,
      actorId,
      action,
      entityType: "product_variant",
      entityId: row.id,
      changes: row,
    });
  }

  private async emitProduct(
    companyId: string,
    actorId: string,
    type: "product.created" | "product.updated" | "product.archived",
    productId: string,
  ): Promise<void> {
    await this.events.publish({
      type,
      companyId,
      actorId,
      occurredAt: this.clock.now(),
      payload: { productId },
    });
  }

  private requireTenant(principal: RequestPrincipal): string {
    if (principal.companyId === null) {
      throw AppErrors.forbidden("Select an active company first.");
    }
    return principal.companyId;
  }

  private mapError(error: unknown): unknown {
    if (error instanceof DuplicateProductError) {
      return AppErrors.conflict(error.message, [{ field: error.field, messages: [error.message] }]);
    }
    if (error instanceof ReferenceNotFoundError) {
      return new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "UNPROCESSABLE_ENTITY",
        error.message,
        [{ field: error.field, messages: [error.message] }],
      );
    }
    if (error instanceof InvalidListCursorError) {
      return AppErrors.badRequest(error.message);
    }
    return error;
  }
}

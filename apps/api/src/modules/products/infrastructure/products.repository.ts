import { Inject, Injectable } from "@nestjs/common";
import {
  buildKeysetPage,
  clampLimit,
  type CursorValues,
  decodeCursor,
  InvalidCursorError,
  type KeysetPage,
  Prisma,
  type PrismaClient,
  setTenantContext,
  stampForCreate,
  stampForUpdate,
} from "@cadeau/database";
import type { ParsedProductListQuery } from "../domain/list-query";
import type {
  ProductVariantView,
  ProductView,
  ProductWithVariants,
} from "../domain/product.entity";
import type {
  CreateProductInput,
  CreateVariantInput,
  ProductsRepositoryPort,
  UpdateProductInput,
  UpdateVariantInput,
  WriteActor,
} from "../domain/products-repository.port";
import {
  DuplicateProductError,
  InvalidListCursorError,
  ReferenceNotFoundError,
} from "../domain/products.errors";
import { PRODUCTS_PRISMA_CLIENT } from "./prisma-client.provider";

/** A Prisma client or transaction client. */
type Tx = Prisma.TransactionClient;

/** A decoded keyset cursor: primary sort value + id tie-breaker. */
interface DecodedCursor {
  readonly p: string;
  readonly t: string;
}

const PRODUCT_SELECT = {
  id: true,
  name: true,
  description: true,
  categoryId: true,
  unitId: true,
  allowOversell: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const VARIANT_SELECT = {
  id: true,
  productId: true,
  name: true,
  sku: true,
  barcode: true,
  averageCost: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Prisma-backed products repository (EPIC-8). Every unit of work binds the
 * tenant under RLS (`setTenantContext`) — the app-layer half of the two-layer
 * isolation model — so both the WHERE clause and Postgres RLS agree on the
 * company. Tenant references (category, unit) are checked inside the same
 * transaction; RLS guarantees a found row belongs to this company.
 */
@Injectable()
export class ProductsRepository implements ProductsRepositoryPort {
  constructor(@Inject(PRODUCTS_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async list(companyId: string, query: ParsedProductListQuery): Promise<KeysetPage<ProductView>> {
    const limit = clampLimit(query.limit);
    const cursor = this.decode(query, query.cursor);
    const where = this.buildWhere(companyId, query, cursor);
    const orderBy = [{ [query.sort.field]: query.sort.dir }, { id: query.sort.dir }];
    const rows = await this.tenantTx(companyId, (tx) =>
      tx.product.findMany({ where, orderBy, take: limit + 1, select: PRODUCT_SELECT }),
    );
    const views = rows.map((r) => this.toProductView(r));
    return buildKeysetPage(views, limit, (view) => this.toCursor(query, view));
  }

  async findById(companyId: string, id: string): Promise<ProductWithVariants | null> {
    return this.tenantTx(companyId, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id, companyId },
        select: PRODUCT_SELECT,
      });
      if (product === null) return null;
      const variants = await tx.productVariant.findMany({
        where: { productId: id, companyId },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: VARIANT_SELECT,
      });
      return {
        ...this.toProductView(product),
        variants: variants.map((v) => this.toVariantView(v)),
      };
    });
  }

  async create(actor: WriteActor, data: CreateProductInput): Promise<ProductView> {
    return this.tenantTx(actor.companyId, async (tx) => {
      await this.assertProductRefs(tx, actor.companyId, data);
      try {
        const row = await tx.product.create({
          data: stampForCreate(
            actor,
            this.productWriteData(data),
          ) as Prisma.ProductUncheckedCreateInput,
          select: PRODUCT_SELECT,
        });
        return this.toProductView(row);
      } catch (error) {
        throw this.mapWriteError(error);
      }
    });
  }

  async update(
    actor: WriteActor,
    id: string,
    data: UpdateProductInput,
  ): Promise<ProductView | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      await this.assertProductRefs(tx, actor.companyId, data);
      const where = { id, companyId: actor.companyId };
      try {
        const { count } = await tx.product.updateMany({
          where,
          data: stampForUpdate(
            actor,
            this.productWriteData(data),
          ) as Prisma.ProductUncheckedUpdateManyInput,
        });
        if (count === 0) return null;
      } catch (error) {
        throw this.mapWriteError(error);
      }
      const row = await tx.product.findFirst({ where, select: PRODUCT_SELECT });
      return row === null ? null : this.toProductView(row);
    });
  }

  async archive(actor: WriteActor, id: string): Promise<ProductView | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const where = { id, companyId: actor.companyId };
      const { count } = await tx.product.updateMany({
        where,
        data: stampForUpdate(actor, { isActive: false }) as Prisma.ProductUncheckedUpdateManyInput,
      });
      if (count === 0) return null;
      const row = await tx.product.findFirst({ where, select: PRODUCT_SELECT });
      return row === null ? null : this.toProductView(row);
    });
  }

  async listVariants(
    companyId: string,
    productId: string,
  ): Promise<readonly ProductVariantView[] | null> {
    return this.tenantTx(companyId, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, companyId },
        select: { id: true },
      });
      if (product === null) return null;
      const variants = await tx.productVariant.findMany({
        where: { productId, companyId },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: VARIANT_SELECT,
      });
      return variants.map((v) => this.toVariantView(v));
    });
  }

  async createVariant(
    actor: WriteActor,
    productId: string,
    data: CreateVariantInput,
  ): Promise<ProductVariantView | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, companyId: actor.companyId },
        select: { id: true },
      });
      if (product === null) return null;
      try {
        const row = await tx.productVariant.create({
          data: stampForCreate(actor, {
            productId,
            name: data.name,
            sku: data.sku ?? null,
            barcode: data.barcode ?? null,
          }) as Prisma.ProductVariantUncheckedCreateInput,
          select: VARIANT_SELECT,
        });
        return this.toVariantView(row);
      } catch (error) {
        throw this.mapWriteError(error);
      }
    });
  }

  async updateVariant(
    actor: WriteActor,
    productId: string,
    variantId: string,
    data: UpdateVariantInput,
  ): Promise<ProductVariantView | null> {
    return this.tenantTx(actor.companyId, async (tx) => {
      const where = { id: variantId, productId, companyId: actor.companyId };
      const patch: Record<string, unknown> = {};
      if (data.name !== undefined) patch["name"] = data.name;
      if (data.sku !== undefined) patch["sku"] = data.sku;
      if (data.barcode !== undefined) patch["barcode"] = data.barcode;
      if (data.active !== undefined) patch["isActive"] = data.active;
      try {
        const { count } = await tx.productVariant.updateMany({
          where,
          data: stampForUpdate(actor, patch) as Prisma.ProductVariantUncheckedUpdateManyInput,
        });
        if (count === 0) return null;
      } catch (error) {
        throw this.mapWriteError(error);
      }
      const row = await tx.productVariant.findFirst({ where, select: VARIANT_SELECT });
      return row === null ? null : this.toVariantView(row);
    });
  }

  // ---- internals -----------------------------------------------------------

  /** Run a unit of work with the tenant RLS context bound for its duration. */
  private tenantTx<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx);
    });
  }

  private productWriteData(data: CreateProductInput | UpdateProductInput): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if ("name" in data && data.name !== undefined) out["name"] = data.name;
    if ("description" in data && data.description !== undefined)
      out["description"] = data.description;
    if ("categoryId" in data && data.categoryId !== undefined) out["categoryId"] = data.categoryId;
    if ("unitId" in data && data.unitId !== undefined) out["unitId"] = data.unitId;
    if ("allowOversell" in data && data.allowOversell !== undefined)
      out["allowOversell"] = data.allowOversell;
    return out;
  }

  private toProductView(row: {
    id: string;
    name: string;
    description: string | null;
    categoryId: string | null;
    unitId: string | null;
    allowOversell: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ProductView {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      categoryId: row.categoryId,
      unitId: row.unitId,
      allowOversell: row.allowOversell,
      active: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toVariantView(row: {
    id: string;
    productId: string;
    name: string;
    sku: string | null;
    barcode: string | null;
    averageCost: bigint;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ProductVariantView {
    return {
      id: row.id,
      productId: row.productId,
      name: row.name,
      sku: row.sku,
      barcode: row.barcode,
      averageCost: Number(row.averageCost),
      active: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private buildWhere(
    companyId: string,
    query: ParsedProductListQuery,
    cursor: DecodedCursor | null,
  ): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = { companyId };
    if (query.active !== "all") where.isActive = query.active;
    if (query.categoryId !== undefined) where.categoryId = query.categoryId;
    // EPIC-9: "in stock" means some variant has a level with units left to sell.
    if (query.hasStock) {
      where.variants = { some: { stock: { some: { available: { gt: 0 } } } } };
    }
    if (query.q !== undefined) {
      where.OR = [
        { name: { contains: query.q, mode: "insensitive" } },
        { variants: { some: { sku: { contains: query.q, mode: "insensitive" } } } },
        { variants: { some: { barcode: { contains: query.q, mode: "insensitive" } } } },
      ];
    }
    if (cursor !== null) {
      where.AND = [this.keysetPredicate(query, cursor)];
    }
    return where;
  }

  private keysetPredicate(
    query: ParsedProductListQuery,
    cursor: DecodedCursor,
  ): Prisma.ProductWhereInput {
    const primary = query.sort.field;
    const op = query.sort.dir === "asc" ? "gt" : "lt";
    const primaryValue: string | Date = primary === "createdAt" ? new Date(cursor.p) : cursor.p;
    return {
      OR: [
        { [primary]: { [op]: primaryValue } },
        { AND: [{ [primary]: primaryValue }, { id: { [op]: cursor.t } }] },
      ],
    } as Prisma.ProductWhereInput;
  }

  private toCursor(query: ParsedProductListQuery, view: ProductView): CursorValues {
    const p = query.sort.field === "createdAt" ? view.createdAt : view.name;
    return { p, t: view.id };
  }

  private decode(query: ParsedProductListQuery, raw: string | undefined): DecodedCursor | null {
    if (raw === undefined) return null;
    try {
      const decoded = decodeCursor(raw);
      const p = decoded["p"];
      const t = decoded["t"];
      if (typeof p !== "string" || typeof t !== "string") throw new InvalidListCursorError();
      if (query.sort.field === "createdAt" && Number.isNaN(Date.parse(p))) {
        throw new InvalidListCursorError();
      }
      return { p, t };
    } catch (error) {
      if (error instanceof InvalidCursorError) throw new InvalidListCursorError();
      throw error;
    }
  }

  /**
   * Confirm each provided category/unit reference exists under the current RLS
   * context; RLS guarantees it belongs to this company. Missing → a domain error
   * the service renders as `422`.
   */
  private async assertProductRefs(
    tx: Tx,
    companyId: string,
    data: CreateProductInput | UpdateProductInput,
  ): Promise<void> {
    if ("categoryId" in data && data.categoryId !== null && data.categoryId !== undefined) {
      const found = await tx.productCategory.findFirst({
        where: { id: data.categoryId, companyId },
        select: { id: true },
      });
      if (found === null) throw new ReferenceNotFoundError("categoryId");
    }
    if ("unitId" in data && data.unitId !== null && data.unitId !== undefined) {
      const found = await tx.unit.findFirst({
        where: { id: data.unitId, companyId },
        select: { id: true },
      });
      if (found === null) throw new ReferenceNotFoundError("unitId");
    }
  }

  /** Map a Prisma unique-violation to the right duplicate-field domain error. */
  private mapWriteError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.["target"] ?? "");
      if (target.includes("sku")) return new DuplicateProductError("sku");
      if (target.includes("barcode")) return new DuplicateProductError("barcode");
      return new DuplicateProductError("name");
    }
    return error;
  }
}

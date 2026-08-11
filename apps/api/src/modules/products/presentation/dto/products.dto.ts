import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Min,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import type { KeysetPage } from "@cadeau/database";
import type { ImportResult } from "../../application/products.service";
import type {
  ProductVariantView,
  ProductView,
  ProductWithVariants,
} from "../../domain/product.entity";

// ---- Request DTOs ----------------------------------------------------------

/** Create-product payload. `averageCost` and variants are never set here. */
export class CreateProductDto {
  @ApiProperty({ example: "Classic Mug", maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true, description: "product_categories id." })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true, description: "units id." })
  @IsOptional()
  @IsUUID()
  unitId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: "Display image URL." })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  imageUrl?: string | null;

  @ApiPropertyOptional({
    description: "Oversell policy (EPIC-9): allow reservations beyond available stock.",
  })
  @IsOptional()
  @IsBoolean()
  allowOversell?: boolean;
}

/** Update-product payload (partial). Omit a field to leave it unchanged; send `null` to clear. */
export class UpdateProductDto {
  @ApiPropertyOptional({ example: "Classic Mug", maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  unitId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: "Display image URL." })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  imageUrl?: string | null;

  @ApiPropertyOptional({ description: "Oversell policy (EPIC-9)." })
  @IsOptional()
  @IsBoolean()
  allowOversell?: boolean;
}

/** Create-variant payload. `averageCost` is derived (EPIC-13), never set here. */
export class CreateVariantDto {
  @ApiProperty({ example: "Red / Large", maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sku?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  barcode?: string | null;

  @ApiPropertyOptional({
    example: 15000,
    description: "Sellable price, integer minor units. Distinct from averageCost.",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sellingPriceMinor?: number;
}

/** Update-variant payload (partial). */
export class UpdateVariantDto {
  @ApiPropertyOptional({ example: "Red / Large", maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sku?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  barcode?: string | null;

  @ApiPropertyOptional({
    example: 15000,
    description: "Sellable price, integer minor units. Distinct from averageCost.",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sellingPriceMinor?: number;
}

/** The column mapping for a CSV import (values are header column names). */
export class ProductImportMappingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
  @ApiPropertyOptional({ description: "product_categories id column." })
  @IsOptional()
  @IsString()
  categoryId?: string;
  @ApiPropertyOptional({ description: "units id column." })
  @IsOptional()
  @IsString()
  unitId?: string;
  @ApiPropertyOptional({ description: "When mapped, also creates the product's first variant." })
  @IsOptional()
  @IsString()
  sku?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  barcode?: string;
}

/** CSV import payload: the raw CSV and how its columns map to product fields. */
export class ImportProductsDto {
  @ApiProperty({ maxLength: 1_000_000, description: "Raw CSV text (Excel/Sheets export)." })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1_000_000)
  csv!: string;

  @ApiProperty({ type: ProductImportMappingDto })
  @ValidateNested()
  @Type(() => ProductImportMappingDto)
  mapping!: ProductImportMappingDto;
}

// ---- Response DTOs ---------------------------------------------------------

/** A catalog product (list/summary form). */
export class ProductDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "Classic Mug" })
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ format: "uuid", nullable: true })
  categoryId!: string | null;

  @ApiProperty({ format: "uuid", nullable: true })
  unitId!: string | null;

  @ApiProperty({ nullable: true, description: "Display image URL." })
  imageUrl!: string | null;

  @ApiProperty({ description: "Oversell policy (EPIC-9); false means stock-bound." })
  allowOversell!: boolean;

  @ApiProperty({ description: "Soft-delete flag; false means archived." })
  active!: boolean;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: ProductView): ProductDto {
    const dto = new ProductDto();
    dto.id = view.id;
    dto.name = view.name;
    dto.description = view.description;
    dto.categoryId = view.categoryId;
    dto.unitId = view.unitId;
    dto.imageUrl = view.imageUrl;
    dto.allowOversell = view.allowOversell;
    dto.active = view.active;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

/** A product variant. `averageCost` is integer minor units (read-only). */
export class ProductVariantDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  productId!: string;

  @ApiProperty({ example: "Red / Large" })
  name!: string;

  @ApiProperty({ nullable: true })
  sku!: string | null;

  @ApiProperty({ nullable: true })
  barcode!: string | null;

  @ApiProperty({ example: 0, description: "Moving-average cost, integer minor units (read-only)." })
  averageCost!: number;

  @ApiProperty({ example: 15000, description: "Sellable price, integer minor units." })
  sellingPriceMinor!: number;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: ProductVariantView): ProductVariantDto {
    const dto = new ProductVariantDto();
    dto.id = view.id;
    dto.productId = view.productId;
    dto.name = view.name;
    dto.sku = view.sku;
    dto.barcode = view.barcode;
    dto.averageCost = view.averageCost;
    dto.sellingPriceMinor = view.sellingPriceMinor;
    dto.active = view.active;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

/** A product with its variants (the detail view). */
export class ProductDetailDto extends ProductDto {
  @ApiProperty({ type: [ProductVariantDto] })
  variants!: ProductVariantDto[];

  static fromDetail(view: ProductWithVariants): ProductDetailDto {
    const dto = new ProductDetailDto();
    dto.id = view.id;
    dto.name = view.name;
    dto.description = view.description;
    dto.categoryId = view.categoryId;
    dto.unitId = view.unitId;
    dto.imageUrl = view.imageUrl;
    dto.allowOversell = view.allowOversell;
    dto.active = view.active;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    dto.variants = view.variants.map((v) => ProductVariantDto.from(v));
    return dto;
  }
}

/** Keyset page metadata (api-conventions §5). */
export class ProductPageDto {
  @ApiProperty({ example: 25 })
  limit!: number;

  @ApiProperty({ nullable: true, description: "Opaque cursor for the next page, or null." })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

/** Keyset-paginated products envelope. */
export class ProductListDto {
  @ApiProperty({ type: [ProductDto] })
  data!: ProductDto[];

  @ApiProperty({ type: ProductPageDto })
  page!: ProductPageDto;

  static from(page: KeysetPage<ProductView>): ProductListDto {
    const dto = new ProductListDto();
    dto.data = page.data.map((p) => ProductDto.from(p));
    dto.page = {
      limit: page.page.limit,
      nextCursor: page.page.nextCursor,
      hasMore: page.page.hasMore,
    };
    return dto;
  }
}

/** A variants collection (raw list — variants of one product). */
export class VariantListDto {
  @ApiProperty({ type: [ProductVariantDto] })
  data!: ProductVariantDto[];

  static from(views: readonly ProductVariantView[]): VariantListDto {
    const dto = new VariantListDto();
    dto.data = views.map((v) => ProductVariantDto.from(v));
    return dto;
  }
}

/** One row's outcome in a CSV import. */
export class ProductImportResultItemDto {
  @ApiProperty({ example: 3, description: "1-based data-row number." })
  row!: number;
  @ApiProperty()
  ok!: boolean;
  @ApiPropertyOptional({ format: "uuid" })
  productId?: string;
  @ApiPropertyOptional()
  error?: { code: string; message: string };

  static from(result: ImportResult): ProductImportResultItemDto {
    const dto = new ProductImportResultItemDto();
    dto.row = result.row;
    dto.ok = result.ok;
    if (result.productId !== undefined) dto.productId = result.productId;
    if (result.error !== undefined) dto.error = result.error;
    return dto;
  }
}

/** The import envelope: one result per data row (created or errored). */
export class ProductImportResultDto {
  @ApiProperty({ type: [ProductImportResultItemDto] })
  results!: ProductImportResultItemDto[];

  static from(results: readonly ImportResult[]): ProductImportResultDto {
    const dto = new ProductImportResultDto();
    dto.results = results.map((r) => ProductImportResultItemDto.from(r));
    return dto;
  }
}

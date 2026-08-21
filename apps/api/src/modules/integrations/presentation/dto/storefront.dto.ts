import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { KeysetPage } from "@cadeau/database";
import type {
  StorefrontConnectionView,
  StorefrontConnectionWithSecret,
  StorefrontWebhookEventView,
} from "../../domain/storefront-connection.entity";
import { STOREFRONT_PLATFORMS } from "../../domain/storefront-connection.entity";
import type {
  IngestResult,
  VendorSyncResult,
} from "../../application/storefront-ingestion.service";
import type { VendorWarehouseMappingView } from "../../domain/vendor-warehouse-mapping.entity";

// ---- Management request DTOs ------------------------------------------------

export class CreateConnectionDto {
  @ApiProperty({ example: "Main Salla Store", maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  @ApiPropertyOptional({ enum: STOREFRONT_PLATFORMS, default: "generic" })
  @IsOptional()
  @IsIn(STOREFRONT_PLATFORMS)
  platform?: (typeof STOREFRONT_PLATFORMS)[number];

  @ApiPropertyOptional({ format: "uuid", nullable: true, description: "warehouses id." })
  @IsOptional()
  @IsUUID()
  defaultWarehouseId?: string | null;

  @ApiPropertyOptional({
    maxLength: 500,
    description:
      "Optional platform webhook signing secret (e.g. WooCommerce's webhook secret). " +
      "Stored encrypted, never returned by any read endpoint. Verified as a " +
      "supplementary check alongside the API key — never a replacement for it.",
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  webhookSecret?: string;
}

export class UpdateConnectionDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  defaultWarehouseId?: string | null;

  @ApiPropertyOptional({ enum: ["active", "paused"] })
  @IsOptional()
  @IsIn(["active", "paused"])
  status?: "active" | "paused";

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 500,
    description: "Set/replace the webhook signing secret; pass `null` to clear it.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  webhookSecret?: string | null;
}

// ---- Management response DTOs -----------------------------------------------

export class StorefrontConnectionDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ enum: STOREFRONT_PLATFORMS })
  platform!: string;

  @ApiProperty({ description: "Non-secret display prefix of the API key." })
  apiKeyPrefix!: string;

  @ApiProperty({ format: "uuid", nullable: true })
  defaultWarehouseId!: string | null;

  @ApiProperty({ enum: ["active", "paused", "revoked"] })
  status!: string;

  @ApiProperty({ format: "date-time", nullable: true })
  lastEventAt!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: StorefrontConnectionView): StorefrontConnectionDto {
    const dto = new StorefrontConnectionDto();
    dto.id = view.id;
    dto.label = view.label;
    dto.platform = view.platform;
    dto.apiKeyPrefix = view.apiKeyPrefix;
    dto.defaultWarehouseId = view.defaultWarehouseId;
    dto.status = view.status;
    dto.lastEventAt = view.lastEventAt;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

/** Returned exactly once — from create and rotate-key — carrying the plaintext key. */
export class StorefrontConnectionWithKeyDto extends StorefrontConnectionDto {
  @ApiProperty({ description: "Plaintext API key. Shown once — store it now." })
  apiKey!: string;

  static fromSecret(result: StorefrontConnectionWithSecret): StorefrontConnectionWithKeyDto {
    const dto = StorefrontConnectionDto.from(result.connection) as StorefrontConnectionWithKeyDto;
    dto.apiKey = result.apiKey;
    return dto;
  }
}

export class ConnectionListDto {
  @ApiProperty({ type: [StorefrontConnectionDto] })
  data!: StorefrontConnectionDto[];

  @ApiProperty()
  page!: { limit: number; nextCursor: string | null; hasMore: boolean };

  static from(page: KeysetPage<StorefrontConnectionView>): ConnectionListDto {
    const dto = new ConnectionListDto();
    dto.data = page.data.map((v) => StorefrontConnectionDto.from(v));
    dto.page = page.page;
    return dto;
  }
}

export class StorefrontWebhookEventDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ enum: ["order", "product"] })
  eventType!: string;

  @ApiProperty()
  externalId!: string;

  @ApiProperty({ enum: ["pending", "processed", "failed"] })
  status!: string;

  @ApiProperty({ nullable: true })
  error!: string | null;

  @ApiProperty({ format: "uuid", nullable: true })
  internalEntityId!: string | null;

  @ApiProperty()
  attemptCount!: number;

  @ApiProperty({ format: "date-time" })
  receivedAt!: string;

  @ApiProperty({ format: "date-time", nullable: true })
  processedAt!: string | null;

  static from(view: StorefrontWebhookEventView): StorefrontWebhookEventDto {
    const dto = new StorefrontWebhookEventDto();
    dto.id = view.id;
    dto.eventType = view.eventType;
    dto.externalId = view.externalId;
    dto.status = view.status;
    dto.error = view.error;
    dto.internalEntityId = view.internalEntityId;
    dto.attemptCount = view.attemptCount;
    dto.receivedAt = view.receivedAt;
    dto.processedAt = view.processedAt;
    return dto;
  }
}

export class WebhookEventListDto {
  @ApiProperty({ type: [StorefrontWebhookEventDto] })
  data!: StorefrontWebhookEventDto[];

  @ApiProperty()
  page!: { limit: number; nextCursor: string | null; hasMore: boolean };

  static from(page: KeysetPage<StorefrontWebhookEventView>): WebhookEventListDto {
    const dto = new WebhookEventListDto();
    dto.data = page.data.map((v) => StorefrontWebhookEventDto.from(v));
    dto.page = page.page;
    return dto;
  }
}

// ---- Ingestion request DTOs (the generic contract, §7) ----------------------

export class StorefrontOrderCustomerDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: "Any common form — normalized to E.164 server-side." })
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  email?: string | null;
}

export class StorefrontOrderItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sku!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ description: "Integer minor units." })
  @IsInt()
  @Min(0)
  unitPriceMinor!: number;
}

export class IngestOrderDto {
  @ApiProperty({ description: "The store's own order id — idempotency key." })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  externalId!: string;

  @ApiProperty({ format: "date-time" })
  @IsISO8601()
  placedAt!: string;

  @ApiProperty({ type: StorefrontOrderCustomerDto })
  @ValidateNested()
  @Type(() => StorefrontOrderCustomerDto)
  customer!: StorefrontOrderCustomerDto;

  @ApiProperty({ type: [StorefrontOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StorefrontOrderItemDto)
  items!: StorefrontOrderItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class IngestProductDto {
  @ApiProperty({ description: "The store's own product id — idempotency key." })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  externalId!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  sku!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @IsOptional()
  @IsString()
  barcode?: string | null;

  @ApiProperty({ description: "Integer minor units. Maps to sellingPriceMinor." })
  @IsInt()
  @Min(0)
  priceMinor!: number;

  @ApiProperty({ description: "Absolute on-hand quantity." })
  @IsInt()
  @Min(0)
  stockQuantity!: number;

  @ApiPropertyOptional()
  @IsOptional()
  active?: boolean;
}

export class IngestResultDto {
  @ApiProperty({ format: "uuid" })
  entityId!: string;

  @ApiProperty({ enum: ["created", "updated", "duplicate"] })
  status!: "created" | "updated" | "duplicate";

  static from(result: IngestResult): IngestResultDto {
    const dto = new IngestResultDto();
    dto.entityId = result.entityId;
    dto.status = result.status;
    return dto;
  }
}

// ---- Vendor auto-registration (webhook, self-service parity, 2026-08-21) ---

export class IngestVendorDto {
  @ApiProperty({
    description:
      "The vendor's id as the platform reports it (WooCommerce/WCFM: WordPress user id).",
    maxLength: 200,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  externalVendorId!: string;

  @ApiProperty({ description: "The vendor's store name — used to name their warehouse." })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  vendorName!: string;
}

export class VendorSyncResultDto {
  @ApiProperty()
  externalVendorId!: string;

  @ApiProperty({ format: "uuid" })
  warehouseId!: string;

  @ApiProperty({
    enum: ["created", "existing"],
    description: "`existing` when this vendor already had a mapping (idempotent replay).",
  })
  status!: "created" | "existing";

  static from(result: VendorSyncResult): VendorSyncResultDto {
    const dto = new VendorSyncResultDto();
    dto.externalVendorId = result.externalVendorId;
    dto.warehouseId = result.warehouseId;
    dto.status = result.status;
    return dto;
  }
}

// ---- Vendor -> warehouse mapping (multi-vendor discovery, 2026-08-10) -------

export class CreateVendorWarehouseMappingDto {
  @ApiProperty({
    description:
      "The vendor's id as the platform reports it (WooCommerce/WCFM: WordPress user id).",
    maxLength: 200,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  externalVendorId!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  warehouseId!: string;
}

export class VendorWarehouseMappingDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  connectionId!: string;

  @ApiProperty()
  externalVendorId!: string;

  @ApiProperty({ format: "uuid" })
  warehouseId!: string;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: VendorWarehouseMappingView): VendorWarehouseMappingDto {
    const dto = new VendorWarehouseMappingDto();
    dto.id = view.id;
    dto.connectionId = view.connectionId;
    dto.externalVendorId = view.externalVendorId;
    dto.warehouseId = view.warehouseId;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

export class VendorWarehouseMappingListDto {
  @ApiProperty({ type: [VendorWarehouseMappingDto] })
  data!: VendorWarehouseMappingDto[];

  @ApiProperty()
  page!: { limit: number; nextCursor: string | null; hasMore: boolean };

  static from(page: KeysetPage<VendorWarehouseMappingView>): VendorWarehouseMappingListDto {
    const dto = new VendorWarehouseMappingListDto();
    dto.data = page.data.map((v) => VendorWarehouseMappingDto.from(v));
    dto.page = page.page;
    return dto;
  }
}

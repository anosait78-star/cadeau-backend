import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import type { KeysetPage } from "@cadeau/database";
import {
  ADJUSTMENT_REASONS,
  type AdjustmentReason,
  type AdjustmentView,
  type ReservationView,
  type StockLevelView,
  type TransferView,
  type WarehouseView,
} from "../../domain/inventory.entity";

// ---- Request DTOs ----------------------------------------------------------

/** Create-warehouse payload. */
export class CreateWarehouseDto {
  @ApiProperty({ example: "Main warehouse", maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 60, description: "Unique per company." })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ description: "Make this the company's default location." })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/** Update-warehouse payload (partial). Omit a field to leave it unchanged. */
export class UpdateWarehouseDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: "Soft-delete flag; false means archived." })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** Reserve-stock payload. Quantities are whole units. */
export class CreateReservationDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ format: "uuid", description: "product_variants id." })
  @IsUUID()
  variantId!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ format: "uuid", nullable: true, description: "Backing order (EPIC-11)." })
  @IsOptional()
  @IsUUID()
  orderId?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string | null;
}

/** Transfer-stock payload. The two warehouses must differ. */
export class CreateTransferDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  fromWarehouseId!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  toWarehouseId!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  variantId!: string;

  @ApiProperty({ example: 5, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

/** Adjust-stock payload. `quantityDelta` is signed and never zero. */
export class CreateAdjustmentDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  variantId!: string;

  @ApiProperty({ example: -3, description: "Signed unit delta; positive raises on-hand." })
  @IsInt()
  @IsNotIn([0])
  quantityDelta!: number;

  @ApiProperty({ enum: ADJUSTMENT_REASONS, example: "count" })
  @IsIn([...ADJUSTMENT_REASONS])
  reason!: AdjustmentReason;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

/**
 * Assign a variant to a warehouse without a quantity claim: ensures a
 * zero-value stock row in `warehouseId` and drops the variant's other
 * already-empty (zero on-hand, zero committed) rows. Use `POST /transfers`
 * first when the old warehouse still holds real quantity.
 */
export class SetVariantWarehouseDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  variantId!: string;
}

/** Set the low-stock threshold for one (warehouse, variant) level. */
export class SetReorderPointDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  variantId!: string;

  @ApiProperty({ example: 10, minimum: 0 })
  @IsInt()
  @Min(0)
  reorderPoint!: number;
}

// ---- Response DTOs ---------------------------------------------------------

/** A stock location. */
export class WarehouseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "Main warehouse" })
  name!: string;

  @ApiProperty({ nullable: true })
  code!: string | null;

  @ApiProperty({ nullable: true })
  address!: string | null;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty({ description: "Soft-delete flag; false means archived." })
  active!: boolean;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: WarehouseView): WarehouseDto {
    const dto = new WarehouseDto();
    dto.id = view.id;
    dto.name = view.name;
    dto.code = view.code;
    dto.address = view.address;
    dto.isDefault = view.isDefault;
    dto.active = view.active;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

/** A stock level for one (warehouse, variant) pair. */
export class StockLevelDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  warehouseId!: string;

  @ApiProperty({ format: "uuid" })
  variantId!: string;

  @ApiProperty({ example: 40 })
  onHand!: number;

  @ApiProperty({ example: 5, description: "Reserved but not yet shipped." })
  committed!: number;

  @ApiProperty({ example: 35, description: "Derived: onHand - committed (read-only)." })
  available!: number;

  @ApiProperty({ example: 10, description: "Low-stock threshold; 0 means no alert." })
  reorderPoint!: number;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: StockLevelView): StockLevelDto {
    const dto = new StockLevelDto();
    dto.id = view.id;
    dto.warehouseId = view.warehouseId;
    dto.variantId = view.variantId;
    dto.onHand = view.onHand;
    dto.committed = view.committed;
    dto.available = view.available;
    dto.reorderPoint = view.reorderPoint;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

/** A stock reservation. */
export class ReservationDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  warehouseId!: string;

  @ApiProperty({ format: "uuid" })
  variantId!: string;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({ format: "uuid", nullable: true })
  orderId!: string | null;

  @ApiProperty({ nullable: true })
  reference!: string | null;

  @ApiProperty({ enum: ["active", "released"] })
  status!: "active" | "released";

  @ApiProperty({ format: "date-time", nullable: true })
  releasedAt!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  static from(view: ReservationView): ReservationDto {
    const dto = new ReservationDto();
    dto.id = view.id;
    dto.warehouseId = view.warehouseId;
    dto.variantId = view.variantId;
    dto.quantity = view.quantity;
    dto.orderId = view.orderId;
    dto.reference = view.reference;
    dto.status = view.status;
    dto.releasedAt = view.releasedAt;
    dto.createdAt = view.createdAt;
    return dto;
  }
}

/** A completed stock transfer. */
export class TransferDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  fromWarehouseId!: string;

  @ApiProperty({ format: "uuid" })
  toWarehouseId!: string;

  @ApiProperty({ format: "uuid" })
  variantId!: string;

  @ApiProperty({ example: 5 })
  quantity!: number;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  static from(view: TransferView): TransferDto {
    const dto = new TransferDto();
    dto.id = view.id;
    dto.fromWarehouseId = view.fromWarehouseId;
    dto.toWarehouseId = view.toWarehouseId;
    dto.variantId = view.variantId;
    dto.quantity = view.quantity;
    dto.note = view.note;
    dto.createdAt = view.createdAt;
    return dto;
  }
}

/** A completed stock adjustment. */
export class AdjustmentDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  warehouseId!: string;

  @ApiProperty({ format: "uuid" })
  variantId!: string;

  @ApiProperty({ example: -3 })
  quantityDelta!: number;

  @ApiProperty({ enum: ADJUSTMENT_REASONS })
  reason!: AdjustmentReason;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  static from(view: AdjustmentView): AdjustmentDto {
    const dto = new AdjustmentDto();
    dto.id = view.id;
    dto.warehouseId = view.warehouseId;
    dto.variantId = view.variantId;
    dto.quantityDelta = view.quantityDelta;
    dto.reason = view.reason;
    dto.note = view.note;
    dto.createdAt = view.createdAt;
    return dto;
  }
}

/** Keyset page metadata (api-conventions §5). */
export class InventoryPageDto {
  @ApiProperty({ example: 25 })
  limit!: number;

  @ApiProperty({ nullable: true, description: "Opaque cursor for the next page, or null." })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

/** Keyset-paginated warehouses envelope. */
export class WarehouseListDto {
  @ApiProperty({ type: [WarehouseDto] })
  data!: WarehouseDto[];

  @ApiProperty({ type: InventoryPageDto })
  page!: InventoryPageDto;

  static from(page: KeysetPage<WarehouseView>): WarehouseListDto {
    const dto = new WarehouseListDto();
    dto.data = page.data.map((w) => WarehouseDto.from(w));
    dto.page = {
      limit: page.page.limit,
      nextCursor: page.page.nextCursor,
      hasMore: page.page.hasMore,
    };
    return dto;
  }
}

/** Keyset-paginated stock levels envelope. */
export class StockListDto {
  @ApiProperty({ type: [StockLevelDto] })
  data!: StockLevelDto[];

  @ApiProperty({ type: InventoryPageDto })
  page!: InventoryPageDto;

  static from(page: KeysetPage<StockLevelView>): StockListDto {
    const dto = new StockListDto();
    dto.data = page.data.map((s) => StockLevelDto.from(s));
    dto.page = {
      limit: page.page.limit,
      nextCursor: page.page.nextCursor,
      hasMore: page.page.hasMore,
    };
    return dto;
  }
}

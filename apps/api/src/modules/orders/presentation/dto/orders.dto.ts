import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import type { KeysetPage } from "@cadeau/database";
import type { ImportResult } from "../../application/orders.service";
import type { ParsedDraft, ParsedItem } from "../../domain/smart-paste";
import type {
  BulkItemResult,
  OrderActivityView,
  OrderItemView,
  OrderListView,
  OrderVendorGroupItemView,
  OrderVendorGroupView,
  OrderView,
} from "../../domain/order.entity";
import {
  FOLLOW_UP_STATES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type FollowUpState,
  type OrderStatus,
  type PaymentStatus,
} from "../../domain/order-status";
import {
  aggregateVendorOrderStatus,
  VENDOR_GROUP_STATUSES,
  type VendorGroupStatus,
} from "../../domain/vendor-group-status";

/** The most orders one bulk request may touch. */
export const BULK_MAX = 200;

// ---- Request DTOs ----------------------------------------------------------

/** A single line on a create/update order payload. */
export class OrderItemInputDto {
  @ApiProperty({ format: "uuid", description: "product_variants id." })
  @IsUUID()
  variantId!: string;

  @ApiProperty({ example: 2, minimum: 1, description: "Whole units." })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ example: 15000, minimum: 0, description: "Unit sell price, integer minor units." })
  @IsInt()
  @Min(0)
  price!: number;
}

/** Create-order payload. */
export class CreateOrderDto {
  @ApiProperty({ format: "uuid", description: "customers id." })
  @IsUUID()
  customerId!: string;

  @ApiPropertyOptional({ format: "uuid", nullable: true, description: "warehouses id." })
  @IsOptional()
  @IsUUID()
  warehouseId?: string | null;

  @ApiPropertyOptional({
    format: "uuid",
    nullable: true,
    description: "Assignee (member) user id.",
  })
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true, description: "order_labels id." })
  @IsOptional()
  @IsUUID()
  labelId?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true, description: "order_reasons id." })
  @IsOptional()
  @IsUUID()
  reasonId?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true, description: "governorates id." })
  @IsOptional()
  @IsUUID()
  governorateId?: string | null;

  @ApiPropertyOptional({ enum: FOLLOW_UP_STATES, default: "none" })
  @IsOptional()
  @IsIn(FOLLOW_UP_STATES)
  followUpState?: FollowUpState;

  @ApiPropertyOptional({ example: 5000, minimum: 0, description: "Integer minor units." })
  @IsOptional()
  @IsInt()
  @Min(0)
  shippingFee?: number;

  @ApiPropertyOptional({ example: 0, minimum: 0, description: "Integer minor units." })
  @IsOptional()
  @IsInt()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({ enum: PAYMENT_STATUSES, default: "unpaid" })
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional({
    example: 0,
    minimum: 0,
    description: "COD amount collected at create time, integer minor units.",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  collectedAmount?: number;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiProperty({ type: [OrderItemInputDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[];
}

/** Update-order payload (partial). Items, when present, replace the line set. */
export class UpdateOrderDto {
  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  labelId?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  reasonId?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  governorateId?: string | null;

  @ApiPropertyOptional({ enum: FOLLOW_UP_STATES })
  @IsOptional()
  @IsIn(FOLLOW_UP_STATES)
  followUpState?: FollowUpState;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  shippingFee?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({ minimum: 0, description: "COD amount collected, integer minor units." })
  @IsOptional()
  @IsInt()
  @Min(0)
  collectedAmount?: number;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ type: [OrderItemInputDto], minItems: 1 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items?: OrderItemInputDto[];
}

/** Status-transition payload. `reasonId` is required when transitioning to cancelled. */
export class TransitionOrderDto {
  @ApiProperty({ enum: ORDER_STATUSES })
  @IsIn(ORDER_STATUSES)
  toStatus!: OrderStatus;

  @ApiPropertyOptional({ format: "uuid", nullable: true, description: "Required for cancel." })
  @IsOptional()
  @IsUUID()
  reasonId?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

/**
 * Vendor group status-transition payload (Vendor Accounts, Phase 3). One step
 * forward only (`new → processing → ready → delivered`) — no reason, no note,
 * unlike the Parent Order's own transition.
 */
export class UpdateVendorGroupStatusDto {
  @ApiProperty({ enum: VENDOR_GROUP_STATUSES })
  @IsIn(VENDOR_GROUP_STATUSES)
  toStatus!: VendorGroupStatus;
}

/** Assign payload. `assigneeId: null` unassigns. */
export class AssignOrderDto {
  @ApiProperty({
    format: "uuid",
    nullable: true,
    description: "Member user id, or null to unassign.",
  })
  @IsOptional()
  @IsUUID()
  assigneeId!: string | null;
}

/** Bulk status-transition payload. */
export class BulkStatusDto {
  @ApiProperty({ type: [String], format: "uuid", minItems: 1, maxItems: BULK_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAX)
  @IsUUID("4", { each: true })
  orderIds!: string[];

  @ApiProperty({ enum: ORDER_STATUSES })
  @IsIn(ORDER_STATUSES)
  toStatus!: OrderStatus;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  reasonId?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

/** Bulk assign payload. */
export class BulkAssignDto {
  @ApiProperty({ type: [String], format: "uuid", minItems: 1, maxItems: BULK_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAX)
  @IsUUID("4", { each: true })
  orderIds!: string[];

  @ApiProperty({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  assigneeId!: string | null;
}

/** Smart-paste payload — the raw pasted text to parse (deterministic, no AI). */
export class ParseOrderDto {
  @ApiProperty({ maxLength: 5000, description: "Pasted text (chat message, note)." })
  @IsString()
  @MaxLength(5000)
  text!: string;
}

/** The column mapping for a CSV import (values are header column names). */
export class ImportMappingDto {
  @ApiProperty()
  @IsString()
  customerId!: string;
  @ApiProperty()
  @IsString()
  variantId!: string;
  @ApiProperty()
  @IsString()
  quantity!: string;
  @ApiProperty()
  @IsString()
  price!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shippingFee?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  discount?: string;
}

/** CSV import payload: the raw CSV and how its columns map to order fields. */
export class ImportOrdersDto {
  @ApiProperty({ maxLength: 1_000_000, description: "Raw CSV text (Excel/Sheets export)." })
  @IsString()
  @MaxLength(1_000_000)
  csv!: string;

  @ApiProperty({ type: ImportMappingDto })
  @ValidateNested()
  @Type(() => ImportMappingDto)
  mapping!: ImportMappingDto;
}

// ---- Response DTOs ---------------------------------------------------------

/** The money block; all integer minor units. `total = subtotal + shippingFee − discount`. */
class OrderMoneyFields {
  @ApiProperty({ example: 30000 })
  subtotal!: number;
  @ApiProperty({ example: 5000 })
  shippingFee!: number;
  @ApiProperty({ example: 0 })
  discount!: number;
  @ApiProperty({ example: 35000 })
  total!: number;
  @ApiProperty({ example: 0, description: "COD money collected." })
  collectedAmount!: number;
  @ApiProperty({ enum: ["unpaid", "partial", "paid"] })
  paymentStatus!: string;
}

/** An order line. */
export class OrderItemDto {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty({ format: "uuid" })
  variantId!: string;
  @ApiProperty({ example: "T-Shirt — Red / L" })
  nameSnapshot!: string;
  @ApiProperty({ example: 2 })
  quantity!: number;
  @ApiProperty({ example: 15000 })
  price!: number;
  @ApiProperty({ example: 8000, description: "Cost snapshot at add time (COGS)." })
  costSnapshot!: number;

  static from(view: OrderItemView): OrderItemDto {
    const dto = new OrderItemDto();
    dto.id = view.id;
    dto.variantId = view.variantId;
    dto.nameSnapshot = view.nameSnapshot;
    dto.quantity = view.quantity;
    dto.price = view.price;
    dto.costSnapshot = view.costSnapshot;
    return dto;
  }
}

/** An order as a list row (no items). */
export class OrderListItemDto extends OrderMoneyFields {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty({ example: 1042 })
  orderNumber!: number;
  @ApiProperty({ format: "uuid" })
  customerId!: string;
  @ApiProperty({ example: "Sara Ali" })
  customerName!: string;
  @ApiProperty({ format: "uuid", nullable: true })
  assigneeId!: string | null;
  @ApiProperty({ enum: ORDER_STATUSES })
  status!: string;
  @ApiProperty({ enum: FOLLOW_UP_STATES })
  followUpState!: string;
  @ApiProperty({ format: "uuid", nullable: true })
  labelId!: string | null;
  @ApiProperty({ format: "uuid", nullable: true })
  reasonId!: string | null;
  @ApiProperty({ format: "uuid", nullable: true })
  governorateId!: string | null;
  @ApiProperty({ format: "uuid", nullable: true })
  warehouseId!: string | null;
  @ApiProperty({ example: 3 })
  itemCount!: number;
  @ApiProperty({ format: "date-time" })
  statusChangedAt!: string;
  @ApiProperty({ format: "date-time" })
  createdAt!: string;
  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  protected static assignList<T extends OrderListItemDto>(dto: T, view: OrderListView): T {
    dto.id = view.id;
    dto.orderNumber = view.orderNumber;
    dto.customerId = view.customerId;
    dto.customerName = view.customerName;
    dto.assigneeId = view.assigneeId;
    dto.status = view.status;
    dto.followUpState = view.followUpState;
    dto.labelId = view.labelId;
    dto.reasonId = view.reasonId;
    dto.governorateId = view.governorateId;
    dto.warehouseId = view.warehouseId;
    dto.itemCount = view.itemCount;
    dto.subtotal = view.subtotal;
    dto.shippingFee = view.shippingFee;
    dto.discount = view.discount;
    dto.total = view.total;
    dto.collectedAmount = view.collectedAmount;
    dto.paymentStatus = view.paymentStatus;
    dto.statusChangedAt = view.statusChangedAt;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }

  static from(view: OrderListView): OrderListItemDto {
    return OrderListItemDto.assignList(new OrderListItemDto(), view);
  }
}

/** An order with its items and notes (the detail read). */
export class OrderDto extends OrderListItemDto {
  @ApiProperty({ nullable: true })
  notes!: string | null;

  @ApiProperty({ type: [OrderItemDto] })
  items!: OrderItemDto[];

  static fromDetail(view: OrderView): OrderDto {
    const dto = OrderListItemDto.assignList(new OrderDto(), view);
    dto.notes = view.notes;
    dto.items = view.items.map((i) => OrderItemDto.from(i));
    return dto;
  }
}

/** Keyset page metadata (api-conventions §5). */
export class OrderPageDto {
  @ApiProperty({ example: 25 })
  limit!: number;
  @ApiProperty({ nullable: true })
  nextCursor!: string | null;
  @ApiProperty()
  hasMore!: boolean;
}

/** Keyset-paginated orders envelope. */
export class OrderListDto {
  @ApiProperty({ type: [OrderListItemDto] })
  data!: OrderListItemDto[];
  @ApiProperty({ type: OrderPageDto })
  page!: OrderPageDto;

  static from(page: KeysetPage<OrderListView>): OrderListDto {
    const dto = new OrderListDto();
    dto.data = page.data.map((o) => OrderListItemDto.from(o));
    dto.page = {
      limit: page.page.limit,
      nextCursor: page.page.nextCursor,
      hasMore: page.page.hasMore,
    };
    return dto;
  }
}

/** Per-status counts for the status tabs. */
export class OrderStatusCountsDto {
  @ApiProperty({
    example: { new: 3, processing: 5, completed: 12 },
    description: "One key per status, value = count under the current filters.",
  })
  counts!: Record<string, number>;

  static from(counts: Record<OrderStatus, number>): OrderStatusCountsDto {
    const dto = new OrderStatusCountsDto();
    dto.counts = counts;
    return dto;
  }
}

/** One row of the activity log. */
export class OrderActivityDto {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty({ example: "status_changed" })
  kind!: string;
  @ApiProperty({ nullable: true })
  fromValue!: string | null;
  @ApiProperty({ nullable: true })
  toValue!: string | null;
  @ApiProperty({ nullable: true })
  note!: string | null;
  @ApiProperty({ format: "uuid", nullable: true })
  actorId!: string | null;
  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  static from(view: OrderActivityView): OrderActivityDto {
    const dto = new OrderActivityDto();
    dto.id = view.id;
    dto.kind = view.kind;
    dto.fromValue = view.fromValue;
    dto.toValue = view.toValue;
    dto.note = view.note;
    dto.actorId = view.actorId;
    dto.createdAt = view.createdAt;
    return dto;
  }
}

/** Keyset-paginated activity envelope. */
export class OrderActivityListDto {
  @ApiProperty({ type: [OrderActivityDto] })
  data!: OrderActivityDto[];
  @ApiProperty({ type: OrderPageDto })
  page!: OrderPageDto;

  static from(page: KeysetPage<OrderActivityView>): OrderActivityListDto {
    const dto = new OrderActivityListDto();
    dto.data = page.data.map((a) => OrderActivityDto.from(a));
    dto.page = {
      limit: page.page.limit,
      nextCursor: page.page.nextCursor,
      hasMore: page.page.hasMore,
    };
    return dto;
  }
}

/** One item within a vendor group — no `costSnapshot` (Vendor Accounts, Phase 2). */
export class OrderVendorGroupItemDto {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty({ format: "uuid" })
  variantId!: string;
  @ApiProperty({ example: "T-Shirt — Red / L" })
  nameSnapshot!: string;
  @ApiProperty({ example: 2 })
  quantity!: number;
  @ApiProperty({ example: 15000 })
  price!: number;
  @ApiProperty({ nullable: true, description: "The product's display image, or null." })
  imageUrl!: string | null;

  static from(view: OrderVendorGroupItemView): OrderVendorGroupItemDto {
    const dto = new OrderVendorGroupItemDto();
    dto.id = view.id;
    dto.variantId = view.variantId;
    dto.nameSnapshot = view.nameSnapshot;
    dto.quantity = view.quantity;
    dto.price = view.price;
    dto.imageUrl = view.imageUrl;
    return dto;
  }
}

/**
 * A vendor's slice of one order (Vendor Accounts, Phase 2) — the items routed
 * to one warehouse, that warehouse's display info, and the vendor member's
 * identity if one has joined. `status` is reserved for a later phase.
 */
export class OrderVendorGroupDto {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty({ format: "uuid" })
  orderId!: string;
  @ApiProperty({ example: 1042 })
  orderNumber!: number;
  @ApiProperty({ format: "uuid" })
  warehouseId!: string;
  @ApiProperty({ example: "Main warehouse" })
  warehouseName!: string;
  @ApiProperty({ nullable: true })
  warehouseCode!: string | null;
  @ApiProperty({ format: "uuid", nullable: true })
  vendorMemberId!: string | null;
  @ApiProperty({
    nullable: true,
    description: "The vendor's name/email, or null if none has joined this warehouse yet.",
  })
  vendorName!: string | null;
  @ApiProperty({ example: "new" })
  status!: string;
  @ApiProperty({ format: "date-time", description: "When status (or the group) last changed." })
  updatedAt!: string;
  @ApiProperty({ type: [OrderVendorGroupItemDto] })
  items!: OrderVendorGroupItemDto[];

  static from(view: OrderVendorGroupView): OrderVendorGroupDto {
    const dto = new OrderVendorGroupDto();
    dto.id = view.id;
    dto.orderId = view.orderId;
    dto.orderNumber = view.orderNumber;
    dto.warehouseId = view.warehouseId;
    dto.warehouseName = view.warehouseName;
    dto.warehouseCode = view.warehouseCode;
    dto.vendorMemberId = view.vendorMemberId;
    dto.vendorName = view.vendorName;
    dto.status = view.status;
    dto.updatedAt = view.updatedAt;
    dto.items = view.items.map((i) => OrderVendorGroupItemDto.from(i));
    return dto;
  }
}

/** Envelope for an order's vendor groups. */
export class OrderVendorGroupListDto {
  @ApiProperty({ type: [OrderVendorGroupDto] })
  data!: OrderVendorGroupDto[];

  @ApiProperty({
    enum: VENDOR_GROUP_STATUSES,
    nullable: true,
    description:
      "Computed, read-only summary across every group (Vendor Accounts, Phase 8) — the " +
      "LEAST advanced status among them, since the order isn't really done until every " +
      "vendor is. Never persisted, never affects the Parent Order's own status. Null when " +
      "the order has no vendor groups (not multi-vendor).",
  })
  aggregateStatus!: VendorGroupStatus | null;

  static from(groups: readonly OrderVendorGroupView[]): OrderVendorGroupListDto {
    const dto = new OrderVendorGroupListDto();
    dto.data = groups.map((g) => OrderVendorGroupDto.from(g));
    dto.aggregateStatus = aggregateVendorOrderStatus(groups);
    return dto;
  }
}

/** One item's outcome in a bulk operation. */
export class BulkResultItemDto {
  @ApiProperty({ format: "uuid" })
  orderId!: string;
  @ApiProperty()
  ok!: boolean;
  @ApiPropertyOptional({ description: "Present when ok is false." })
  error?: { code: string; message: string };

  static from(result: BulkItemResult): BulkResultItemDto {
    const dto = new BulkResultItemDto();
    dto.orderId = result.orderId;
    dto.ok = result.ok;
    if (result.error !== undefined) dto.error = result.error;
    return dto;
  }
}

/** The bulk envelope: one result per requested order. */
export class BulkResultDto {
  @ApiProperty({ type: [BulkResultItemDto] })
  results!: BulkResultItemDto[];

  static from(results: readonly BulkItemResult[]): BulkResultDto {
    const dto = new BulkResultDto();
    dto.results = results.map((r) => BulkResultItemDto.from(r));
    return dto;
  }
}

/** A parsed order line (smart-paste). */
export class ParsedItemDto {
  @ApiProperty()
  name!: string;
  @ApiProperty({ example: 2 })
  quantity!: number;

  static from(item: ParsedItem): ParsedItemDto {
    const dto = new ParsedItemDto();
    dto.name = item.name;
    dto.quantity = item.quantity;
    return dto;
  }
}

/** The structured draft a paste resolves to (all fields best-effort). */
export class ParsedDraftDto {
  @ApiProperty({ nullable: true })
  name!: string | null;
  @ApiProperty({ nullable: true, description: "Normalized E.164, or null." })
  phone!: string | null;
  @ApiProperty({ nullable: true })
  address!: string | null;
  @ApiProperty({ type: [ParsedItemDto] })
  items!: ParsedItemDto[];
  @ApiProperty({ nullable: true, description: "Unclassified lines, nothing dropped." })
  notes!: string | null;

  static from(draft: ParsedDraft): ParsedDraftDto {
    const dto = new ParsedDraftDto();
    dto.name = draft.name;
    dto.phone = draft.phone;
    dto.address = draft.address;
    dto.items = draft.items.map((i) => ParsedItemDto.from(i));
    dto.notes = draft.notes;
    return dto;
  }
}

/** One row's outcome in a CSV import. */
export class ImportResultItemDto {
  @ApiProperty({ example: 3, description: "1-based data-row number." })
  row!: number;
  @ApiProperty()
  ok!: boolean;
  @ApiPropertyOptional({ format: "uuid" })
  orderId?: string;
  @ApiPropertyOptional()
  error?: { code: string; message: string };

  static from(result: ImportResult): ImportResultItemDto {
    const dto = new ImportResultItemDto();
    dto.row = result.row;
    dto.ok = result.ok;
    if (result.orderId !== undefined) dto.orderId = result.orderId;
    if (result.error !== undefined) dto.error = result.error;
    return dto;
  }
}

/** The import envelope: one result per data row (created or errored). */
export class ImportResultDto {
  @ApiProperty({ type: [ImportResultItemDto] })
  results!: ImportResultItemDto[];

  static from(results: readonly ImportResult[]): ImportResultDto {
    const dto = new ImportResultDto();
    dto.results = results.map((r) => ImportResultItemDto.from(r));
    return dto;
  }
}

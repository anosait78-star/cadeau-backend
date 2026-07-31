import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";
import type { BulkShipmentResult, ShipmentView } from "../../domain/shipment.entity";
import { SHIPMENT_STATUSES, type ShipmentStatus } from "../../domain/shipment-status";

/** The most orders one bulk request may touch (matches orders' BULK_MAX). */
export const BULK_MAX = 200;

// ---- Request DTOs ----------------------------------------------------------

/** Create-shipment payload. */
export class CreateShipmentDto {
  @ApiProperty({ format: "uuid", description: "orders id." })
  @IsUUID()
  orderId!: string;
}

/** Bulk-create payload: one shipment per order id. */
export class BulkCreateShipmentDto {
  @ApiProperty({ type: [String], format: "uuid", minItems: 1, maxItems: BULK_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAX)
  @IsUUID("4", { each: true })
  orderIds!: string[];
}

/** Status-transition payload (also used to cancel: `toStatus: "cancelled"`). */
export class TransitionShipmentDto {
  @ApiProperty({ enum: SHIPMENT_STATUSES })
  @IsIn(SHIPMENT_STATUSES)
  toStatus!: ShipmentStatus;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

// ---- Response DTOs ---------------------------------------------------------

/** A shipment (list and detail are the same shape). */
export class ShipmentDto {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty({ format: "uuid" })
  orderId!: string;
  @ApiProperty({ example: "manual" })
  carrier!: string;
  @ApiProperty({ example: "MAN-ABCDEF1234567890" })
  trackingNumber!: string;
  @ApiProperty({ enum: SHIPMENT_STATUSES })
  status!: string;
  @ApiProperty({
    example: 2500,
    description: "Integer minor units, deducted from collectedAmount at delivery.",
  })
  fee!: number;
  @ApiProperty({ description: "Metadata flag only (D3) — no PDF is rendered in this epic." })
  waybillIssued!: boolean;
  @ApiProperty({ format: "date-time", nullable: true })
  deliveredAt!: string | null;
  @ApiProperty({ format: "date-time" })
  createdAt!: string;
  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: ShipmentView): ShipmentDto {
    const dto = new ShipmentDto();
    dto.id = view.id;
    dto.orderId = view.orderId;
    dto.carrier = view.carrier;
    dto.trackingNumber = view.trackingNumber;
    dto.status = view.status;
    dto.fee = view.fee;
    dto.waybillIssued = view.waybillIssued;
    dto.deliveredAt = view.deliveredAt;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

/** An available carrier (behind the {@link CarrierPort} abstraction). */
export class CarrierDto {
  @ApiProperty({ example: "manual" })
  key!: string;
}

/** The list of available carriers. */
export class CarrierListDto {
  @ApiProperty({ type: [CarrierDto] })
  data!: CarrierDto[];

  static from(carriers: readonly { key: string }[]): CarrierListDto {
    const dto = new CarrierListDto();
    dto.data = carriers.map((c) => ({ key: c.key }));
    return dto;
  }
}

/** One item's outcome in a bulk operation. */
export class BulkShipmentResultItemDto {
  @ApiProperty({ format: "uuid" })
  orderId!: string;
  @ApiProperty()
  ok!: boolean;
  @ApiPropertyOptional({ format: "uuid" })
  shipmentId?: string;
  @ApiPropertyOptional({ description: "Present when ok is false." })
  error?: { code: string; message: string };

  static from(result: BulkShipmentResult): BulkShipmentResultItemDto {
    const dto = new BulkShipmentResultItemDto();
    dto.orderId = result.orderId;
    dto.ok = result.ok;
    if (result.shipmentId !== undefined) dto.shipmentId = result.shipmentId;
    if (result.error !== undefined) dto.error = result.error;
    return dto;
  }
}

/** The bulk envelope: one result per requested order. */
export class BulkShipmentResultDto {
  @ApiProperty({ type: [BulkShipmentResultItemDto] })
  results!: BulkShipmentResultItemDto[];

  static from(results: readonly BulkShipmentResult[]): BulkShipmentResultDto {
    const dto = new BulkShipmentResultDto();
    dto.results = results.map((r) => BulkShipmentResultItemDto.from(r));
    return dto;
  }
}

/** Waybill metadata only (decision D3) — no PDF body in this epic. */
export class WaybillDto {
  @ApiProperty({ format: "uuid" })
  shipmentId!: string;
  @ApiProperty({ example: "manual" })
  carrier!: string;
  @ApiProperty({ example: "MAN-ABCDEF1234567890" })
  trackingNumber!: string;

  static from(result: {
    shipment: ShipmentView;
    trackingNumber: string;
    carrier: string;
  }): WaybillDto {
    const dto = new WaybillDto();
    dto.shipmentId = result.shipment.id;
    dto.carrier = result.carrier;
    dto.trackingNumber = result.trackingNumber;
    return dto;
  }
}

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  MinLength,
} from "class-validator";
import type { BostaCityView, BostaDistrictView } from "../../domain/bosta-catalog.entity";
import type { CarrierConnectionView } from "../../domain/carrier-connection.entity";
import type { BulkShipmentResult, ShipmentView } from "../../domain/shipment.entity";
import { SHIPMENT_STATUSES, type ShipmentStatus } from "../../domain/shipment-status";

/** The most orders one bulk request may touch (matches orders' BULK_MAX). */
export const BULK_MAX = 200;

// ---- Request DTOs ----------------------------------------------------------

/** Connect-carrier payload: the raw API key (encrypted at rest, never echoed back). */
export class ConnectCarrierDto {
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(500)
  apiKey!: string;
}

/** Carrier keys the "select a carrier" step may choose from (mirrors `KNOWN_CARRIERS`). */
const CREATE_SHIPMENT_CARRIERS = ["manual", "bosta"] as const;

/** Create-shipment payload. */
export class CreateShipmentDto {
  @ApiProperty({ format: "uuid", description: "orders id." })
  @IsUUID()
  orderId!: string;

  @ApiPropertyOptional({
    enum: CREATE_SHIPMENT_CARRIERS,
    description:
      "The carrier chosen in the client's carrier-select step. Auto-detected when omitted.",
  })
  @IsOptional()
  @IsIn(CREATE_SHIPMENT_CARRIERS)
  carrier?: string;

  @ApiPropertyOptional({
    description:
      "Bosta city id chosen in the carrier-select step (replaces relying on the customer's saved address mapping).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bostaCityId?: string;

  @ApiPropertyOptional({ description: "Bosta city display name, matching bostaCityId." })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  bostaCityName?: string;

  @ApiPropertyOptional({ description: "Bosta district id chosen in the carrier-select step." })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bostaDistrictId?: string;

  @ApiPropertyOptional({
    description:
      "Street address to deliver to, entered in the carrier-select step (replaces relying on the customer's saved address).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  addressLine?: string;

  @ApiPropertyOptional({ description: "Optional landmark / second address line." })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  landmark?: string;

  @ApiPropertyOptional({ description: "Free-text note for the courier (e.g. package contents)." })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: "Declared goods value, integer minor units." })
  @IsOptional()
  @IsInt()
  @Min(0)
  goodsValue?: number;

  @ApiPropertyOptional({
    description: "Overrides the receiver's first name (defaults to the customer's own name).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  recipientFirstName?: string;

  @ApiPropertyOptional({
    description: "Overrides the receiver's last name (defaults to the customer's own name).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  recipientLastName?: string;

  @ApiPropertyOptional({ description: "A second contact number for the receiver." })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  recipientPhone2?: string;

  @ApiPropertyOptional({
    description: "Bosta-specific: lets the receiver open the package before accepting it.",
  })
  @IsOptional()
  @IsBoolean()
  allowToOpenPackage?: boolean;
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

/** An available carrier (behind the {@link CarrierPort} abstraction) + this tenant's connection state. */
export class CarrierDto {
  @ApiProperty({ example: "bosta" })
  key!: string;

  @ApiProperty({ description: "`manual` is always true; a real carrier reflects the connection." })
  connected!: boolean;

  @ApiProperty({ description: "True when connected but no pickup location is configured yet." })
  pickupLocationWarning!: boolean;

  @ApiProperty({ nullable: true, format: "date-time" })
  connectedAt!: string | null;
}

/** The list of available carriers. */
export class CarrierListDto {
  @ApiProperty({ type: [CarrierDto] })
  data!: CarrierDto[];

  static from(carriers: readonly CarrierConnectionView[]): CarrierListDto {
    const dto = new CarrierListDto();
    dto.data = carriers.map((c) => ({
      key: c.carrier,
      connected: c.connected,
      pickupLocationWarning: c.pickupLocationWarning,
      connectedAt: c.connectedAt,
    }));
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

/** A Bosta city (address-mapping picker, Phase C). */
export class BostaCityDto {
  @ApiProperty({ example: "FceDyHXwpSYYF9zGW" })
  id!: string;
  @ApiProperty({ example: "Cairo" })
  name!: string;
  @ApiProperty({ nullable: true, example: "القاهرة" })
  nameAr!: string | null;

  static from(view: BostaCityView): BostaCityDto {
    const dto = new BostaCityDto();
    dto.id = view.id;
    dto.name = view.name;
    dto.nameAr = view.nameAr;
    return dto;
  }
}

/** A list of Bosta cities. */
export class BostaCityListDto {
  @ApiProperty({ type: [BostaCityDto] })
  data!: BostaCityDto[];

  static from(views: readonly BostaCityView[]): BostaCityListDto {
    const dto = new BostaCityListDto();
    dto.data = views.map((v) => BostaCityDto.from(v));
    return dto;
  }
}

/** A Bosta district within a city (address-mapping picker, Phase C). */
export class BostaDistrictDto {
  @ApiProperty({ example: "wY_JL43TilR" })
  districtId!: string;
  @ApiProperty({ example: "1st Settlement - District 10" })
  districtName!: string;
  @ApiProperty({ example: "g3jl3V8FMN" })
  zoneId!: string;
  @ApiProperty({ example: "New Cairo" })
  zoneName!: string;

  static from(view: BostaDistrictView): BostaDistrictDto {
    const dto = new BostaDistrictDto();
    dto.districtId = view.districtId;
    dto.districtName = view.districtName;
    dto.zoneId = view.zoneId;
    dto.zoneName = view.zoneName;
    return dto;
  }
}

/** A list of Bosta districts. */
export class BostaDistrictListDto {
  @ApiProperty({ type: [BostaDistrictDto] })
  data!: BostaDistrictDto[];

  static from(views: readonly BostaDistrictView[]): BostaDistrictListDto {
    const dto = new BostaDistrictListDto();
    dto.data = views.map((v) => BostaDistrictDto.from(v));
    return dto;
  }
}

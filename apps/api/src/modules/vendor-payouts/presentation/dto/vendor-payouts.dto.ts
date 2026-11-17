import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import type { KeysetPage } from "@cadeau/database";
import {
  PAYOUT_METHODS,
  type LedgerEntryKind,
  type LedgerEntryState,
  type LedgerEntryView,
  type PayoutConfirmationKind,
  type PayoutMethod,
  type PayoutStatus,
  type PayoutView,
  type VendorBalanceView,
} from "../../domain/vendor-payout.entity";

// ---- request bodies --------------------------------------------------------

/** Request a payout of everything owed (Idempotency-Key header mandatory). */
export class RequestPayoutDto {
  @ApiProperty({ enum: PAYOUT_METHODS, example: "instapay" })
  @IsIn(PAYOUT_METHODS)
  method!: PayoutMethod;

  @ApiPropertyOptional({ nullable: true, maxLength: 200, description: "Transfer reference." })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  reference?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  notes?: string | null;
}

/** Confirm a payout on the vendor's behalf. */
export class ForceConfirmPayoutDto {
  @ApiProperty({ minLength: 3, maxLength: 500, example: "التاجر أكد الاستلام تليفونيًا" })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

/** A manual correction on a vendor's account. */
export class CreateAdjustmentDto {
  @ApiProperty({
    example: -5000,
    description: "Signed, non-zero, integer minor units. Positive = the company owes more.",
  })
  @IsInt()
  amountMinor!: number;

  @ApiProperty({ minLength: 3, maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;
}

// ---- responses -------------------------------------------------------------

export class VendorBalanceDto {
  @ApiProperty({ format: "uuid" })
  warehouseId!: string;
  @ApiProperty()
  warehouseName!: string;
  @ApiProperty({ nullable: true })
  vendorName!: string | null;
  @ApiProperty({ description: "Owed now (open, priced rows), integer minor units." })
  owedMinor!: number;
  @ApiProperty({ description: "Held by the pending payout, integer minor units." })
  pendingMinor!: number;
  @ApiProperty({ description: "Sum of confirmed payouts, integer minor units." })
  paidMinor!: number;
  @ApiProperty({ description: "Open rows still waiting for a wholesale price." })
  needsPricingCount!: number;
  @ApiProperty({ nullable: true, format: "uuid" })
  pendingPayoutId!: string | null;

  static from(view: VendorBalanceView): VendorBalanceDto {
    return Object.assign(new VendorBalanceDto(), view);
  }
}

export class VendorBalanceListDto {
  @ApiProperty({ type: [VendorBalanceDto] })
  data!: VendorBalanceDto[];

  static from(views: readonly VendorBalanceView[]): VendorBalanceListDto {
    const dto = new VendorBalanceListDto();
    dto.data = views.map((v) => VendorBalanceDto.from(v));
    return dto;
  }
}

export class LedgerEntryDto {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty({ enum: ["accrual", "return_reversal", "adjustment"] })
  kind!: LedgerEntryKind;
  @ApiProperty({ nullable: true, format: "uuid" })
  orderId!: string | null;
  @ApiProperty({ nullable: true })
  orderNumber!: number | null;
  @ApiProperty({ nullable: true, format: "uuid" })
  variantId!: string | null;
  @ApiProperty({ nullable: true })
  nameSnapshot!: string | null;
  @ApiProperty({ nullable: true })
  quantity!: number | null;
  @ApiProperty({ nullable: true })
  unitCostMinor!: number | null;
  @ApiProperty({ description: "Signed, integer minor units." })
  amountMinor!: number;
  @ApiProperty()
  needsPricing!: boolean;
  @ApiProperty({ nullable: true, format: "uuid" })
  payoutId!: string | null;
  @ApiProperty({ enum: ["open", "pending", "settled"] })
  state!: LedgerEntryState;
  @ApiProperty({ nullable: true })
  note!: string | null;
  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  static from(view: LedgerEntryView): LedgerEntryDto {
    return Object.assign(new LedgerEntryDto(), view);
  }
}

export class PayoutDto {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty({ format: "uuid" })
  warehouseId!: string;
  @ApiProperty()
  warehouseName!: string;
  @ApiProperty({ description: "Integer minor units." })
  amountMinor!: number;
  @ApiProperty({ enum: PAYOUT_METHODS })
  method!: PayoutMethod;
  @ApiProperty({ nullable: true })
  reference!: string | null;
  @ApiProperty({ nullable: true })
  notes!: string | null;
  @ApiProperty({ enum: ["pending", "confirmed", "cancelled"] })
  status!: PayoutStatus;
  @ApiProperty({ nullable: true, enum: ["vendor", "forced"] })
  confirmationKind!: PayoutConfirmationKind | null;
  @ApiProperty({ nullable: true })
  forceReason!: string | null;
  @ApiProperty({ nullable: true, format: "date-time" })
  confirmedAt!: string | null;
  @ApiProperty({ nullable: true, format: "date-time" })
  cancelledAt!: string | null;
  @ApiProperty()
  entryCount!: number;
  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  static from(view: PayoutView): PayoutDto {
    return Object.assign(new PayoutDto(), view);
  }
}

export class PageMetaDto {
  @ApiProperty({ example: 25 })
  limit!: number;
  @ApiProperty({ nullable: true })
  nextCursor!: string | null;
  @ApiProperty()
  hasMore!: boolean;
}

export class LedgerPageDto {
  @ApiProperty({ type: [LedgerEntryDto] })
  data!: LedgerEntryDto[];
  @ApiProperty({ type: PageMetaDto })
  page!: PageMetaDto;

  static from(page: KeysetPage<LedgerEntryView>): LedgerPageDto {
    const dto = new LedgerPageDto();
    dto.data = page.data.map((v) => LedgerEntryDto.from(v));
    dto.page = { ...page.page };
    return dto;
  }
}

export class PayoutPageDto {
  @ApiProperty({ type: [PayoutDto] })
  data!: PayoutDto[];
  @ApiProperty({ type: PageMetaDto })
  page!: PageMetaDto;

  static from(page: KeysetPage<PayoutView>): PayoutPageDto {
    const dto = new PayoutPageDto();
    dto.data = page.data.map((v) => PayoutDto.from(v));
    dto.page = { ...page.page };
    return dto;
  }
}

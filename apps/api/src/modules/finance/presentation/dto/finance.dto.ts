import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { KeysetPage } from "@cadeau/database";
import {
  ACCOUNTING_PERIOD_STATUSES,
  PURCHASE_ORDER_STATUSES,
  type AccountingPeriodStatus,
  type AccountingPeriodView,
  type CashCenterReportView,
  type ExpenseView,
  type InvoiceLineView,
  type InvoiceListView,
  type InvoiceView,
  type PnlPeriodView,
  type PnlReportView,
  type PurchaseOrderLineView,
  type PurchaseOrderListView,
  type PurchaseOrderPaymentView,
  type PurchaseOrderReceiptView,
  type PurchaseOrderStatus,
  type PurchaseOrderView,
  type ReconciliationLineView,
  type ReconciliationListView,
  type ReconciliationView,
  type RefundView,
  type SupplierView,
  type TaxSettingsView,
} from "../../domain/finance.entity";

// ---- Request DTOs ------------------------------------------------------------

/** Create-supplier payload. */
export class CreateSupplierDto {
  @ApiProperty({ example: "Acme Trading", maxLength: 200 })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  address?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  taxId?: string | null;
}

/** Update-supplier payload (partial). Omit a field to leave it unchanged. */
export class UpdateSupplierDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  address?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  taxId?: string | null;

  @ApiPropertyOptional({ description: "Soft-delete flag; false means archived." })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** One requested line on a new purchase order. */
export class CreatePurchaseOrderLineDto {
  @ApiProperty({ format: "uuid", description: "product_variants id." })
  @IsUUID()
  variantId!: string;

  @ApiProperty({ example: 10, minimum: 1 })
  @IsInt()
  @Min(1)
  quantityOrdered!: number;

  @ApiProperty({ example: 1500, minimum: 0, description: "Integer minor units." })
  @IsInt()
  @Min(0)
  unitCost!: number;
}

/** Create-purchase-order payload (with lines). */
export class CreatePurchaseOrderDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  supplierId!: string;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  @IsOptional()
  @IsDateString()
  expectedDate?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiProperty({ type: [CreatePurchaseOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderLineDto)
  lines!: CreatePurchaseOrderLineDto[];
}

/** One line of an incoming receipt. */
export class ReceiptLineDto {
  @ApiProperty({ format: "uuid", description: "purchase_order_lines id." })
  @IsUUID()
  poLineId!: string;

  @ApiProperty({ example: 5, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

/** Record-a-receipt payload (atomic: raises stock, rolls averageCost). */
export class CreateReceiptDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsDateString()
  receivedAt?: string;

  @ApiProperty({ type: [ReceiptLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  lines!: ReceiptLineDto[];
}

/** Record-a-payment payload. */
export class CreatePaymentDto {
  @ApiProperty({ example: 50000, minimum: 1, description: "Integer minor units." })
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @ApiProperty({ example: "bank_transfer", maxLength: 60 })
  @IsString()
  @MinLength(1)
  method!: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsDateString()
  paidAt?: string;
}

/** Create-expense payload. */
export class CreateExpenseDto {
  @ApiProperty({ example: "office_supplies", maxLength: 100 })
  @IsString()
  @MinLength(1)
  category!: string;

  @ApiProperty({ example: 12500, minimum: 1, description: "Integer minor units." })
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @ApiProperty({ format: "date-time" })
  @IsDateString()
  incurredAt!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  supplierId?: string | null;
}

/** Update-expense payload (partial). Omit a field to leave it unchanged. */
export class UpdateExpenseDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  category?: string;

  @ApiPropertyOptional({ example: 12500, minimum: 1, description: "Integer minor units." })
  @IsOptional()
  @IsInt()
  @Min(1)
  amountMinor?: number;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsDateString()
  incurredAt?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  supplierId?: string | null;
}

/** Update-tax-settings payload (partial). Omit a field to leave it unchanged. */
export class UpdateTaxSettingsDto {
  @ApiPropertyOptional({
    example: 1400,
    minimum: 0,
    maximum: 10000,
    description: "Basis points, e.g. 1400 = 14%.",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  vatRateBps?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  vatRegistrationNumber?: string | null;
}

/** One manual line requested on a new invoice (the no-order path). */
export class CreateInvoiceLineDto {
  @ApiProperty({ example: "Consulting services", maxLength: 500 })
  @IsString()
  @MinLength(1)
  description!: string;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ example: 10000, minimum: 0, description: "Integer minor units." })
  @IsInt()
  @Min(0)
  unitPriceMinor!: number;
}

/**
 * Issue-an-invoice payload. Provide EITHER `orderId` (lines are derived
 * read-only from the order's items) OR a manual `lines[]` — never both.
 */
export class CreateInvoiceDto {
  @ApiPropertyOptional({ format: "uuid", description: "Invoice this order; lines are derived." })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ type: [CreateInvoiceLineDto], description: "A manual, no-order bill." })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceLineDto)
  lines?: CreateInvoiceLineDto[];
}

/** Issue-a-refund payload. At least one of `invoiceId`/`orderId` is required. */
export class CreateRefundDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiProperty({ example: 5000, minimum: 1, description: "Integer minor units." })
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @ApiProperty({ example: "Customer returned the item.", maxLength: 500 })
  @IsString()
  @MinLength(1)
  reason!: string;
}

/** One statement line to match against a shipment by tracking number. */
export class CreateReconciliationLineDto {
  @ApiProperty({ example: "TRK123456789" })
  @IsString()
  @MinLength(1)
  trackingNumber!: string;

  @ApiProperty({ example: 5000, minimum: 0, description: "Integer minor units." })
  @IsInt()
  @Min(0)
  statementAmountMinor!: number;
}

/** Create-reconciliation payload (atomic: matches every line to a shipment). */
export class CreateReconciliationDto {
  @ApiProperty({ example: "manual" })
  @IsString()
  @MinLength(1)
  carrier!: string;

  @ApiProperty({ example: "STMT-2026-01" })
  @IsString()
  @MinLength(1)
  statementRef!: string;

  @ApiProperty({ example: "2026-01", description: "YYYY-MM." })
  @Matches(/^\d{4}-\d{2}$/, { message: "periodKey must be formatted YYYY-MM" })
  periodKey!: string;

  @ApiProperty({ type: [CreateReconciliationLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateReconciliationLineDto)
  lines!: CreateReconciliationLineDto[];
}

// ---- Response DTOs -----------------------------------------------------------

/** A goods/services supplier. */
export class SupplierDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  address!: string | null;

  @ApiProperty({ nullable: true })
  taxId!: string | null;

  @ApiProperty({ description: "Soft-delete flag; false means archived." })
  active!: boolean;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: SupplierView): SupplierDto {
    const dto = new SupplierDto();
    dto.id = view.id;
    dto.name = view.name;
    dto.phone = view.phone;
    dto.email = view.email;
    dto.address = view.address;
    dto.taxId = view.taxId;
    dto.active = view.active;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

/** A line on a purchase order. */
export class PurchaseOrderLineDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  variantId!: string;

  @ApiProperty({ example: 10 })
  quantityOrdered!: number;

  @ApiProperty({ example: 4 })
  quantityReceived!: number;

  @ApiProperty({ example: 1500, description: "Integer minor units." })
  unitCost!: number;

  static from(view: PurchaseOrderLineView): PurchaseOrderLineDto {
    const dto = new PurchaseOrderLineDto();
    dto.id = view.id;
    dto.variantId = view.variantId;
    dto.quantityOrdered = view.quantityOrdered;
    dto.quantityReceived = view.quantityReceived;
    dto.unitCost = view.unitCost;
    return dto;
  }
}

/** A purchase order without its lines (list rendering). */
export class PurchaseOrderListDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: 1042 })
  number!: number;

  @ApiProperty({ format: "uuid" })
  supplierId!: string;

  @ApiProperty({ enum: PURCHASE_ORDER_STATUSES })
  status!: PurchaseOrderStatus;

  @ApiProperty({ format: "date-time", nullable: true })
  expectedDate!: string | null;

  @ApiProperty({ nullable: true })
  notes!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: PurchaseOrderListView): PurchaseOrderListDto {
    const dto = new PurchaseOrderListDto();
    dto.id = view.id;
    dto.number = view.number;
    dto.supplierId = view.supplierId;
    dto.status = view.status;
    dto.expectedDate = view.expectedDate;
    dto.notes = view.notes;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

/** A purchase order with its lines (detail rendering). */
export class PurchaseOrderDto extends PurchaseOrderListDto {
  @ApiProperty({ type: [PurchaseOrderLineDto] })
  lines!: PurchaseOrderLineDto[];

  static override from(view: PurchaseOrderView): PurchaseOrderDto {
    const dto = new PurchaseOrderDto();
    Object.assign(dto, PurchaseOrderListDto.from(view));
    dto.lines = view.lines.map((l) => PurchaseOrderLineDto.from(l));
    return dto;
  }
}

/** One line of a completed receipt. */
export class ReceiptLineResultDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  poLineId!: string;

  @ApiProperty({ example: 5 })
  quantity!: number;
}

/** A completed atomic receipt against a purchase order. */
export class PurchaseOrderReceiptDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  poId!: string;

  @ApiProperty({ format: "uuid" })
  warehouseId!: string;

  @ApiProperty({ format: "date-time" })
  receivedAt!: string;

  @ApiProperty({ type: [ReceiptLineResultDto] })
  lines!: ReceiptLineResultDto[];

  static from(view: PurchaseOrderReceiptView): PurchaseOrderReceiptDto {
    const dto = new PurchaseOrderReceiptDto();
    dto.id = view.id;
    dto.poId = view.poId;
    dto.warehouseId = view.warehouseId;
    dto.receivedAt = view.receivedAt;
    dto.lines = view.lines.map((l) => ({ id: l.id, poLineId: l.poLineId, quantity: l.quantity }));
    return dto;
  }
}

/** A completed (partial or full) payment against a purchase order. */
export class PurchaseOrderPaymentDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  poId!: string;

  @ApiProperty({ example: 50000, description: "Integer minor units." })
  amountMinor!: number;

  @ApiProperty({ example: "bank_transfer" })
  method!: string;

  @ApiProperty({ format: "date-time" })
  paidAt!: string;

  static from(view: PurchaseOrderPaymentView): PurchaseOrderPaymentDto {
    const dto = new PurchaseOrderPaymentDto();
    dto.id = view.id;
    dto.poId = view.poId;
    dto.amountMinor = view.amountMinor;
    dto.method = view.method;
    dto.paidAt = view.paidAt;
    return dto;
  }
}

/** Keyset page metadata (api-conventions §5). */
export class FinancePageDto {
  @ApiProperty({ example: 25 })
  limit!: number;

  @ApiProperty({ nullable: true, description: "Opaque cursor for the next page, or null." })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

/** Keyset-paginated suppliers envelope. */
export class SupplierListDto {
  @ApiProperty({ type: [SupplierDto] })
  data!: SupplierDto[];

  @ApiProperty({ type: FinancePageDto })
  page!: FinancePageDto;

  static from(page: KeysetPage<SupplierView>): SupplierListDto {
    const dto = new SupplierListDto();
    dto.data = page.data.map((s) => SupplierDto.from(s));
    dto.page = {
      limit: page.page.limit,
      nextCursor: page.page.nextCursor,
      hasMore: page.page.hasMore,
    };
    return dto;
  }
}

/** Keyset-paginated purchase orders envelope. */
export class PurchaseOrderListDtoPage {
  @ApiProperty({ type: [PurchaseOrderListDto] })
  data!: PurchaseOrderListDto[];

  @ApiProperty({ type: FinancePageDto })
  page!: FinancePageDto;

  static from(page: KeysetPage<PurchaseOrderListView>): PurchaseOrderListDtoPage {
    const dto = new PurchaseOrderListDtoPage();
    dto.data = page.data.map((p) => PurchaseOrderListDto.from(p));
    dto.page = {
      limit: page.page.limit,
      nextCursor: page.page.nextCursor,
      hasMore: page.page.hasMore,
    };
    return dto;
  }
}

/** A unified, categorized, dated expense. */
export class ExpenseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "office_supplies" })
  category!: string;

  @ApiProperty({ example: 12500, description: "Integer minor units." })
  amountMinor!: number;

  @ApiProperty({ format: "date-time" })
  incurredAt!: string;

  @ApiProperty({ nullable: true })
  notes!: string | null;

  @ApiProperty({ format: "uuid", nullable: true })
  supplierId!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: ExpenseView): ExpenseDto {
    const dto = new ExpenseDto();
    dto.id = view.id;
    dto.category = view.category;
    dto.amountMinor = view.amountMinor;
    dto.incurredAt = view.incurredAt;
    dto.notes = view.notes;
    dto.supplierId = view.supplierId;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

/** Keyset-paginated expenses envelope. */
export class ExpenseListDto {
  @ApiProperty({ type: [ExpenseDto] })
  data!: ExpenseDto[];

  @ApiProperty({ type: FinancePageDto })
  page!: FinancePageDto;

  static from(page: KeysetPage<ExpenseView>): ExpenseListDto {
    const dto = new ExpenseListDto();
    dto.data = page.data.map((e) => ExpenseDto.from(e));
    dto.page = {
      limit: page.page.limit,
      nextCursor: page.page.nextCursor,
      hasMore: page.page.hasMore,
    };
    return dto;
  }
}

/** The company's one configured VAT rate + registration number (D3). */
export class TaxSettingsDto {
  @ApiProperty({ format: "uuid" })
  companyId!: string;

  @ApiProperty({ example: 1400, description: "Basis points, e.g. 1400 = 14%." })
  vatRateBps!: number;

  @ApiProperty({ nullable: true })
  vatRegistrationNumber!: string | null;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: TaxSettingsView): TaxSettingsDto {
    const dto = new TaxSettingsDto();
    dto.companyId = view.companyId;
    dto.vatRateBps = view.vatRateBps;
    dto.vatRegistrationNumber = view.vatRegistrationNumber;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

/** A line item on an invoice. */
export class InvoiceLineDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ example: 1 })
  quantity!: number;

  @ApiProperty({ example: 10000, description: "Integer minor units." })
  unitPriceMinor!: number;

  @ApiProperty({ example: 10000, description: "Integer minor units." })
  lineTotalMinor!: number;

  static from(view: InvoiceLineView): InvoiceLineDto {
    const dto = new InvoiceLineDto();
    dto.id = view.id;
    dto.description = view.description;
    dto.quantity = view.quantity;
    dto.unitPriceMinor = view.unitPriceMinor;
    dto.lineTotalMinor = view.lineTotalMinor;
    return dto;
  }
}

/** An invoice without its lines (list rendering). */
export class InvoiceListDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: 1042 })
  number!: number;

  @ApiProperty({ format: "uuid", nullable: true })
  orderId!: string | null;

  @ApiProperty({ example: 100000, description: "Integer minor units." })
  subtotalMinor!: number;

  @ApiProperty({ example: 14000, description: "Integer minor units." })
  vatMinor!: number;

  @ApiProperty({ example: 114000, description: "Integer minor units." })
  totalMinor!: number;

  @ApiProperty({ example: 1400, description: "Basis points, frozen at issue time." })
  vatRateBpsSnapshot!: number;

  @ApiProperty({ format: "date-time", nullable: true })
  pdfGeneratedAt!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: InvoiceListView): InvoiceListDto {
    const dto = new InvoiceListDto();
    dto.id = view.id;
    dto.number = view.number;
    dto.orderId = view.orderId;
    dto.subtotalMinor = view.subtotalMinor;
    dto.vatMinor = view.vatMinor;
    dto.totalMinor = view.totalMinor;
    dto.vatRateBpsSnapshot = view.vatRateBpsSnapshot;
    dto.pdfGeneratedAt = view.pdfGeneratedAt;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

/** An invoice with its lines (detail rendering). */
export class InvoiceDto extends InvoiceListDto {
  @ApiProperty({ type: [InvoiceLineDto] })
  lines!: InvoiceLineDto[];

  static override from(view: InvoiceView): InvoiceDto {
    const dto = new InvoiceDto();
    Object.assign(dto, InvoiceListDto.from(view));
    dto.lines = view.lines.map((l) => InvoiceLineDto.from(l));
    return dto;
  }
}

/** Keyset-paginated invoices envelope. */
export class InvoiceListDtoPage {
  @ApiProperty({ type: [InvoiceListDto] })
  data!: InvoiceListDto[];

  @ApiProperty({ type: FinancePageDto })
  page!: FinancePageDto;

  static from(page: KeysetPage<InvoiceListView>): InvoiceListDtoPage {
    const dto = new InvoiceListDtoPage();
    dto.data = page.data.map((i) => InvoiceListDto.from(i));
    dto.page = {
      limit: page.page.limit,
      nextCursor: page.page.nextCursor,
      hasMore: page.page.hasMore,
    };
    return dto;
  }
}

/** Money out against a prior invoice and/or order. */
export class RefundDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid", nullable: true })
  invoiceId!: string | null;

  @ApiProperty({ format: "uuid", nullable: true })
  orderId!: string | null;

  @ApiProperty({ example: 5000, description: "Integer minor units." })
  amountMinor!: number;

  @ApiProperty({ example: "Customer returned the item." })
  reason!: string;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: RefundView): RefundDto {
    const dto = new RefundDto();
    dto.id = view.id;
    dto.invoiceId = view.invoiceId;
    dto.orderId = view.orderId;
    dto.amountMinor = view.amountMinor;
    dto.reason = view.reason;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

/** Keyset-paginated refunds envelope. */
export class RefundListDtoPage {
  @ApiProperty({ type: [RefundDto] })
  data!: RefundDto[];

  @ApiProperty({ type: FinancePageDto })
  page!: FinancePageDto;

  static from(page: KeysetPage<RefundView>): RefundListDtoPage {
    const dto = new RefundListDtoPage();
    dto.data = page.data.map((r) => RefundDto.from(r));
    dto.page = {
      limit: page.page.limit,
      nextCursor: page.page.nextCursor,
      hasMore: page.page.hasMore,
    };
    return dto;
  }
}

/** One matched reconciliation line: a shipment's statement amount vs. its recorded fee. */
export class ReconciliationLineDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  shipmentId!: string;

  @ApiProperty({ example: 5000, description: "Integer minor units." })
  statementAmountMinor!: number;

  @ApiProperty({ example: 4800, description: "Integer minor units." })
  shipmentFeeMinor!: number;

  @ApiProperty({ example: 200, description: "Integer minor units; statement minus fee." })
  varianceMinor!: number;

  static from(view: ReconciliationLineView): ReconciliationLineDto {
    const dto = new ReconciliationLineDto();
    dto.id = view.id;
    dto.shipmentId = view.shipmentId;
    dto.statementAmountMinor = view.statementAmountMinor;
    dto.shipmentFeeMinor = view.shipmentFeeMinor;
    dto.varianceMinor = view.varianceMinor;
    return dto;
  }
}

/** A reconciled carrier statement batch without its lines (list rendering). */
export class ReconciliationListDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "manual" })
  carrier!: string;

  @ApiProperty({ example: "STMT-2026-01" })
  statementRef!: string;

  @ApiProperty({ example: "2026-01" })
  periodKey!: string;

  @ApiProperty({ example: 50000, description: "Integer minor units." })
  totalStatementMinor!: number;

  @ApiProperty({ example: 48000, description: "Integer minor units." })
  totalFeeMinor!: number;

  @ApiProperty({ example: 2000, description: "Integer minor units." })
  totalVarianceMinor!: number;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: ReconciliationListView): ReconciliationListDto {
    const dto = new ReconciliationListDto();
    dto.id = view.id;
    dto.carrier = view.carrier;
    dto.statementRef = view.statementRef;
    dto.periodKey = view.periodKey;
    dto.totalStatementMinor = view.totalStatementMinor;
    dto.totalFeeMinor = view.totalFeeMinor;
    dto.totalVarianceMinor = view.totalVarianceMinor;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

/** A reconciliation with its matched lines (detail rendering). */
export class ReconciliationDto extends ReconciliationListDto {
  @ApiProperty({ type: [ReconciliationLineDto] })
  lines!: ReconciliationLineDto[];

  static override from(view: ReconciliationView): ReconciliationDto {
    const dto = new ReconciliationDto();
    Object.assign(dto, ReconciliationListDto.from(view));
    dto.lines = view.lines.map((l) => ReconciliationLineDto.from(l));
    return dto;
  }
}

/** Keyset-paginated reconciliations envelope. */
export class ReconciliationListDtoPage {
  @ApiProperty({ type: [ReconciliationListDto] })
  data!: ReconciliationListDto[];

  @ApiProperty({ type: FinancePageDto })
  page!: FinancePageDto;

  static from(page: KeysetPage<ReconciliationListView>): ReconciliationListDtoPage {
    const dto = new ReconciliationListDtoPage();
    dto.data = page.data.map((r) => ReconciliationListDto.from(r));
    dto.page = {
      limit: page.page.limit,
      nextCursor: page.page.nextCursor,
      hasMore: page.page.hasMore,
    };
    return dto;
  }
}

/** A monthly accounting period (D4), open or closed. */
export class AccountingPeriodDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "2026-01" })
  periodKey!: string;

  @ApiProperty({ enum: ACCOUNTING_PERIOD_STATUSES })
  status!: AccountingPeriodStatus;

  @ApiProperty({ format: "date-time", nullable: true })
  closedAt!: string | null;

  @ApiProperty({ format: "uuid", nullable: true })
  closedBy!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: AccountingPeriodView): AccountingPeriodDto {
    const dto = new AccountingPeriodDto();
    dto.id = view.id;
    dto.periodKey = view.periodKey;
    dto.status = view.status;
    dto.closedAt = view.closedAt;
    dto.closedBy = view.closedBy;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

/** A computed, read-only cash-center summary over a date range (D6). */
export class CashCenterReportDto {
  @ApiProperty({ example: 500000, description: "Integer minor units." })
  collectedMinor!: number;

  @ApiProperty({ example: 80000, description: "Integer minor units." })
  expensesMinor!: number;

  @ApiProperty({ example: 120000, description: "Integer minor units." })
  purchaseOrderPaymentsMinor!: number;

  @ApiProperty({ example: 10000, description: "Integer minor units." })
  refundsMinor!: number;

  @ApiProperty({ example: 30000, description: "Integer minor units." })
  shippingFeesMinor!: number;

  @ApiProperty({ example: 260000, description: "Integer minor units." })
  netCashMinor!: number;

  static from(view: CashCenterReportView): CashCenterReportDto {
    const dto = new CashCenterReportDto();
    dto.collectedMinor = view.collectedMinor;
    dto.expensesMinor = view.expensesMinor;
    dto.purchaseOrderPaymentsMinor = view.purchaseOrderPaymentsMinor;
    dto.refundsMinor = view.refundsMinor;
    dto.shippingFeesMinor = view.shippingFeesMinor;
    dto.netCashMinor = view.netCashMinor;
    return dto;
  }
}

/** A computed P&L summary over one date range (D6). */
export class PnlPeriodDto {
  @ApiProperty({ example: 500000, description: "Integer minor units." })
  revenueMinor!: number;

  @ApiProperty({ example: 200000, description: "Integer minor units." })
  cogsMinor!: number;

  @ApiProperty({ example: 80000, description: "Integer minor units." })
  expensesMinor!: number;

  @ApiProperty({ example: 220000, description: "Integer minor units." })
  netIncomeMinor!: number;

  static from(view: PnlPeriodView): PnlPeriodDto {
    const dto = new PnlPeriodDto();
    dto.revenueMinor = view.revenueMinor;
    dto.cogsMinor = view.cogsMinor;
    dto.expensesMinor = view.expensesMinor;
    dto.netIncomeMinor = view.netIncomeMinor;
    return dto;
  }
}

/** A computed P&L report, optionally with a comparison period (D6). */
export class PnlReportDto {
  @ApiProperty({ type: PnlPeriodDto })
  current!: PnlPeriodDto;

  @ApiPropertyOptional({ type: PnlPeriodDto })
  previous?: PnlPeriodDto;

  static from(view: PnlReportView): PnlReportDto {
    const dto = new PnlReportDto();
    dto.current = PnlPeriodDto.from(view.current);
    if (view.previous !== undefined) dto.previous = PnlPeriodDto.from(view.previous);
    return dto;
  }
}

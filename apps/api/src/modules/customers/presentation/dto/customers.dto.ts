import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import type { KeysetPage } from "@cadeau/database";
import type {
  CustomerAddressView,
  CustomerListView,
  CustomerMergeResult,
  CustomerOrderSummaryView,
  CustomerView,
  CustomerWithAddresses,
} from "../../domain/customer.entity";

// ---- Request DTOs ----------------------------------------------------------

/**
 * Create-customer payload.
 *
 * `phone` is accepted in any common form and normalized to E.164 by the domain
 * before it is hashed or stored — this DTO only checks that it is a plausible
 * string, so that normalization stays in exactly one place (criterion 3).
 *
 * The derived KPIs (`ordersCount`, `totalSpent`, `lastOrderAt`) are deliberately
 * absent: there is no write path for them at any layer until EPIC-11.
 */
export class CreateCustomerDto {
  @ApiProperty({ example: "Sara Ali", maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: "+201001234567", description: "Normalized to E.164 server-side." })
  @IsString()
  @MinLength(5)
  @MaxLength(32)
  phone!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 320 })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

/** Update-customer payload (partial). Omit a field to leave it unchanged. */
export class UpdateCustomerDto {
  @ApiPropertyOptional({ example: "Sara Ali", maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: "+201001234567" })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 320 })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

/** Create-address payload. Setting `isDefault` steps the incumbent default down. */
export class CreateAddressDto {
  @ApiProperty({ example: "12 El-Nasr St., Apt 4", maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  line!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  landmark?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true, description: "governorates id." })
  @IsOptional()
  @IsUUID()
  governorateId?: string | null;

  @ApiPropertyOptional({ description: "At most one address per customer is the default." })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/** Update-address payload (partial). */
export class UpdateAddressDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  line?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  landmark?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  governorateId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: "Soft-delete flag; false archives the address." })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/**
 * Export payload — the same filters as the list, minus the cursor. It is a
 * `POST` with a body rather than a `GET` with a query string precisely because
 * the filters (a phone in `q`, say) are personal data and must not land in a URL
 * or an access log (docs/privacy-model.md §6).
 */
export class ExportCustomersDto {
  @ApiPropertyOptional({ description: "Exact phone (E.164) or a name/email term." })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ enum: ["true", "false", "all"], default: "true" })
  @IsOptional()
  @IsIn(["true", "false", "all"])
  active?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  governorateId?: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsString()
  createdAtFrom?: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsString()
  createdAtTo?: string;

  @ApiPropertyOptional({ description: "Row cap; clamped to the server maximum.", minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}

/**
 * Merge payload (EPIC-11, decision D5). The merged customer is folded into the
 * surviving one (all orders + addresses re-parented) and then archived.
 */
export class MergeCustomersDto {
  @ApiProperty({ format: "uuid", description: "The customer that survives the merge." })
  @IsUUID()
  survivingCustomerId!: string;

  @ApiProperty({ format: "uuid", description: "The customer folded in and archived." })
  @IsUUID()
  mergedCustomerId!: string;
}

// ---- Response DTOs ---------------------------------------------------------

/** The derived KPI block. Read-only everywhere; `0`/`null` until EPIC-11. */
class CustomerKpiFields {
  @ApiProperty({ example: 0, description: "Derived, read-only (EPIC-11 computes it)." })
  ordersCount!: number;

  @ApiProperty({ example: 0, description: "Lifetime spend, integer minor units. Read-only." })
  totalSpent!: number;

  @ApiProperty({ format: "date-time", nullable: true, description: "Derived, read-only." })
  lastOrderAt!: string | null;
}

/**
 * A customer as a **list** row: the phone is masked. There is no full-phone
 * field on this class at all — a page of customers cannot become a bulk PII
 * response by accident (docs/privacy-model.md §6).
 */
export class CustomerListItemDto extends CustomerKpiFields {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "Sara Ali" })
  name!: string;

  @ApiProperty({
    example: "+2010•••4567",
    description: "Masked; the full value needs a detail read.",
  })
  phoneMasked!: string;

  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ description: "Soft-delete flag; false means archived." })
  active!: boolean;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: CustomerListView): CustomerListItemDto {
    const dto = new CustomerListItemDto();
    dto.id = view.id;
    dto.name = view.name;
    dto.phoneMasked = view.phoneMasked;
    dto.email = view.email;
    dto.ordersCount = view.ordersCount;
    dto.totalSpent = view.totalSpent;
    dto.lastOrderAt = view.lastOrderAt;
    dto.active = view.active;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

/** A customer with the full phone — returned by single-customer reads and writes. */
export class CustomerDto extends CustomerKpiFields {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "Sara Ali" })
  name!: string;

  @ApiProperty({ example: "+201001234567", description: "Full E.164 number." })
  phone!: string;

  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  notes!: string | null;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: CustomerView): CustomerDto {
    return CustomerDto.assign(new CustomerDto(), view);
  }

  protected static assign<T extends CustomerDto>(dto: T, view: CustomerView): T {
    dto.id = view.id;
    dto.name = view.name;
    dto.phone = view.phone;
    dto.email = view.email;
    dto.notes = view.notes;
    dto.ordersCount = view.ordersCount;
    dto.totalSpent = view.totalSpent;
    dto.lastOrderAt = view.lastOrderAt;
    dto.active = view.active;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

/** A customer delivery address. */
export class CustomerAddressDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  customerId!: string;

  @ApiProperty({ example: "12 El-Nasr St., Apt 4" })
  line!: string;

  @ApiProperty({ nullable: true })
  landmark!: string | null;

  @ApiProperty({ nullable: true })
  notes!: string | null;

  @ApiProperty({ format: "uuid", nullable: true })
  governorateId!: string | null;

  @ApiProperty({ description: "At most one per customer." })
  isDefault!: boolean;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  static from(view: CustomerAddressView): CustomerAddressDto {
    const dto = new CustomerAddressDto();
    dto.id = view.id;
    dto.customerId = view.customerId;
    dto.line = view.line;
    dto.landmark = view.landmark;
    dto.notes = view.notes;
    dto.governorateId = view.governorateId;
    dto.isDefault = view.isDefault;
    dto.active = view.active;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;
    return dto;
  }
}

/** A customer with its addresses (the detail read). */
export class CustomerDetailDto extends CustomerDto {
  @ApiProperty({ type: [CustomerAddressDto] })
  addresses!: CustomerAddressDto[];

  static fromDetail(view: CustomerWithAddresses): CustomerDetailDto {
    const dto = CustomerDto.assign(new CustomerDetailDto(), view);
    dto.addresses = view.addresses.map((a) => CustomerAddressDto.from(a));
    return dto;
  }
}

/** Keyset page metadata (api-conventions §5). */
export class CustomerPageDto {
  @ApiProperty({ example: 25 })
  limit!: number;

  @ApiProperty({ nullable: true, description: "Opaque cursor for the next page, or null." })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

/** Keyset-paginated customers envelope — masked rows only. */
export class CustomerListDto {
  @ApiProperty({ type: [CustomerListItemDto] })
  data!: CustomerListItemDto[];

  @ApiProperty({ type: CustomerPageDto })
  page!: CustomerPageDto;

  static from(page: KeysetPage<CustomerListView>): CustomerListDto {
    const dto = new CustomerListDto();
    dto.data = page.data.map((c) => CustomerListItemDto.from(c));
    dto.page = {
      limit: page.page.limit,
      nextCursor: page.page.nextCursor,
      hasMore: page.page.hasMore,
    };
    return dto;
  }
}

/** A customer's addresses (raw collection — no pagination). */
export class AddressListDto {
  @ApiProperty({ type: [CustomerAddressDto] })
  data!: CustomerAddressDto[];

  static from(views: readonly CustomerAddressView[]): AddressListDto {
    const dto = new AddressListDto();
    dto.data = views.map((a) => CustomerAddressDto.from(a));
    return dto;
  }
}

/** The export envelope: full-phone rows plus the count that was audited. */
export class CustomerExportDto {
  @ApiProperty({ type: [CustomerDto] })
  data!: CustomerDto[];

  @ApiProperty({ example: 42, description: "Rows exported — the same number that was audited." })
  count!: number;

  static from(views: readonly CustomerView[]): CustomerExportDto {
    const dto = new CustomerExportDto();
    dto.data = views.map((c) => CustomerDto.from(c));
    dto.count = views.length;
    return dto;
  }
}

/** A row of a customer's order history (EPIC-11). */
export class CustomerOrderSummaryDto {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty({ example: 1042 })
  orderNumber!: number;
  @ApiProperty({ example: "processing" })
  status!: string;
  @ApiProperty({ example: 35000, description: "Order total, integer minor units." })
  total!: number;
  @ApiProperty({ example: 0, description: "COD collected, integer minor units." })
  collectedAmount!: number;
  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  static from(view: CustomerOrderSummaryView): CustomerOrderSummaryDto {
    const dto = new CustomerOrderSummaryDto();
    dto.id = view.id;
    dto.orderNumber = view.orderNumber;
    dto.status = view.status;
    dto.total = view.total;
    dto.collectedAmount = view.collectedAmount;
    dto.createdAt = view.createdAt;
    return dto;
  }
}

/** Keyset-paginated order-history envelope. */
export class CustomerOrderListDto {
  @ApiProperty({ type: [CustomerOrderSummaryDto] })
  data!: CustomerOrderSummaryDto[];
  @ApiProperty({ type: CustomerPageDto })
  page!: CustomerPageDto;

  static from(page: KeysetPage<CustomerOrderSummaryView>): CustomerOrderListDto {
    const dto = new CustomerOrderListDto();
    dto.data = page.data.map((o) => CustomerOrderSummaryDto.from(o));
    dto.page = {
      limit: page.page.limit,
      nextCursor: page.page.nextCursor,
      hasMore: page.page.hasMore,
    };
    return dto;
  }
}

/** The merge result: the two ids that were folded together. */
export class CustomerMergeResultDto {
  @ApiProperty({ format: "uuid" })
  survivingCustomerId!: string;
  @ApiProperty({ format: "uuid" })
  mergedCustomerId!: string;

  static from(result: CustomerMergeResult): CustomerMergeResultDto {
    const dto = new CustomerMergeResultDto();
    dto.survivingCustomerId = result.survivingCustomerId;
    dto.mergedCustomerId = result.mergedCustomerId;
    return dto;
  }
}

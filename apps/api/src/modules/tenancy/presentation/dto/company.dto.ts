import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { TokensDto } from "../../../../shared/contracts/tokens.dto";
import type { CompanyRecord } from "../../domain/tenancy.types";
import type { CreateCompanyResult } from "../../application/tenancy.service";

/** Allowed monthly-orders-volume buckets shown on the create-company screen. */
export const MONTHLY_ORDERS_RANGES = [
  "under_100",
  "100_500",
  "500_1000",
  "1000_2000",
  "2000_5000",
  "over_5000",
] as const;

/** Create-company payload. */
export class CreateCompanyDto {
  @ApiProperty({ minLength: 2, maxLength: 120, example: "Acme Gifts" })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    minLength: 2,
    maxLength: 40,
    description: "Optional URL-safe slug (lowercase letters, digits, hyphens).",
    example: "acme",
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "slug must be lowercase alphanumeric words separated by hyphens",
  })
  slug?: string;

  @ApiProperty({ maxLength: 40, example: "+201234567890" })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  phone!: string;

  @ApiProperty({ enum: MONTHLY_ORDERS_RANGES, example: "100_500" })
  @IsIn(MONTHLY_ORDERS_RANGES, {
    message: `monthlyOrdersRange must be one of: ${MONTHLY_ORDERS_RANGES.join(", ")}`,
  })
  monthlyOrdersRange!: (typeof MONTHLY_ORDERS_RANGES)[number];

  @ApiPropertyOptional({ maxLength: 80, example: "Egypt" })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(80)
  country?: string;

  @ApiPropertyOptional({ maxLength: 200, example: "facebook.com/acme.gifts" })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  facebookHandle?: string;

  @ApiPropertyOptional({ maxLength: 200, example: "@acme.gifts" })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  instagramHandle?: string;

  @ApiPropertyOptional({ maxLength: 200, example: "https://acme.gifts" })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  websiteUrl?: string;

  @ApiPropertyOptional({ maxLength: 120, example: "DHL, FedEx, Aramex" })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  shippingCarrier?: string;
}

/** Update-whatsapp-settings payload. Send `null` to clear the prefix. */
export class UpdateWhatsappSettingsDto {
  @ApiProperty({ nullable: true, maxLength: 8, example: "20" })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(8)
  countryCode!: string | null;
}

/** A created company. */
export class CompanyDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "Acme Gifts" })
  name!: string;

  @ApiProperty({ nullable: true, example: "acme" })
  slug!: string | null;

  @ApiProperty({ example: "active" })
  status!: string;

  @ApiProperty({ nullable: true, example: "+201234567890" })
  phone!: string | null;

  @ApiProperty({ nullable: true, enum: MONTHLY_ORDERS_RANGES, example: "100_500" })
  monthlyOrdersRange!: string | null;

  @ApiProperty({ nullable: true, example: "Egypt" })
  country!: string | null;

  @ApiProperty({ nullable: true, example: "facebook.com/acme.gifts" })
  facebookHandle!: string | null;

  @ApiProperty({ nullable: true, example: "@acme.gifts" })
  instagramHandle!: string | null;

  @ApiProperty({ nullable: true, example: "https://acme.gifts" })
  websiteUrl!: string | null;

  @ApiProperty({ nullable: true, example: "DHL, FedEx, Aramex" })
  shippingCarrier!: string | null;

  @ApiProperty({ nullable: true, example: "20", description: "WhatsApp dialing prefix." })
  whatsappCountryCode!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  static from(company: CompanyRecord): CompanyDto {
    const dto = new CompanyDto();
    dto.id = company.id;
    dto.name = company.name;
    dto.slug = company.slug;
    dto.status = company.status;
    dto.phone = company.phone;
    dto.monthlyOrdersRange = company.monthlyOrdersRange;
    dto.country = company.country;
    dto.facebookHandle = company.facebookHandle;
    dto.instagramHandle = company.instagramHandle;
    dto.websiteUrl = company.websiteUrl;
    dto.shippingCarrier = company.shippingCarrier;
    dto.whatsappCountryCode = company.whatsappCountryCode;
    dto.createdAt = company.createdAt.toISOString();
    return dto;
  }
}

/** Create-company response: the company plus tokens re-issued for the new tenant. */
export class CreateCompanyResponseDto {
  @ApiProperty({ type: CompanyDto })
  company!: CompanyDto;

  @ApiProperty({ type: TokensDto })
  tokens!: TokensDto;

  static from(result: CreateCompanyResult): CreateCompanyResponseDto {
    const dto = new CreateCompanyResponseDto();
    dto.company = CompanyDto.from(result.company);
    dto.tokens = TokensDto.from(result.tokens);
    return dto;
  }
}

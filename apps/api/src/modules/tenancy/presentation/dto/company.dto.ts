import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { TokensDto } from "../../../../shared/contracts/tokens.dto";
import type { CompanyRecord } from "../../domain/tenancy.types";
import type { CreateCompanyResult } from "../../application/tenancy.service";

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

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  static from(company: CompanyRecord): CompanyDto {
    const dto = new CompanyDto();
    dto.id = company.id;
    dto.name = company.name;
    dto.slug = company.slug;
    dto.status = company.status;
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

import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsString, MaxLength, MinLength } from "class-validator";
import type { KeysetPage } from "@cadeau/database";
import type { AdminCompanyView } from "../../domain/access.types";

/** A company row on the Super-Admin surface. */
export class AdminCompanyDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "Acme Gifts" })
  name!: string;

  @ApiProperty({ nullable: true, example: "acme" })
  slug!: string | null;

  @ApiProperty({ example: "active" })
  status!: string;

  @ApiProperty({ nullable: true, example: "pro", description: "Current plan code, or null." })
  planCode!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  static from(view: AdminCompanyView): AdminCompanyDto {
    const dto = new AdminCompanyDto();
    dto.id = view.id;
    dto.name = view.name;
    dto.slug = view.slug;
    dto.status = view.status;
    dto.planCode = view.planCode;
    dto.createdAt = view.createdAt.toISOString();
    return dto;
  }
}

/** Keyset page metadata (api-conventions §5). */
export class PageDto {
  @ApiProperty({ example: 25 })
  limit!: number;

  @ApiProperty({ nullable: true, description: "Opaque cursor for the next page, or null." })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

/** Keyset-paginated companies envelope. */
export class AdminCompanyListDto {
  @ApiProperty({ type: [AdminCompanyDto] })
  data!: AdminCompanyDto[];

  @ApiProperty({ type: PageDto })
  page!: PageDto;

  static from(page: KeysetPage<AdminCompanyView>): AdminCompanyListDto {
    const dto = new AdminCompanyListDto();
    dto.data = page.data.map((c) => AdminCompanyDto.from(c));
    dto.page = {
      limit: page.page.limit,
      nextCursor: page.page.nextCursor,
      hasMore: page.page.hasMore,
    };
    return dto;
  }
}

/** Toggle-feature payload (Super-Admin). */
export class SetFeatureFlagDto {
  @ApiProperty({ description: "Enable or disable the feature for the company." })
  @IsBoolean()
  enabled!: boolean;
}

/** Toggle-feature response. */
export class FeatureFlagResultDto {
  @ApiProperty({ example: "analytics" })
  featureKey!: string;

  @ApiProperty()
  enabled!: boolean;
}

/** Set-subscription payload (Super-Admin). */
export class SetSubscriptionDto {
  @ApiProperty({ example: "pro", description: "Plan code to assign." })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  planCode!: string;
}

/** Set-subscription response. */
export class SubscriptionResultDto {
  @ApiProperty({ example: "pro" })
  planCode!: string;
}

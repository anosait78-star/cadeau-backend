import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";
import type { AcceptWarehouseJoinCodeResult } from "../../application/tenancy.service";

/** Accept-warehouse-join-code payload (Vendor Accounts, Phase 1). */
export class AcceptWarehouseJoinCodeDto {
  @ApiProperty({ description: "The warehouse's shareable join code.", minLength: 10 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  code!: string;
}

/** Accept-warehouse-join-code response. */
export class AcceptWarehouseJoinCodeResponseDto {
  @ApiProperty({ format: "uuid" })
  companyId!: string;

  @ApiProperty({ example: "vendor" })
  role!: string;

  @ApiProperty({ format: "uuid", nullable: true })
  warehouseId!: string | null;

  @ApiProperty({ description: "True if the caller was already a member (idempotent accept)." })
  alreadyMember!: boolean;

  static from(result: AcceptWarehouseJoinCodeResult): AcceptWarehouseJoinCodeResponseDto {
    const dto = new AcceptWarehouseJoinCodeResponseDto();
    dto.companyId = result.companyId;
    dto.role = result.role;
    dto.warehouseId = result.warehouseId;
    dto.alreadyMember = result.alreadyMember;
    return dto;
  }
}

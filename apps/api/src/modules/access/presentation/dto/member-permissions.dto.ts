import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import type {
  MemberPermissionOverride,
  MemberPermissionsSnapshot,
} from "../../domain/access.types";

/** One per-member permission override in an assignment payload. */
export class MemberPermissionOverrideDto {
  @ApiProperty({ example: "orders.manage" })
  @IsString()
  @MaxLength(100)
  key!: string;

  @ApiProperty({ description: "true grants the permission, false revokes it." })
  @IsBoolean()
  granted!: boolean;
}

/**
 * Assign a template and/or a full replacement set of per-member overrides to a
 * member. At least one of the two must be present (enforced in the service).
 */
export class AssignMemberPermissionsDto {
  @ApiPropertyOptional({ example: "store_manager", description: "Role/template key." })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  templateKey?: string;

  @ApiPropertyOptional({ type: [MemberPermissionOverrideDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MemberPermissionOverrideDto)
  permissions?: MemberPermissionOverrideDto[];
}

/** The member's resulting permission state after an assignment. */
export class MemberPermissionsDto {
  @ApiProperty({ example: "store_manager" })
  role!: string;

  @ApiProperty({ type: [MemberPermissionOverrideDto] })
  overrides!: MemberPermissionOverrideDto[];

  static from(snapshot: MemberPermissionsSnapshot): MemberPermissionsDto {
    const dto = new MemberPermissionsDto();
    dto.role = snapshot.role;
    dto.overrides = snapshot.overrides.map((o: MemberPermissionOverride) => {
      const override = new MemberPermissionOverrideDto();
      override.key = o.key;
      override.granted = o.granted;
      return override;
    });
    return dto;
  }
}

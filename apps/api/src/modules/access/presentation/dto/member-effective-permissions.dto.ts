import { ApiProperty } from "@nestjs/swagger";
import type { MemberEffectivePermissionsView } from "../../domain/access.types";

/** One active member's role and effective permission keys. */
export class MemberEffectivePermissionsDto {
  @ApiProperty({ format: "uuid" })
  memberId!: string;

  @ApiProperty({ example: "store_manager" })
  role!: string;

  @ApiProperty({ type: [String], example: ["orders.read", "orders.manage"] })
  permissions!: string[];

  static from(view: MemberEffectivePermissionsView): MemberEffectivePermissionsDto {
    const dto = new MemberEffectivePermissionsDto();
    dto.memberId = view.memberId;
    dto.role = view.role;
    dto.permissions = [...view.permissions];
    return dto;
  }
}

/** Envelope for the members' effective permissions. */
export class MemberEffectivePermissionsListDto {
  @ApiProperty({ type: [MemberEffectivePermissionsDto] })
  data!: MemberEffectivePermissionsDto[];

  static from(views: readonly MemberEffectivePermissionsView[]): MemberEffectivePermissionsListDto {
    const dto = new MemberEffectivePermissionsListDto();
    dto.data = views.map((v) => MemberEffectivePermissionsDto.from(v));
    return dto;
  }
}

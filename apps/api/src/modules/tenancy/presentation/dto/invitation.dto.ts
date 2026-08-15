import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import { INVITABLE_ROLES, type InvitableRole } from "../../domain/tenancy-roles";
import type { InvitationRecord } from "../../domain/tenancy.types";
import type { AcceptInvitationResult, CreatedInvitation } from "../../application/tenancy.service";

export { INVITABLE_ROLES, TEMPLATE_ROLES, CUSTOM_ROLE } from "../../domain/tenancy-roles";

/**
 * Invite-member payload. `role` selects a fixed permission template, or
 * `"custom"` to grant exactly the `permissionKeys` chosen for this invitation
 * alone (validated server-side against what the company's plan/features
 * actually make available — never trusted as given).
 */
export class CreateInvitationDto {
  @ApiProperty({ example: "teammate@acme.test", maxLength: 254 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: "email must be a valid email address" })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ enum: INVITABLE_ROLES, example: "store_manager" })
  @IsIn(INVITABLE_ROLES, { message: `role must be one of: ${INVITABLE_ROLES.join(", ")}` })
  role!: InvitableRole;

  @ApiPropertyOptional({
    type: [String],
    example: ["orders.read", "orders.manage"],
    description:
      'Required (non-empty) when role is "custom". Optional extra keys layered on top of the ' +
      'template when role is "manager" (e.g. "access.manage"). Disallowed for every other role.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  permissionKeys?: string[];
}

/** A created invitation, including its one-time shareable code (shown once). */
export class CreatedInvitationDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "teammate@acme.test" })
  email!: string;

  @ApiProperty({ example: "store_manager" })
  role!: string;

  @ApiProperty({ type: [String], example: [] })
  permissionKeys!: string[];

  @ApiProperty({ example: "pending" })
  status!: string;

  @ApiProperty({ format: "date-time" })
  expiresAt!: string;

  @ApiProperty({
    description: "One-time shareable code. Returned only here; store the hash only.",
  })
  code!: string;

  static from(created: CreatedInvitation): CreatedInvitationDto {
    const dto = new CreatedInvitationDto();
    const { invitation } = created;
    dto.id = invitation.id;
    dto.email = invitation.email;
    dto.role = invitation.role;
    dto.permissionKeys = [...invitation.customPermissionKeys];
    dto.status = invitation.status;
    dto.expiresAt = invitation.expiresAt.toISOString();
    dto.code = created.code;
    return dto;
  }
}

/** Public view of an invitation (no code). */
export class InvitationDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "teammate@acme.test" })
  email!: string;

  @ApiProperty({ example: "store_manager" })
  role!: string;

  @ApiProperty({ type: [String], example: [] })
  permissionKeys!: string[];

  @ApiProperty({ example: "pending" })
  status!: string;

  @ApiProperty({ format: "date-time" })
  expiresAt!: string;

  static from(invitation: InvitationRecord): InvitationDto {
    const dto = new InvitationDto();
    dto.id = invitation.id;
    dto.email = invitation.email;
    dto.role = invitation.role;
    dto.permissionKeys = [...invitation.customPermissionKeys];
    dto.status = invitation.status;
    dto.expiresAt = invitation.expiresAt.toISOString();
    return dto;
  }
}

/** Envelope for the invitations list. */
export class InvitationListDto {
  @ApiProperty({ type: [InvitationDto] })
  data!: InvitationDto[];

  static from(invitations: readonly InvitationRecord[]): InvitationListDto {
    const dto = new InvitationListDto();
    dto.data = invitations.map((i) => InvitationDto.from(i));
    return dto;
  }
}

/** Accept-invitation payload. */
export class AcceptInvitationDto {
  @ApiProperty({ description: "The shareable invite code.", minLength: 10 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  code!: string;
}

/** Accept-invitation response. */
export class AcceptInvitationResponseDto {
  @ApiProperty({ format: "uuid" })
  companyId!: string;

  @ApiProperty({ example: "store_manager" })
  role!: string;

  @ApiProperty({ description: "True if the caller was already a member (idempotent accept)." })
  alreadyMember!: boolean;

  static from(result: AcceptInvitationResult): AcceptInvitationResponseDto {
    const dto = new AcceptInvitationResponseDto();
    dto.companyId = result.companyId;
    dto.role = result.role;
    dto.alreadyMember = result.alreadyMember;
    return dto;
  }
}

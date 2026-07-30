import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import type { InvitationRecord } from "../../domain/tenancy.types";
import type { AcceptInvitationResult, CreatedInvitation } from "../../application/tenancy.service";

/** Roles that may be invited (owner is reserved for the creator; refined in EPIC-5). */
export const INVITABLE_ROLES = ["admin", "member"] as const;

/** Invite-member payload. */
export class CreateInvitationDto {
  @ApiProperty({ example: "teammate@acme.test", maxLength: 254 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: "email must be a valid email address" })
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ enum: INVITABLE_ROLES, default: "member" })
  @IsOptional()
  @IsIn(INVITABLE_ROLES, { message: "role must be one of: admin, member" })
  role?: (typeof INVITABLE_ROLES)[number];
}

/** A created invitation, including its one-time shareable code (shown once). */
export class CreatedInvitationDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "teammate@acme.test" })
  email!: string;

  @ApiProperty({ example: "member" })
  role!: string;

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

  @ApiProperty({ example: "member" })
  role!: string;

  @ApiProperty({ example: "pending" })
  status!: string;

  @ApiProperty({ format: "date-time" })
  expiresAt!: string;

  static from(invitation: InvitationRecord): InvitationDto {
    const dto = new InvitationDto();
    dto.id = invitation.id;
    dto.email = invitation.email;
    dto.role = invitation.role;
    dto.status = invitation.status;
    dto.expiresAt = invitation.expiresAt.toISOString();
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

  @ApiProperty({ example: "member" })
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

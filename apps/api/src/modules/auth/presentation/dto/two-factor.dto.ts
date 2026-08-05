import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsString, Matches } from "class-validator";
import type { TwoFactorEnrolment } from "../../domain/auth.types";

/** Enrolment material returned once when 2FA enrolment begins. */
export class TwoFactorEnrolmentDto {
  @ApiProperty({
    description: "Base32 TOTP secret to add to an authenticator app. Shown once.",
    example: "JBSWY3DPEHPK3PXP",
  })
  secret!: string;

  @ApiProperty({
    description: "otpauth:// provisioning URI (render as a QR code).",
    example: "otpauth://totp/Cadeau%20CRM:founder@acme.test?secret=...",
  })
  otpauthUri!: string;

  static from(enrolment: TwoFactorEnrolment): TwoFactorEnrolmentDto {
    const dto = new TwoFactorEnrolmentDto();
    dto.secret = enrolment.secret;
    dto.otpauthUri = enrolment.otpauthUri;
    return dto;
  }
}

/** Confirm-enrolment / challenge payload carrying a 6-digit TOTP code. */
export class TwoFactorVerifyDto {
  @ApiProperty({ description: "6-digit TOTP code from the authenticator app.", example: "123456" })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Matches(/^\d{6}$/, { message: "code must be 6 digits" })
  code!: string;
}

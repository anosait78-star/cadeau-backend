import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, Matches, MaxLength } from "class-validator";

/** Login payload. Email is normalized (trimmed + lower-cased) before lookup. */
export class LoginDto {
  @ApiProperty({ example: "founder@acme.test", maxLength: 254 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: "email must be a valid email address" })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({
    description: "6-digit TOTP code; required only when the account has 2FA enabled.",
    example: "123456",
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Matches(/^\d{6}$/, { message: "totpCode must be 6 digits" })
  totpCode?: string;
}

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

/** Registration payload. Email is normalized (trimmed + lower-cased). */
export class RegisterDto {
  @ApiProperty({ example: "founder@acme.test", maxLength: 254 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: "email must be a valid email address" })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 8, maxLength: 128, example: "correct horse battery staple" })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ maxLength: 200, example: "Amina Saleh" })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  fullName?: string;

  @ApiPropertyOptional({ maxLength: 30, example: "+20 100 123 4567" })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Matches(/^[+0-9 ()-]{6,30}$/, { message: "phone must be a valid phone number" })
  phone?: string;
}

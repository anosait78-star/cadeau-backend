import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

/** Change-password payload — the caller must prove they hold the current one. */
export class ChangePasswordDto {
  @ApiProperty({ example: "correct horse battery staple" })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ minLength: 8, maxLength: 128, example: "a new stronger passphrase" })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

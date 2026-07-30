import { ApiProperty } from "@nestjs/swagger";
import { IsJWT } from "class-validator";

/** Refresh payload: the current refresh token to rotate. */
export class RefreshDto {
  @ApiProperty({ description: "The refresh token issued at login/last refresh." })
  @IsJWT()
  refreshToken!: string;
}

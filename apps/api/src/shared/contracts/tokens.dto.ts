import { ApiProperty } from "@nestjs/swagger";
import type { TokenPair } from "./token-pair";

/**
 * The token pair as returned to clients (refresh response, and embedded in the
 * auth + create-company responses). A shared contract DTO so both the auth and
 * tenancy features render tokens identically without cross-feature coupling.
 */
export class TokensDto {
  @ApiProperty({ description: "Short-lived access token (Bearer)." })
  accessToken!: string;

  @ApiProperty({ description: "Long-lived refresh token; rotated on every use." })
  refreshToken!: string;

  @ApiProperty({ example: "Bearer" })
  tokenType!: "Bearer";

  @ApiProperty({ description: "Access-token lifetime in seconds.", example: 300 })
  expiresIn!: number;

  static from(tokens: TokenPair): TokensDto {
    const dto = new TokensDto();
    dto.accessToken = tokens.accessToken;
    dto.refreshToken = tokens.refreshToken;
    dto.tokenType = "Bearer";
    dto.expiresIn = tokens.expiresInSeconds;
    return dto;
  }
}

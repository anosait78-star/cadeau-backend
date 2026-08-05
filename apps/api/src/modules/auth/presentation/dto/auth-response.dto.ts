import { ApiProperty } from "@nestjs/swagger";
import { TokensDto } from "../../../../shared/contracts/tokens.dto";
import type { AuthResult, UserSummary } from "../../domain/auth.types";

// TokensDto is a shared contract; re-export it so existing imports from this
// module keep working.
export { TokensDto };

/** Non-sensitive user summary returned after authentication. */
export class UserDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "founder@acme.test" })
  email!: string;

  @ApiProperty({ nullable: true, example: "Amina Saleh" })
  fullName!: string | null;
}

/** Full authentication response: the user plus a token pair. */
export class AuthResponseDto extends TokensDto {
  @ApiProperty({ type: UserDto })
  user!: UserDto;

  static fromResult(result: AuthResult): AuthResponseDto {
    const dto = new AuthResponseDto();
    dto.user = toUserDto(result.user);
    dto.accessToken = result.tokens.accessToken;
    dto.refreshToken = result.tokens.refreshToken;
    dto.tokenType = "Bearer";
    dto.expiresIn = result.tokens.expiresInSeconds;
    return dto;
  }
}

function toUserDto(user: UserSummary): UserDto {
  const dto = new UserDto();
  dto.id = user.id;
  dto.email = user.email;
  dto.fullName = user.fullName;
  return dto;
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { Request } from "express";
import { CurrentUser } from "../../../shared/auth/current-user.decorator";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { JwtAuthGuard } from "../../../shared/auth/jwt-auth.guard";
import { RateLimit } from "../../../shared/rate-limit/rate-limit.decorator";
import { RateLimitGuard } from "../../../shared/rate-limit/rate-limit.guard";
import { AuthService } from "../application/auth.service";
import type { RequestMeta } from "../domain/auth.types";
import { AuthResponseDto, TokensDto } from "./dto/auth-response.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";
import { RefreshDto } from "./dto/refresh.dto";
import { RegisterDto } from "./dto/register.dto";
import { SessionListDto } from "./dto/session.dto";
import { TwoFactorEnrolmentDto, TwoFactorVerifyDto } from "./dto/two-factor.dto";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * Auth endpoints under `/v1/auth` (contract: docs/api/auth.md). Public endpoints
 * (register/login/refresh) are rate-limited per client; session management
 * requires a valid access token. Credentials and tokens never appear in logs or
 * query strings.
 */
@ApiTags("auth")
@Controller("auth")
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  @ApiOperation({ summary: "Create an account and open a session", operationId: "register" })
  @ApiCreatedResponse({ type: AuthResponseDto })
  async register(@Body() dto: RegisterDto, @Req() req: Request): Promise<AuthResponseDto> {
    const result = await this.auth.register(
      {
        email: dto.email,
        password: dto.password,
        fullName: dto.fullName ?? null,
        phone: dto.phone ?? null,
      },
      meta(req),
    );
    return AuthResponseDto.fromResult(result);
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowMs: FIFTEEN_MINUTES_MS })
  @ApiOperation({ summary: "Exchange credentials for tokens", operationId: "login" })
  @ApiOkResponse({ type: AuthResponseDto })
  async login(@Body() dto: LoginDto, @Req() req: Request): Promise<AuthResponseDto> {
    const result = await this.auth.login(
      { email: dto.email, password: dto.password, totpCode: dto.totpCode ?? null },
      meta(req),
    );
    return AuthResponseDto.fromResult(result);
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowMs: FIFTEEN_MINUTES_MS })
  @ApiOperation({ summary: "Rotate the token pair from a refresh token", operationId: "refresh" })
  @ApiOkResponse({ type: TokensDto })
  async refresh(@Body() dto: RefreshDto, @Req() req: Request): Promise<TokensDto> {
    const tokens = await this.auth.refresh(dto.refreshToken, meta(req));
    return TokensDto.from(tokens);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revoke the current session", operationId: "logout" })
  @ApiNoContentResponse()
  async logout(@CurrentUser() principal: RequestPrincipal): Promise<void> {
    await this.auth.logout(principal);
  }

  @Get("sessions")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the caller's sessions", operationId: "listSessions" })
  @ApiOkResponse({ type: SessionListDto })
  async listSessions(@CurrentUser() principal: RequestPrincipal): Promise<SessionListDto> {
    return SessionListDto.from(await this.auth.listSessions(principal));
  }

  @Delete("sessions/:sessionId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revoke a specific session", operationId: "revokeSession" })
  @ApiNoContentResponse()
  async revokeSession(
    @CurrentUser() principal: RequestPrincipal,
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
  ): Promise<void> {
    await this.auth.revokeSession(principal, sessionId);
  }

  @Post("change-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Change the caller's password", operationId: "changePassword" })
  @ApiNoContentResponse()
  async changePassword(
    @CurrentUser() principal: RequestPrincipal,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(principal, dto.currentPassword, dto.newPassword);
  }

  @Post("account-deletion-request")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Request deletion of the caller's account",
    operationId: "requestAccountDeletion",
  })
  @ApiNoContentResponse()
  async requestAccountDeletion(@CurrentUser() principal: RequestPrincipal): Promise<void> {
    await this.auth.requestAccountDeletion(principal);
  }

  @Post("2fa/enroll")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Begin TOTP 2FA enrolment", operationId: "enrollTwoFactor" })
  @ApiCreatedResponse({ type: TwoFactorEnrolmentDto })
  async enrollTwoFactor(
    @CurrentUser() principal: RequestPrincipal,
  ): Promise<TwoFactorEnrolmentDto> {
    return TwoFactorEnrolmentDto.from(await this.auth.enrollTotp(principal));
  }

  @Post("2fa/verify")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Confirm a TOTP code, enabling 2FA", operationId: "verifyTwoFactor" })
  @ApiNoContentResponse()
  async verifyTwoFactor(
    @CurrentUser() principal: RequestPrincipal,
    @Body() dto: TwoFactorVerifyDto,
  ): Promise<void> {
    await this.auth.verifyTotpEnrolment(principal, dto.code);
  }
}

/** Extract non-sensitive request metadata for the session record + audit. */
function meta(req: Request): RequestMeta {
  return { userAgent: req.header("user-agent") ?? null, ipAddress: req.ip ?? null };
}

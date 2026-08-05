import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { CurrentUser } from "../../../shared/auth/current-user.decorator";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { JwtAuthGuard } from "../../../shared/auth/jwt-auth.guard";
import { RateLimit } from "../../../shared/rate-limit/rate-limit.decorator";
import { RateLimitGuard } from "../../../shared/rate-limit/rate-limit.guard";
import { TokensDto } from "../../../shared/contracts/tokens.dto";
import { TenancyService } from "../application/tenancy.service";
import { CompanyListDto, MeDto } from "./dto/me.dto";
import {
  CompanyDto,
  CreateCompanyDto,
  CreateCompanyResponseDto,
  UpdateWhatsappSettingsDto,
} from "./dto/company.dto";
import {
  AcceptInvitationDto,
  AcceptInvitationResponseDto,
  CreateInvitationDto,
  CreatedInvitationDto,
} from "./dto/invitation.dto";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * Tenancy endpoints (contract: docs/api/tenancy.md): the caller's profile, the
 * companies they belong to, company creation + tenant switching, and invitation
 * lifecycle. All require a valid access token; the active tenant is taken from
 * the token, never the payload (ADR-003).
 */
@ApiTags("tenancy")
@Controller()
@UseGuards(JwtAuthGuard, RateLimitGuard)
@ApiBearerAuth()
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get("me")
  @ApiOperation({ summary: "The caller's profile + companies", operationId: "getMe" })
  @ApiOkResponse({ type: MeDto })
  async getMe(@CurrentUser() principal: RequestPrincipal): Promise<MeDto> {
    return MeDto.from(await this.tenancy.getMe(principal));
  }

  @Get("companies")
  @ApiOperation({ summary: "Companies the caller belongs to", operationId: "listCompanies" })
  @ApiOkResponse({ type: CompanyListDto })
  async listCompanies(@CurrentUser() principal: RequestPrincipal): Promise<CompanyListDto> {
    return CompanyListDto.from(await this.tenancy.listCompanies(principal));
  }

  @Post("companies")
  @ApiOperation({ summary: "Create a company and switch into it", operationId: "createCompany" })
  @ApiCreatedResponse({ type: CreateCompanyResponseDto })
  async createCompany(
    @CurrentUser() principal: RequestPrincipal,
    @Body() dto: CreateCompanyDto,
  ): Promise<CreateCompanyResponseDto> {
    const result = await this.tenancy.createCompany(principal, {
      name: dto.name,
      slug: dto.slug ?? null,
      phone: dto.phone,
      monthlyOrdersRange: dto.monthlyOrdersRange,
      country: dto.country ?? null,
      facebookHandle: dto.facebookHandle ?? null,
      instagramHandle: dto.instagramHandle ?? null,
      websiteUrl: dto.websiteUrl ?? null,
      shippingCarrier: dto.shippingCarrier ?? null,
    });
    return CreateCompanyResponseDto.from(result);
  }

  @Post("companies/:companyId/switch")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Switch the active tenant", operationId: "switchCompany" })
  @ApiOkResponse({ type: TokensDto })
  async switchCompany(
    @CurrentUser() principal: RequestPrincipal,
    @Param("companyId", ParseUUIDPipe) companyId: string,
  ): Promise<TokensDto> {
    return TokensDto.from(await this.tenancy.switchCompany(principal, companyId));
  }

  @Patch("companies/:companyId/whatsapp-settings")
  @ApiOperation({
    summary: "Update the company's WhatsApp dialing-prefix setting",
    operationId: "updateWhatsappSettings",
  })
  @ApiOkResponse({ type: CompanyDto })
  async updateWhatsappSettings(
    @CurrentUser() principal: RequestPrincipal,
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @Body() dto: UpdateWhatsappSettingsDto,
  ): Promise<CompanyDto> {
    const company = await this.tenancy.updateWhatsappSettings(
      principal,
      companyId,
      dto.countryCode ?? null,
    );
    return CompanyDto.from(company);
  }

  @Post("companies/:companyId/invitations")
  @ApiOperation({ summary: "Invite a member", operationId: "createInvitation" })
  @ApiCreatedResponse({ type: CreatedInvitationDto })
  async createInvitation(
    @CurrentUser() principal: RequestPrincipal,
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @Body() dto: CreateInvitationDto,
  ): Promise<CreatedInvitationDto> {
    const created = await this.tenancy.createInvitation(principal, companyId, {
      email: dto.email,
      role: dto.role ?? "member",
    });
    return CreatedInvitationDto.from(created);
  }

  @Delete("companies/:companyId/invitations/:invitationId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Revoke a pending invitation", operationId: "revokeInvitation" })
  @ApiNoContentResponse()
  async revokeInvitation(
    @CurrentUser() principal: RequestPrincipal,
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @Param("invitationId", ParseUUIDPipe) invitationId: string,
  ): Promise<void> {
    await this.tenancy.revokeInvitation(principal, companyId, invitationId);
  }

  @Post("invitations/accept")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 20, windowMs: FIFTEEN_MINUTES_MS })
  @ApiOperation({ summary: "Accept an invitation by code", operationId: "acceptInvitation" })
  @ApiOkResponse({ type: AcceptInvitationResponseDto })
  async acceptInvitation(
    @CurrentUser() principal: RequestPrincipal,
    @Body() dto: AcceptInvitationDto,
  ): Promise<AcceptInvitationResponseDto> {
    return AcceptInvitationResponseDto.from(
      await this.tenancy.acceptInvitation(principal, dto.code),
    );
  }
}

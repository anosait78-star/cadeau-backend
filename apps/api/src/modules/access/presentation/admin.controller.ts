import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../../shared/auth/current-user.decorator";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { JwtAuthGuard } from "../../../shared/auth/jwt-auth.guard";
import { SuperAdminGuard } from "../../../shared/access/super-admin.guard";
import { AdminService } from "../application/admin.service";
import {
  AdminCompanyListDto,
  FeatureFlagResultDto,
  SetFeatureFlagDto,
  SetSubscriptionDto,
  SubscriptionResultDto,
} from "./dto/admin.dto";

/**
 * Platform Super-Admin endpoints under `/v1/admin` (contract: docs/api/access.md).
 * Every route is gated by {@link SuperAdminGuard} — a platform privilege isolated
 * from tenant roles. Toggling a feature or setting a plan for a company takes
 * effect live (the capability cache is invalidated on change).
 */
@ApiTags("admin")
@Controller("admin")
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("companies")
  @ApiOperation({ summary: "All companies (Super-Admin)", operationId: "adminListCompanies" })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiOkResponse({ type: AdminCompanyListDto })
  async listCompanies(
    @CurrentUser() principal: RequestPrincipal,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<AdminCompanyListDto> {
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    const page = await this.admin.listCompanies(principal, parsedLimit, cursor);
    return AdminCompanyListDto.from(page);
  }

  @Put("companies/:companyId/features/:featureKey")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Toggle a feature for a company (no code change)",
    operationId: "adminToggleFeature",
  })
  @ApiOkResponse({ type: FeatureFlagResultDto })
  async toggleFeature(
    @CurrentUser() principal: RequestPrincipal,
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @Param("featureKey") featureKey: string,
    @Body() dto: SetFeatureFlagDto,
  ): Promise<FeatureFlagResultDto> {
    return this.admin.toggleFeature(principal, companyId, featureKey, dto.enabled);
  }

  @Put("companies/:companyId/subscription")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Set a company's plan (Super-Admin)",
    operationId: "adminSetSubscription",
  })
  @ApiOkResponse({ type: SubscriptionResultDto })
  async setSubscription(
    @CurrentUser() principal: RequestPrincipal,
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @Body() dto: SetSubscriptionDto,
  ): Promise<SubscriptionResultDto> {
    return this.admin.setSubscription(principal, companyId, dto.planCode);
  }
}

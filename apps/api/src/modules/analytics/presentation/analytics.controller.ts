import { Body, Controller, Get, HttpStatus, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { AccessGuard } from "../../../shared/access/access.guard";
import { RequireCapability } from "../../../shared/access/require-capability.decorator";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { CurrentUser } from "../../../shared/auth/current-user.decorator";
import { JwtAuthGuard } from "../../../shared/auth/jwt-auth.guard";
import { AnalyticsService } from "../application/analytics.service";
import {
  AnalyticsWindowQueryDto,
  BusinessSummaryDto,
  ExportRequestDto,
  InventorySummaryDto,
  ProductsSummaryDto,
  ProfitabilitySummaryDto,
  StaffSummaryDto,
} from "./dto/analytics.dto";

/** The feature key every analytics route gates on (EPIC-14 catalog, decision D1). */
export const ANALYTICS_FEATURE = "analytics";

/**
 * Read-only analytics endpoints under `/v1/analytics` (EPIC-14). Five GET
 * axes (`analytics.read`) each return one computed summary object — never a
 * paginated list — over the caller's company only (tenant from the token,
 * never the query — ADR-0001). `POST /export` is gated behind
 * `analytics.manage` (D1: the draft contract's `analytics.export` key does
 * not exist in the generated catalog) and audits before returning the file
 * (D7), emitting no domain event.
 */
@ApiTags("analytics")
@Controller("analytics")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get("business")
  @RequireCapability({ feature: ANALYTICS_FEATURE, permission: "analytics.read" })
  @ApiOperation({
    summary: "Business KPIs + deltas + sparkline",
    operationId: "getBusinessAnalytics",
  })
  @ApiOkResponse({ type: BusinessSummaryDto })
  async business(
    @CurrentUser() principal: RequestPrincipal,
    @Query() query: AnalyticsWindowQueryDto,
  ): Promise<BusinessSummaryDto> {
    return BusinessSummaryDto.from(await this.service.getBusiness(principal, query));
  }

  @Get("products")
  @RequireCapability({ feature: ANALYTICS_FEATURE, permission: "analytics.read" })
  @ApiOperation({ summary: "Top/bottom product performance", operationId: "getProductsAnalytics" })
  @ApiOkResponse({ type: ProductsSummaryDto })
  async products(
    @CurrentUser() principal: RequestPrincipal,
    @Query() query: AnalyticsWindowQueryDto,
  ): Promise<ProductsSummaryDto> {
    return ProductsSummaryDto.from(await this.service.getProducts(principal, query));
  }

  @Get("inventory")
  @RequireCapability({ feature: ANALYTICS_FEATURE, permission: "analytics.read" })
  @ApiOperation({ summary: "Stock health summary", operationId: "getInventoryAnalytics" })
  @ApiOkResponse({ type: InventorySummaryDto })
  async inventory(
    @CurrentUser() principal: RequestPrincipal,
    @Query() query: AnalyticsWindowQueryDto,
  ): Promise<InventorySummaryDto> {
    return InventorySummaryDto.from(await this.service.getInventory(principal, query));
  }

  @Get("staff")
  @RequireCapability({ feature: ANALYTICS_FEATURE, permission: "analytics.read" })
  @ApiOperation({ summary: "Staff performance summary", operationId: "getStaffAnalytics" })
  @ApiOkResponse({ type: StaffSummaryDto })
  async staff(
    @CurrentUser() principal: RequestPrincipal,
    @Query() query: AnalyticsWindowQueryDto,
  ): Promise<StaffSummaryDto> {
    return StaffSummaryDto.from(await this.service.getStaff(principal, query));
  }

  @Get("profitability")
  @RequireCapability({ feature: ANALYTICS_FEATURE, permission: "analytics.read" })
  @ApiOperation({
    summary: "Net income on collected − COGS − expenses (D4)",
    operationId: "getProfitabilityAnalytics",
  })
  @ApiOkResponse({ type: ProfitabilitySummaryDto })
  async profitability(
    @CurrentUser() principal: RequestPrincipal,
    @Query() query: AnalyticsWindowQueryDto,
  ): Promise<ProfitabilitySummaryDto> {
    return ProfitabilitySummaryDto.from(await this.service.getProfitability(principal, query));
  }

  @Post("export")
  @RequireCapability({ feature: ANALYTICS_FEATURE, permission: "analytics.manage" })
  @ApiOperation({
    summary: "Export one axis's computed view as CSV (restricted, audited)",
    operationId: "exportAnalytics",
  })
  async export(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: ExportRequestDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.service.exportAxis(principal, body);
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.status(HttpStatus.OK).send(result.body);
  }
}

import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AccessGuard } from "../../../shared/access/access.guard";
import { RequireCapability } from "../../../shared/access/require-capability.decorator";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { CurrentUser } from "../../../shared/auth/current-user.decorator";
import { JwtAuthGuard } from "../../../shared/auth/jwt-auth.guard";
import { FinanceService } from "../application/finance.service";
import type { RawReportRangeQuery } from "../domain/list-query";
import { CashCenterReportDto, PnlReportDto } from "./dto/finance.dto";
import { FINANCE_FEATURE } from "./suppliers.controller";

/**
 * Read-only finance report endpoints under `/v1/finance/reports` (EPIC-13,
 * M13.5, D6). Both are `finance.read`-gated: pure computed reads over the
 * existing money-moving tables, no ledger of record, no idempotency (they
 * write nothing). The tenant comes from the token, never the payload
 * (ADR-003).
 */
@ApiTags("finance")
@Controller("finance/reports")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class ReportsController {
  constructor(private readonly service: FinanceService) {}

  @Get("cash-center")
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.read" })
  @ApiOperation({
    summary: "Computed cash-center summary over a date range (D6)",
    operationId: "getCashCenterReport",
  })
  @ApiOkResponse({ type: CashCenterReportDto })
  async cashCenter(
    @CurrentUser() principal: RequestPrincipal,
    @Query() rawQuery: RawReportRangeQuery,
  ): Promise<CashCenterReportDto> {
    return CashCenterReportDto.from(await this.service.getCashCenterReport(principal, rawQuery));
  }

  @Get("pnl")
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.read" })
  @ApiOperation({
    summary: "Computed P&L, optionally with a comparison period (D6)",
    operationId: "getPnlReport",
  })
  @ApiOkResponse({ type: PnlReportDto })
  async pnl(
    @CurrentUser() principal: RequestPrincipal,
    @Query() rawQuery: RawReportRangeQuery,
  ): Promise<PnlReportDto> {
    return PnlReportDto.from(await this.service.getPnlReport(principal, rawQuery));
  }
}

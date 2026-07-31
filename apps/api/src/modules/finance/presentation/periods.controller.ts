import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { AccessGuard } from "../../../shared/access/access.guard";
import { RequireCapability } from "../../../shared/access/require-capability.decorator";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { CurrentUser } from "../../../shared/auth/current-user.decorator";
import { JwtAuthGuard } from "../../../shared/auth/jwt-auth.guard";
import { FinanceService } from "../application/finance.service";
import { AccountingPeriodDto } from "./dto/finance.dto";
import { FINANCE_FEATURE } from "./suppliers.controller";

/**
 * Accounting-period endpoints under `/v1/finance/periods` (EPIC-13, M13.5,
 * D4; contract: docs/api/finance.md). All routes require a valid access
 * token and the three-layer {@link AccessGuard}: reads need `finance.read`,
 * the close write needs `finance.manage` (D2 — no bespoke `finance.close`
 * key; the mandatory `period.closed` audit row + event distinguish this
 * sensitive write instead). The tenant comes from the token, never the
 * payload (ADR-003).
 *
 * Close is atomic and sequential: an earlier open period blocks the close
 * (`PeriodSequenceGapError`, 409). Closing an already-closed period is a
 * no-op replay — safe to retry.
 */
@ApiTags("finance")
@Controller("finance/periods")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class PeriodsController {
  constructor(private readonly service: FinanceService) {}

  @Get()
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.read" })
  @ApiOperation({ summary: "List accounting periods", operationId: "listPeriods" })
  @ApiOkResponse({ type: [AccountingPeriodDto] })
  async list(@CurrentUser() principal: RequestPrincipal): Promise<AccountingPeriodDto[]> {
    const rows = await this.service.listPeriods(principal);
    return rows.map((r) => AccountingPeriodDto.from(r));
  }

  @Post(":period/close")
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.manage" })
  @ApiOperation({
    summary: "Atomically close a monthly accounting period (sequential, D4)",
    operationId: "closePeriod",
  })
  @ApiParam({ name: "period", example: "2026-01", description: "YYYY-MM." })
  @ApiOkResponse({ type: AccountingPeriodDto })
  async close(
    @CurrentUser() principal: RequestPrincipal,
    @Param("period") period: string,
  ): Promise<AccountingPeriodDto> {
    return AccountingPeriodDto.from(await this.service.closePeriod(principal, period));
  }
}

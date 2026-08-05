import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AccessGuard } from "../../../shared/access/access.guard";
import { RequireCapability } from "../../../shared/access/require-capability.decorator";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { CurrentUser } from "../../../shared/auth/current-user.decorator";
import { JwtAuthGuard } from "../../../shared/auth/jwt-auth.guard";
import { FinanceService } from "../application/finance.service";
import { TaxSettingsDto, UpdateTaxSettingsDto } from "./dto/finance.dto";
import { FINANCE_FEATURE } from "./suppliers.controller";

/**
 * Tax-settings endpoints under `/v1/finance/tax-settings` (EPIC-13, M13.3,
 * D3; contract: docs/api/finance.md). One row per company; a `GET` before
 * any `PATCH` lazily creates the default zero-rate row. All routes require a
 * valid access token and the three-layer {@link AccessGuard}: reads need
 * `finance.read`, writes `finance.manage`, both under the `finance` feature
 * (D2). The tenant comes from the token, never the payload (ADR-003).
 */
@ApiTags("finance")
@Controller("finance/tax-settings")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class TaxSettingsController {
  constructor(private readonly service: FinanceService) {}

  @Get()
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.read" })
  @ApiOperation({
    summary: "Read the company's tax settings (lazily created)",
    operationId: "getTaxSettings",
  })
  @ApiOkResponse({ type: TaxSettingsDto })
  async get(@CurrentUser() principal: RequestPrincipal): Promise<TaxSettingsDto> {
    return TaxSettingsDto.from(await this.service.getTaxSettings(principal));
  }

  @Patch()
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.manage" })
  @ApiOperation({
    summary: "Update the company's VAT rate / registration number",
    operationId: "updateTaxSettings",
  })
  @ApiOkResponse({ type: TaxSettingsDto })
  async update(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: UpdateTaxSettingsDto,
  ): Promise<TaxSettingsDto> {
    return TaxSettingsDto.from(await this.service.updateTaxSettings(principal, body));
  }
}

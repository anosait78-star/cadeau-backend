import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AccessGuard } from "../../../shared/access/access.guard";
import { RequireCapability } from "../../../shared/access/require-capability.decorator";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { CurrentUser } from "../../../shared/auth/current-user.decorator";
import { JwtAuthGuard } from "../../../shared/auth/jwt-auth.guard";
import { RateLimit } from "../../../shared/rate-limit/rate-limit.decorator";
import { RateLimitGuard } from "../../../shared/rate-limit/rate-limit.guard";
import { VendorPayoutsService, type RawPageQuery } from "../application/vendor-payouts.service";
import {
  LedgerPageDto,
  PayoutDto,
  PayoutPageDto,
  VendorBalanceDto,
} from "./dto/vendor-payouts.dto";
import { VENDOR_PAYOUTS_FEATURE } from "./vendor-payouts.controller";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * A vendor's own account under `/v1/vendor/account` (2026-11-17): their
 * balance, statement and payouts, and "استلمت المبلغ" on a pending payout.
 * `vendor_payouts.read` + the `vendor_payouts` feature (ADR-003); which
 * account is decided by the caller's own warehouse-scoped membership, never
 * the request. Confirming is rate-limited (ADR-001) — it settles money.
 */
@ApiTags("vendor-payouts")
@Controller("vendor/account")
@UseGuards(JwtAuthGuard, AccessGuard, RateLimitGuard)
@ApiBearerAuth()
export class VendorAccountController {
  constructor(private readonly service: VendorPayoutsService) {}

  @Get()
  @RequireCapability({ feature: VENDOR_PAYOUTS_FEATURE, permission: "vendor_payouts.read" })
  @ApiOperation({ summary: "My balance with the company", operationId: "getMyVendorAccount" })
  @ApiOkResponse({ type: VendorBalanceDto })
  async get(@CurrentUser() principal: RequestPrincipal): Promise<VendorBalanceDto> {
    return VendorBalanceDto.from(await this.service.getMyAccount(principal));
  }

  @Get("ledger")
  @RequireCapability({ feature: VENDOR_PAYOUTS_FEATURE, permission: "vendor_payouts.read" })
  @ApiOperation({ summary: "My statement, newest first", operationId: "listMyVendorLedger" })
  @ApiOkResponse({ type: LedgerPageDto })
  async ledger(
    @CurrentUser() principal: RequestPrincipal,
    @Query() raw: RawPageQuery,
  ): Promise<LedgerPageDto> {
    return LedgerPageDto.from(await this.service.listMyLedger(principal, raw));
  }

  @Get("payouts")
  @RequireCapability({ feature: VENDOR_PAYOUTS_FEATURE, permission: "vendor_payouts.read" })
  @ApiOperation({ summary: "My payouts, newest first", operationId: "listMyVendorPayouts" })
  @ApiOkResponse({ type: PayoutPageDto })
  async payouts(
    @CurrentUser() principal: RequestPrincipal,
    @Query() raw: RawPageQuery,
  ): Promise<PayoutPageDto> {
    return PayoutPageDto.from(await this.service.listMyPayouts(principal, raw));
  }

  @Post("payouts/:payoutId/confirm")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 20, windowMs: FIFTEEN_MINUTES_MS })
  @RequireCapability({ feature: VENDOR_PAYOUTS_FEATURE, permission: "vendor_payouts.read" })
  @ApiOperation({
    summary: "Confirm I received a pending payout (settles it)",
    operationId: "confirmMyVendorPayout",
  })
  @ApiOkResponse({ type: PayoutDto })
  async confirm(
    @CurrentUser() principal: RequestPrincipal,
    @Param("payoutId", ParseUUIDPipe) payoutId: string,
  ): Promise<PayoutDto> {
    return PayoutDto.from(await this.service.confirmMyPayout(principal, payoutId));
  }
}

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { AccessGuard } from "../../../shared/access/access.guard";
import { RequireCapability } from "../../../shared/access/require-capability.decorator";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { CurrentUser } from "../../../shared/auth/current-user.decorator";
import { JwtAuthGuard } from "../../../shared/auth/jwt-auth.guard";
import { VendorPayoutsService, type RawPageQuery } from "../application/vendor-payouts.service";
import {
  CreateAdjustmentDto,
  ForceConfirmPayoutDto,
  LedgerEntryDto,
  LedgerPageDto,
  PayoutDto,
  PayoutPageDto,
  RequestPayoutDto,
  VendorBalanceDto,
  VendorBalanceListDto,
} from "./dto/vendor-payouts.dto";

/** The feature key this module is gated under (access catalog). */
export const VENDOR_PAYOUTS_FEATURE = "vendor_payouts";

interface RawPayoutListQuery extends RawPageQuery {
  readonly warehouseId?: string;
}

/**
 * Company-side vendor payouts under `/v1/vendor-payouts` (2026-11-17).
 * Reading needs `vendor_payouts.read`; every money-moving action needs
 * `vendor_payouts.manage`. Both require the `vendor_payouts` feature on the
 * company's plan (ADR-003). A vendor never reaches these routes even with
 * `.read`: the service refuses any warehouse-scoped caller here.
 */
@ApiTags("vendor-payouts")
@Controller("vendor-payouts")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class VendorPayoutsController {
  constructor(private readonly service: VendorPayoutsService) {}

  @Get("vendors")
  @RequireCapability({ feature: VENDOR_PAYOUTS_FEATURE, permission: "vendor_payouts.read" })
  @ApiOperation({
    summary: "Every vendor with what they are owed",
    operationId: "listVendorBalances",
  })
  @ApiOkResponse({ type: VendorBalanceListDto })
  async listVendors(@CurrentUser() principal: RequestPrincipal): Promise<VendorBalanceListDto> {
    return VendorBalanceListDto.from(await this.service.listVendors(principal));
  }

  @Get("vendors/:warehouseId")
  @RequireCapability({ feature: VENDOR_PAYOUTS_FEATURE, permission: "vendor_payouts.read" })
  @ApiOperation({ summary: "One vendor's balance", operationId: "getVendorBalance" })
  @ApiOkResponse({ type: VendorBalanceDto })
  async getVendor(
    @CurrentUser() principal: RequestPrincipal,
    @Param("warehouseId", ParseUUIDPipe) warehouseId: string,
  ): Promise<VendorBalanceDto> {
    return VendorBalanceDto.from(await this.service.getVendor(principal, warehouseId));
  }

  @Get("vendors/:warehouseId/ledger")
  @RequireCapability({ feature: VENDOR_PAYOUTS_FEATURE, permission: "vendor_payouts.read" })
  @ApiOperation({
    summary: "One vendor's statement, newest first",
    operationId: "listVendorLedger",
  })
  @ApiOkResponse({ type: LedgerPageDto })
  async listLedger(
    @CurrentUser() principal: RequestPrincipal,
    @Param("warehouseId", ParseUUIDPipe) warehouseId: string,
    @Query() raw: RawPageQuery,
  ): Promise<LedgerPageDto> {
    return LedgerPageDto.from(await this.service.listVendorLedger(principal, warehouseId, raw));
  }

  @Get("payouts")
  @RequireCapability({ feature: VENDOR_PAYOUTS_FEATURE, permission: "vendor_payouts.read" })
  @ApiOperation({
    summary: "Payouts, newest first (optionally one vendor's)",
    operationId: "listVendorPayouts",
  })
  @ApiOkResponse({ type: PayoutPageDto })
  async listPayouts(
    @CurrentUser() principal: RequestPrincipal,
    @Query() raw: RawPayoutListQuery,
  ): Promise<PayoutPageDto> {
    return PayoutPageDto.from(
      await this.service.listCompanyPayouts(principal, raw.warehouseId, raw),
    );
  }

  @Post("vendors/:warehouseId/payouts")
  @RequireCapability({ feature: VENDOR_PAYOUTS_FEATURE, permission: "vendor_payouts.manage" })
  @ApiOperation({
    summary: "Request a payout of everything owed (Idempotency-Key mandatory)",
    operationId: "requestVendorPayout",
  })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiCreatedResponse({ type: PayoutDto })
  async requestPayout(
    @CurrentUser() principal: RequestPrincipal,
    @Param("warehouseId", ParseUUIDPipe) warehouseId: string,
    @Body() body: RequestPayoutDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PayoutDto> {
    const { payout, replayed } = await this.service.requestPayout(principal, warehouseId, {
      ...body,
      idempotencyKey,
    });
    res.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return PayoutDto.from(payout);
  }

  @Post("payouts/:payoutId/cancel")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: VENDOR_PAYOUTS_FEATURE, permission: "vendor_payouts.manage" })
  @ApiOperation({ summary: "Cancel a pending payout", operationId: "cancelVendorPayout" })
  @ApiOkResponse({ type: PayoutDto })
  async cancel(
    @CurrentUser() principal: RequestPrincipal,
    @Param("payoutId", ParseUUIDPipe) payoutId: string,
  ): Promise<PayoutDto> {
    return PayoutDto.from(await this.service.cancelPayout(principal, payoutId));
  }

  @Post("payouts/:payoutId/force-confirm")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: VENDOR_PAYOUTS_FEATURE, permission: "vendor_payouts.manage" })
  @ApiOperation({
    summary: "Confirm a pending payout on the vendor's behalf, with a reason",
    operationId: "forceConfirmVendorPayout",
  })
  @ApiOkResponse({ type: PayoutDto })
  async forceConfirm(
    @CurrentUser() principal: RequestPrincipal,
    @Param("payoutId", ParseUUIDPipe) payoutId: string,
    @Body() body: ForceConfirmPayoutDto,
  ): Promise<PayoutDto> {
    return PayoutDto.from(await this.service.forceConfirmPayout(principal, payoutId, body.reason));
  }

  @Post("vendors/:warehouseId/adjustments")
  @RequireCapability({ feature: VENDOR_PAYOUTS_FEATURE, permission: "vendor_payouts.manage" })
  @ApiOperation({
    summary: "Post a manual correction on a vendor's account",
    operationId: "createVendorAdjustment",
  })
  @ApiCreatedResponse({ type: LedgerEntryDto })
  async createAdjustment(
    @CurrentUser() principal: RequestPrincipal,
    @Param("warehouseId", ParseUUIDPipe) warehouseId: string,
    @Body() body: CreateAdjustmentDto,
  ): Promise<LedgerEntryDto> {
    return LedgerEntryDto.from(await this.service.createAdjustment(principal, warehouseId, body));
  }
}

import {
  Body,
  Controller,
  Get,
  Headers,
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
import { FinanceService } from "../application/finance.service";
import type { RawPurchaseOrderListQuery } from "../domain/list-query";
import {
  CreatePaymentDto,
  CreatePurchaseOrderDto,
  CreateReceiptDto,
  PurchaseOrderDto,
  PurchaseOrderListDtoPage,
  PurchaseOrderPaymentDto,
  PurchaseOrderReceiptDto,
} from "./dto/finance.dto";
import { FINANCE_FEATURE } from "./suppliers.controller";

/** The idempotency header (api-conventions §Idempotency). */
const IDEMPOTENCY_HEADER = "Idempotency-Key";

/**
 * Purchase-order endpoints under `/v1/finance/purchase-orders` (EPIC-13,
 * M13.2; contract: docs/api/finance.md). All routes require a valid access
 * token and the three-layer {@link AccessGuard}: reads need `finance.read`,
 * writes `finance.manage`, both under the `finance` feature (D2). The tenant
 * comes from the token, never the payload (ADR-003).
 *
 * Creation, receipts, and payments honour `Idempotency-Key`: the key is
 * stored with the write, so a retried request returns the original result
 * instead of moving stock or money twice.
 */
@ApiTags("finance")
@Controller("finance/purchase-orders")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class PurchaseOrdersController {
  constructor(private readonly service: FinanceService) {}

  @Get()
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.read" })
  @ApiOperation({
    summary: "List purchase orders (keyset, filtered)",
    operationId: "listPurchaseOrders",
  })
  @ApiOkResponse({ type: PurchaseOrderListDtoPage })
  async list(
    @CurrentUser() principal: RequestPrincipal,
    @Query() rawQuery: RawPurchaseOrderListQuery,
  ): Promise<PurchaseOrderListDtoPage> {
    return PurchaseOrderListDtoPage.from(
      await this.service.listPurchaseOrders(principal, rawQuery),
    );
  }

  @Get(":poId")
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.read" })
  @ApiOperation({ summary: "Purchase order detail (with lines)", operationId: "getPurchaseOrder" })
  @ApiOkResponse({ type: PurchaseOrderDto })
  async getOne(
    @CurrentUser() principal: RequestPrincipal,
    @Param("poId", ParseUUIDPipe) poId: string,
  ): Promise<PurchaseOrderDto> {
    return PurchaseOrderDto.from(await this.service.getPurchaseOrder(principal, poId));
  }

  @Post()
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.manage" })
  @ApiOperation({
    summary: "Create a purchase order (with lines)",
    operationId: "createPurchaseOrder",
  })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: false })
  @ApiCreatedResponse({ type: PurchaseOrderDto })
  async create(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: CreatePurchaseOrderDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PurchaseOrderDto> {
    const row = await this.service.createPurchaseOrder(principal, {
      ...body,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
    res.status(HttpStatus.CREATED);
    res.setHeader("Location", `/v1/finance/purchase-orders/${row.id}`);
    return PurchaseOrderDto.from(row);
  }

  @Post(":poId/receipts")
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.manage" })
  @ApiOperation({
    summary: "Record an atomic receipt (raises stock, rolls averageCost)",
    operationId: "receivePurchaseOrder",
  })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: false })
  @ApiCreatedResponse({ type: PurchaseOrderReceiptDto })
  async receive(
    @CurrentUser() principal: RequestPrincipal,
    @Param("poId", ParseUUIDPipe) poId: string,
    @Body() body: CreateReceiptDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PurchaseOrderReceiptDto> {
    const row = await this.service.receivePurchaseOrder(principal, poId, {
      ...body,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
    res.status(HttpStatus.CREATED);
    return PurchaseOrderReceiptDto.from(row);
  }

  @Post(":poId/payments")
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.manage" })
  @ApiOperation({ summary: "Record a (partial) payment", operationId: "payPurchaseOrder" })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: false })
  @ApiCreatedResponse({ type: PurchaseOrderPaymentDto })
  async pay(
    @CurrentUser() principal: RequestPrincipal,
    @Param("poId", ParseUUIDPipe) poId: string,
    @Body() body: CreatePaymentDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PurchaseOrderPaymentDto> {
    const row = await this.service.payPurchaseOrder(principal, poId, {
      ...body,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
    res.status(HttpStatus.CREATED);
    return PurchaseOrderPaymentDto.from(row);
  }
}

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
import type { RawReconciliationListQuery } from "../domain/list-query";
import {
  CreateReconciliationDto,
  ReconciliationDto,
  ReconciliationListDtoPage,
} from "./dto/finance.dto";
import { FINANCE_FEATURE } from "./suppliers.controller";

/** The idempotency header (api-conventions §Idempotency). */
const IDEMPOTENCY_HEADER = "Idempotency-Key";

/**
 * Shipping-reconciliation endpoints under `/v1/finance/reconciliations`
 * (EPIC-13, M13.5, D5; contract: docs/api/finance.md). All routes require a
 * valid access token and the three-layer {@link AccessGuard}: reads need
 * `finance.read`, writes `finance.manage`, both under the `finance` feature
 * (D2). The tenant comes from the token, never the payload (ADR-003).
 *
 * Creation matches every statement line to a shipment by
 * `(companyId, carrier, trackingNumber)` and is atomic: one unmatched
 * tracking number rejects the whole batch (D5). `Idempotency-Key` is
 * optional but replayed exactly like the other finance writes.
 */
@ApiTags("finance")
@Controller("finance/reconciliations")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class ReconciliationsController {
  constructor(private readonly service: FinanceService) {}

  @Get()
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.read" })
  @ApiOperation({
    summary: "List shipping reconciliations (keyset, filtered)",
    operationId: "listReconciliations",
  })
  @ApiOkResponse({ type: ReconciliationListDtoPage })
  async list(
    @CurrentUser() principal: RequestPrincipal,
    @Query() rawQuery: RawReconciliationListQuery,
  ): Promise<ReconciliationListDtoPage> {
    return ReconciliationListDtoPage.from(
      await this.service.listReconciliations(principal, rawQuery),
    );
  }

  @Get(":reconciliationId")
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.read" })
  @ApiOperation({ summary: "Reconciliation detail", operationId: "getReconciliation" })
  @ApiOkResponse({ type: ReconciliationDto })
  async getOne(
    @CurrentUser() principal: RequestPrincipal,
    @Param("reconciliationId", ParseUUIDPipe) reconciliationId: string,
  ): Promise<ReconciliationDto> {
    return ReconciliationDto.from(
      await this.service.getReconciliation(principal, reconciliationId),
    );
  }

  @Post()
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.manage" })
  @ApiOperation({
    summary: "Reconcile a carrier statement batch against shipments",
    operationId: "createReconciliation",
  })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: false })
  @ApiCreatedResponse({ type: ReconciliationDto })
  async create(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: CreateReconciliationDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReconciliationDto> {
    const row = await this.service.createReconciliation(principal, {
      ...body,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
    res.status(HttpStatus.CREATED);
    res.setHeader("Location", `/v1/finance/reconciliations/${row.id}`);
    return ReconciliationDto.from(row);
  }
}

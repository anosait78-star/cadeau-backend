import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
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
import type { RawRefundListQuery } from "../domain/list-query";
import { CreateRefundDto, RefundDto, RefundListDtoPage } from "./dto/finance.dto";
import { FINANCE_FEATURE } from "./suppliers.controller";

/** The idempotency header (api-conventions §Idempotency). */
const IDEMPOTENCY_HEADER = "Idempotency-Key";

/**
 * Refund endpoints under `/v1/finance/refunds` (EPIC-13, M13.4; contract:
 * docs/api/finance.md). All routes require a valid access token and the
 * three-layer {@link AccessGuard}: reads need `finance.read`, writes
 * `finance.manage`, both under the `finance` feature (D2). The tenant comes
 * from the token, never the payload (ADR-003).
 *
 * Unlike every other finance write, `Idempotency-Key` is **mandatory** on
 * refund issue — the DB column is `NOT NULL` and a refund is money-out,
 * irreversible. A missing header is rejected with `400` before any write is
 * attempted (D2 rationale: money-moving safety via mandatory idempotency +
 * distinct audit action, not a bespoke permission key).
 */
@ApiTags("finance")
@Controller("finance/refunds")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class RefundsController {
  constructor(private readonly service: FinanceService) {}

  @Get()
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.read" })
  @ApiOperation({ summary: "List refunds (keyset, filtered)", operationId: "listRefunds" })
  @ApiOkResponse({ type: RefundListDtoPage })
  async list(
    @CurrentUser() principal: RequestPrincipal,
    @Query() rawQuery: RawRefundListQuery,
  ): Promise<RefundListDtoPage> {
    return RefundListDtoPage.from(await this.service.listRefunds(principal, rawQuery));
  }

  @Post()
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.manage" })
  @ApiOperation({
    summary: "Issue a refund (Idempotency-Key mandatory)",
    operationId: "createRefund",
  })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true })
  @ApiCreatedResponse({ type: RefundDto })
  async create(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: CreateRefundDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefundDto> {
    const row = await this.service.createRefund(principal, {
      ...body,
      idempotencyKey,
    });
    res.status(HttpStatus.CREATED);
    res.setHeader("Location", `/v1/finance/refunds/${row.id}`);
    return RefundDto.from(row);
  }
}

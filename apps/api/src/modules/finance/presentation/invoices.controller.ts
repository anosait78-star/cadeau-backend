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
import type { RawInvoiceListQuery } from "../domain/list-query";
import { renderInvoicePdf } from "../infrastructure/invoice-pdf.renderer";
import { CreateInvoiceDto, InvoiceDto, InvoiceListDtoPage } from "./dto/finance.dto";
import { FINANCE_FEATURE } from "./suppliers.controller";

/** The idempotency header (api-conventions §Idempotency). */
const IDEMPOTENCY_HEADER = "Idempotency-Key";

/**
 * Invoice endpoints under `/v1/finance/invoices` (EPIC-13, M13.4; contract:
 * docs/api/finance.md). All routes require a valid access token and the
 * three-layer {@link AccessGuard}: reads need `finance.read`, writes
 * `finance.manage`, both under the `finance` feature (D2). The tenant comes
 * from the token, never the payload (ADR-003).
 *
 * Issuing an invoice honours `Idempotency-Key` (optional, replayed on
 * match, same discipline as PO create). The PDF renderer
 * ({@link renderInvoicePdf}) is a pure function of the data the service
 * gathers — kept out of the repository/service so it stays unit-testable in
 * isolation; this controller is its only caller.
 */
@ApiTags("finance")
@Controller("finance/invoices")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class InvoicesController {
  constructor(private readonly service: FinanceService) {}

  @Get()
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.read" })
  @ApiOperation({ summary: "List invoices (keyset, filtered)", operationId: "listInvoices" })
  @ApiOkResponse({ type: InvoiceListDtoPage })
  async list(
    @CurrentUser() principal: RequestPrincipal,
    @Query() rawQuery: RawInvoiceListQuery,
  ): Promise<InvoiceListDtoPage> {
    return InvoiceListDtoPage.from(await this.service.listInvoices(principal, rawQuery));
  }

  @Get(":invoiceId")
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.read" })
  @ApiOperation({ summary: "Invoice detail (with lines)", operationId: "getInvoice" })
  @ApiOkResponse({ type: InvoiceDto })
  async getOne(
    @CurrentUser() principal: RequestPrincipal,
    @Param("invoiceId", ParseUUIDPipe) invoiceId: string,
  ): Promise<InvoiceDto> {
    return InvoiceDto.from(await this.service.getInvoice(principal, invoiceId));
  }

  @Post()
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.manage" })
  @ApiOperation({
    summary: "Issue an invoice (order-based or manual lines; VAT computed)",
    operationId: "createInvoice",
  })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: false })
  @ApiCreatedResponse({ type: InvoiceDto })
  async create(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: CreateInvoiceDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<InvoiceDto> {
    const row = await this.service.createInvoice(principal, {
      ...(body.orderId === undefined ? {} : { orderId: body.orderId }),
      ...(body.lines === undefined ? {} : { lines: body.lines }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
    res.status(HttpStatus.CREATED);
    res.setHeader("Location", `/v1/finance/invoices/${row.id}`);
    return InvoiceDto.from(row);
  }

  @Get(":invoiceId/pdf")
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.read" })
  @ApiOperation({ summary: "Stream the official invoice PDF", operationId: "getInvoicePdf" })
  async getPdf(
    @CurrentUser() principal: RequestPrincipal,
    @Param("invoiceId", ParseUUIDPipe) invoiceId: string,
    @Res() res: Response,
  ): Promise<void> {
    const data = await this.service.getInvoicePdfData(principal, invoiceId);
    const buffer = await renderInvoicePdf(data);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="invoice-${data.invoice.number}.pdf"`,
    );
    res.status(HttpStatus.OK).send(buffer);
  }
}

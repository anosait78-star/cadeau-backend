import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import type { RawExpenseListQuery } from "../domain/list-query";
import { CreateExpenseDto, ExpenseDto, ExpenseListDto, UpdateExpenseDto } from "./dto/finance.dto";
import { FINANCE_FEATURE } from "./suppliers.controller";

/** The idempotency header (api-conventions §Idempotency). */
const IDEMPOTENCY_HEADER = "Idempotency-Key";

/**
 * Expense endpoints under `/v1/finance/expenses` (EPIC-13, M13.3; contract:
 * docs/api/finance.md). All routes require a valid access token and the
 * three-layer {@link AccessGuard}: reads need `finance.read`, writes
 * `finance.manage`, both under the `finance` feature (D2). The tenant comes
 * from the token, never the payload (ADR-003).
 *
 * Creation honours `Idempotency-Key`: the key is stored with the write, so a
 * retried request returns the original result instead of recording the
 * expense twice. There is no delete route — expenses are simple dated
 * records with no archival state, and editing (not deleting) is how a
 * mistaken entry is corrected while its accounting period is still open
 * (closed-period edits/deletes are out of scope per the design doc).
 */
@ApiTags("finance")
@Controller("finance/expenses")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class ExpensesController {
  constructor(private readonly service: FinanceService) {}

  @Get()
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.read" })
  @ApiOperation({ summary: "List expenses (keyset, filtered)", operationId: "listExpenses" })
  @ApiOkResponse({ type: ExpenseListDto })
  async list(
    @CurrentUser() principal: RequestPrincipal,
    @Query() rawQuery: RawExpenseListQuery,
  ): Promise<ExpenseListDto> {
    return ExpenseListDto.from(await this.service.listExpenses(principal, rawQuery));
  }

  @Get(":expenseId")
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.read" })
  @ApiOperation({ summary: "Expense detail", operationId: "getExpense" })
  @ApiOkResponse({ type: ExpenseDto })
  async getOne(
    @CurrentUser() principal: RequestPrincipal,
    @Param("expenseId", ParseUUIDPipe) expenseId: string,
  ): Promise<ExpenseDto> {
    return ExpenseDto.from(await this.service.getExpense(principal, expenseId));
  }

  @Post()
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.manage" })
  @ApiOperation({ summary: "Record an expense", operationId: "createExpense" })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: false })
  @ApiCreatedResponse({ type: ExpenseDto })
  async create(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: CreateExpenseDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ExpenseDto> {
    const row = await this.service.createExpense(principal, {
      ...body,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
    res.status(HttpStatus.CREATED);
    res.setHeader("Location", `/v1/finance/expenses/${row.id}`);
    return ExpenseDto.from(row);
  }

  @Patch(":expenseId")
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.manage" })
  @ApiOperation({ summary: "Update an expense's mutable fields", operationId: "updateExpense" })
  @ApiOkResponse({ type: ExpenseDto })
  async update(
    @CurrentUser() principal: RequestPrincipal,
    @Param("expenseId", ParseUUIDPipe) expenseId: string,
    @Body() body: UpdateExpenseDto,
  ): Promise<ExpenseDto> {
    return ExpenseDto.from(await this.service.updateExpense(principal, expenseId, body));
  }
}

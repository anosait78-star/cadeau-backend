import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import type { RawSupplierListQuery } from "../domain/list-query";
import {
  CreateSupplierDto,
  SupplierDto,
  SupplierListDto,
  UpdateSupplierDto,
} from "./dto/finance.dto";

/** The feature key both finance controllers gate on (EPIC-5 catalog, decision D2). */
export const FINANCE_FEATURE = "finance";

/**
 * Supplier endpoints under `/v1/finance/suppliers` (EPIC-13, M13.2; contract:
 * docs/api/finance.md). All routes require a valid access token and the
 * three-layer {@link AccessGuard}: reads need `finance.read`, writes
 * `finance.manage`, both under the `finance` feature (D2). The tenant comes
 * from the token, never the payload (ADR-003).
 */
@ApiTags("finance")
@Controller("finance/suppliers")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class SuppliersController {
  constructor(private readonly service: FinanceService) {}

  @Get()
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.read" })
  @ApiOperation({ summary: "List suppliers (keyset, filtered)", operationId: "listSuppliers" })
  @ApiOkResponse({ type: SupplierListDto })
  async list(
    @CurrentUser() principal: RequestPrincipal,
    @Query() rawQuery: RawSupplierListQuery,
  ): Promise<SupplierListDto> {
    return SupplierListDto.from(await this.service.listSuppliers(principal, rawQuery));
  }

  @Get(":supplierId")
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.read" })
  @ApiOperation({ summary: "Supplier detail", operationId: "getSupplier" })
  @ApiOkResponse({ type: SupplierDto })
  async getOne(
    @CurrentUser() principal: RequestPrincipal,
    @Param("supplierId", ParseUUIDPipe) supplierId: string,
  ): Promise<SupplierDto> {
    return SupplierDto.from(await this.service.getSupplier(principal, supplierId));
  }

  @Post()
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.manage" })
  @ApiOperation({ summary: "Create a supplier", operationId: "createSupplier" })
  @ApiCreatedResponse({ type: SupplierDto })
  async create(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: CreateSupplierDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SupplierDto> {
    const row = await this.service.createSupplier(principal, body);
    res.status(HttpStatus.CREATED);
    res.setHeader("Location", `/v1/finance/suppliers/${row.id}`);
    return SupplierDto.from(row);
  }

  @Patch(":supplierId")
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.manage" })
  @ApiOperation({ summary: "Update a supplier", operationId: "updateSupplier" })
  @ApiOkResponse({ type: SupplierDto })
  async update(
    @CurrentUser() principal: RequestPrincipal,
    @Param("supplierId", ParseUUIDPipe) supplierId: string,
    @Body() body: UpdateSupplierDto,
  ): Promise<SupplierDto> {
    return SupplierDto.from(await this.service.updateSupplier(principal, supplierId, body));
  }

  @Delete(":supplierId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireCapability({ feature: FINANCE_FEATURE, permission: "finance.manage" })
  @ApiOperation({ summary: "Archive a supplier (soft-delete)", operationId: "archiveSupplier" })
  async archive(
    @CurrentUser() principal: RequestPrincipal,
    @Param("supplierId", ParseUUIDPipe) supplierId: string,
  ): Promise<void> {
    await this.service.archiveSupplier(principal, supplierId);
  }
}

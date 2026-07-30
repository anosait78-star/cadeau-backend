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
import { InventoryService } from "../application/inventory.service";
import type { RawWarehouseListQuery } from "../domain/list-query";
import {
  CreateWarehouseDto,
  UpdateWarehouseDto,
  WarehouseDto,
  WarehouseListDto,
} from "./dto/inventory.dto";

/** The feature key both inventory controllers gate on (EPIC-5 catalog). */
export const INVENTORY_FEATURE = "inventory";

/**
 * Warehouse endpoints under `/v1/warehouses` (contract: docs/api/inventory.md).
 * All routes require a valid access token and the three-layer
 * {@link AccessGuard}: reads need `inventory.read`, writes `inventory.manage`,
 * both under the `inventory` feature. The tenant comes from the token, never the
 * payload (ADR-003).
 */
@ApiTags("inventory")
@Controller("warehouses")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class WarehousesController {
  constructor(private readonly service: InventoryService) {}

  @Get()
  @RequireCapability({ feature: INVENTORY_FEATURE, permission: "inventory.read" })
  @ApiOperation({ summary: "List warehouses (keyset, filtered)", operationId: "listWarehouses" })
  @ApiOkResponse({ type: WarehouseListDto })
  async list(
    @CurrentUser() principal: RequestPrincipal,
    @Query() rawQuery: RawWarehouseListQuery,
  ): Promise<WarehouseListDto> {
    return WarehouseListDto.from(await this.service.listWarehouses(principal, rawQuery));
  }

  @Get(":warehouseId")
  @RequireCapability({ feature: INVENTORY_FEATURE, permission: "inventory.read" })
  @ApiOperation({ summary: "Warehouse detail", operationId: "getWarehouse" })
  @ApiOkResponse({ type: WarehouseDto })
  async getOne(
    @CurrentUser() principal: RequestPrincipal,
    @Param("warehouseId", ParseUUIDPipe) warehouseId: string,
  ): Promise<WarehouseDto> {
    return WarehouseDto.from(await this.service.getWarehouse(principal, warehouseId));
  }

  @Post()
  @RequireCapability({ feature: INVENTORY_FEATURE, permission: "inventory.manage" })
  @ApiOperation({ summary: "Create a warehouse", operationId: "createWarehouse" })
  @ApiCreatedResponse({ type: WarehouseDto })
  async create(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: CreateWarehouseDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WarehouseDto> {
    const row = await this.service.createWarehouse(principal, body);
    res.status(HttpStatus.CREATED);
    res.setHeader("Location", `/v1/warehouses/${row.id}`);
    return WarehouseDto.from(row);
  }

  @Patch(":warehouseId")
  @RequireCapability({ feature: INVENTORY_FEATURE, permission: "inventory.manage" })
  @ApiOperation({ summary: "Update a warehouse", operationId: "updateWarehouse" })
  @ApiOkResponse({ type: WarehouseDto })
  async update(
    @CurrentUser() principal: RequestPrincipal,
    @Param("warehouseId", ParseUUIDPipe) warehouseId: string,
    @Body() body: UpdateWarehouseDto,
  ): Promise<WarehouseDto> {
    return WarehouseDto.from(await this.service.updateWarehouse(principal, warehouseId, body));
  }

  @Delete(":warehouseId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireCapability({ feature: INVENTORY_FEATURE, permission: "inventory.manage" })
  @ApiOperation({ summary: "Archive a warehouse (soft-delete)", operationId: "archiveWarehouse" })
  async archive(
    @CurrentUser() principal: RequestPrincipal,
    @Param("warehouseId", ParseUUIDPipe) warehouseId: string,
  ): Promise<void> {
    await this.service.archiveWarehouse(principal, warehouseId);
  }
}

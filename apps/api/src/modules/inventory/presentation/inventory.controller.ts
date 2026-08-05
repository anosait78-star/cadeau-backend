import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { InventoryService } from "../application/inventory.service";
import type { RawStockListQuery } from "../domain/list-query";
import {
  AdjustmentDto,
  CreateAdjustmentDto,
  CreateReservationDto,
  CreateTransferDto,
  ReservationDto,
  SetReorderPointDto,
  StockLevelDto,
  StockListDto,
  TransferDto,
} from "./dto/inventory.dto";
import { INVENTORY_FEATURE } from "./warehouses.controller";

/** The idempotency header (api-conventions §Idempotency). */
const IDEMPOTENCY_HEADER = "Idempotency-Key";

/**
 * Stock endpoints under `/v1/inventory` (contract: docs/api/inventory.md). All
 * routes require a valid access token and the three-layer {@link AccessGuard}:
 * reads need `inventory.read`, stock writes `inventory.manage`, both under the
 * `inventory` feature. The tenant comes from the token, never the payload
 * (ADR-003).
 *
 * The three stock-moving `POST`s honour `Idempotency-Key`: the key is stored
 * with the write, so a retried request returns the original result and the stock
 * moves exactly once.
 */
@ApiTags("inventory")
@Controller("inventory")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Get("stock")
  @RequireCapability({ feature: INVENTORY_FEATURE, permission: "inventory.read" })
  @ApiOperation({ summary: "List stock levels (keyset, filtered)", operationId: "listStock" })
  @ApiOkResponse({ type: StockListDto })
  async listStock(
    @CurrentUser() principal: RequestPrincipal,
    @Query() rawQuery: RawStockListQuery,
  ): Promise<StockListDto> {
    return StockListDto.from(await this.service.listStock(principal, rawQuery));
  }

  @Put("reorder-points")
  @RequireCapability({ feature: INVENTORY_FEATURE, permission: "inventory.manage" })
  @ApiOperation({
    summary: "Set a level's low-stock threshold",
    operationId: "setReorderPoint",
  })
  @ApiOkResponse({ type: StockLevelDto })
  async setReorderPoint(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: SetReorderPointDto,
  ): Promise<StockLevelDto> {
    return StockLevelDto.from(await this.service.setReorderPoint(principal, body));
  }

  @Post("reservations")
  @RequireCapability({ feature: INVENTORY_FEATURE, permission: "inventory.manage" })
  @ApiOperation({ summary: "Reserve stock (atomic)", operationId: "createReservation" })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: false })
  @ApiCreatedResponse({ type: ReservationDto })
  async reserve(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: CreateReservationDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReservationDto> {
    const row = await this.service.reserve(principal, {
      ...body,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
    res.status(HttpStatus.CREATED);
    res.setHeader("Location", `/v1/inventory/reservations/${row.id}`);
    return ReservationDto.from(row);
  }

  @Delete("reservations/:reservationId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireCapability({ feature: INVENTORY_FEATURE, permission: "inventory.manage" })
  @ApiOperation({ summary: "Release a reservation (atomic)", operationId: "releaseReservation" })
  async release(
    @CurrentUser() principal: RequestPrincipal,
    @Param("reservationId", ParseUUIDPipe) reservationId: string,
  ): Promise<void> {
    await this.service.release(principal, reservationId);
  }

  @Post("transfers")
  @RequireCapability({ feature: INVENTORY_FEATURE, permission: "inventory.manage" })
  @ApiOperation({
    summary: "Transfer stock between warehouses (atomic)",
    operationId: "createTransfer",
  })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: false })
  @ApiCreatedResponse({ type: TransferDto })
  async transfer(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: CreateTransferDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransferDto> {
    const row = await this.service.transfer(principal, {
      ...body,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
    res.status(HttpStatus.CREATED);
    return TransferDto.from(row);
  }

  @Post("adjustments")
  @RequireCapability({ feature: INVENTORY_FEATURE, permission: "inventory.manage" })
  @ApiOperation({ summary: "Adjust stock with a reason (atomic)", operationId: "createAdjustment" })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: false })
  @ApiCreatedResponse({ type: AdjustmentDto })
  async adjust(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: CreateAdjustmentDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdjustmentDto> {
    const row = await this.service.adjust(principal, {
      ...body,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
    res.status(HttpStatus.CREATED);
    return AdjustmentDto.from(row);
  }
}

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
import { ShippingService } from "../application/shipping.service";
import {
  BulkCreateShipmentDto,
  BulkShipmentResultDto,
  CarrierListDto,
  CreateShipmentDto,
  ShipmentDto,
  TransitionShipmentDto,
  WaybillDto,
} from "./dto/shipping.dto";

/** The feature key this module is gated under (access catalog). */
const SHIPPING_FEATURE = "shipping";

/** The idempotency header (api-conventions §Idempotency). */
const IDEMPOTENCY_HEADER = "Idempotency-Key";

/**
 * Shipping endpoints under `/v1/shipping` (contract: docs/api/shipping.md).
 * Every route requires a valid access token and the three-layer
 * {@link AccessGuard}: reads need `shipping.read`, every write needs
 * `shipping.manage` (the established read/manage convention — EPIC-11 D1).
 * The tenant comes from the token, never the payload (ADR-003).
 *
 * `POST /v1/shipping/shipments` honours `Idempotency-Key`: a retry replays the
 * original shipment (`200`, not `201`) and writes no audit row / event. The
 * inbound carrier webhook is a separate, unauthenticated route added in M12.4
 * (signature-verified instead of JWT-gated) — not part of this controller.
 */
@ApiTags("shipping")
@Controller("shipping")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class ShippingController {
  constructor(private readonly service: ShippingService) {}

  @Get("carriers")
  @RequireCapability({ feature: SHIPPING_FEATURE, permission: "shipping.read" })
  @ApiOperation({ summary: "Available carriers", operationId: "listCarriers" })
  @ApiOkResponse({ type: CarrierListDto })
  listCarriers(@CurrentUser() principal: RequestPrincipal): CarrierListDto {
    return CarrierListDto.from(this.service.listCarriers(principal));
  }

  @Post("shipments")
  @RequireCapability({ feature: SHIPPING_FEATURE, permission: "shipping.manage" })
  @ApiOperation({ summary: "Create a shipment for an order", operationId: "createShipment" })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: false })
  @ApiCreatedResponse({ type: ShipmentDto })
  async create(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: CreateShipmentDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ShipmentDto> {
    const { shipment, replayed } = await this.service.create(principal, {
      orderId: body.orderId,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
    res.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    res.setHeader("Location", `/v1/shipping/shipments/${shipment.id}`);
    return ShipmentDto.from(shipment);
  }

  @Post("shipments/bulk")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: SHIPPING_FEATURE, permission: "shipping.manage" })
  @ApiOperation({
    summary: "Bulk-create shipments (per-item results)",
    operationId: "bulkCreateShipments",
  })
  @ApiOkResponse({ type: BulkShipmentResultDto })
  async bulkCreate(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: BulkCreateShipmentDto,
  ): Promise<BulkShipmentResultDto> {
    const results = await this.service.bulkCreate(
      principal,
      body.orderIds.map((orderId) => ({ orderId })),
    );
    return BulkShipmentResultDto.from(results);
  }

  @Get("shipments/:shipmentId")
  @RequireCapability({ feature: SHIPPING_FEATURE, permission: "shipping.read" })
  @ApiOperation({ summary: "Shipment detail + tracking", operationId: "getShipment" })
  @ApiOkResponse({ type: ShipmentDto })
  async getOne(
    @CurrentUser() principal: RequestPrincipal,
    @Param("shipmentId", ParseUUIDPipe) shipmentId: string,
  ): Promise<ShipmentDto> {
    return ShipmentDto.from(await this.service.getOne(principal, shipmentId));
  }

  @Get("orders/:orderId/shipment")
  @RequireCapability({ feature: SHIPPING_FEATURE, permission: "shipping.read" })
  @ApiOperation({
    summary: "The most recent shipment for an order (M12.5 order-detail tracking)",
    operationId: "getShipmentForOrder",
  })
  @ApiOkResponse({ type: ShipmentDto })
  async getByOrder(
    @CurrentUser() principal: RequestPrincipal,
    @Param("orderId", ParseUUIDPipe) orderId: string,
  ): Promise<ShipmentDto> {
    return ShipmentDto.from(await this.service.getByOrder(principal, orderId));
  }

  @Post("shipments/:shipmentId/status")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: SHIPPING_FEATURE, permission: "shipping.manage" })
  @ApiOperation({
    summary: "Transition shipment status (also used to cancel)",
    operationId: "transitionShipment",
  })
  @ApiOkResponse({ type: ShipmentDto })
  async transition(
    @CurrentUser() principal: RequestPrincipal,
    @Param("shipmentId", ParseUUIDPipe) shipmentId: string,
    @Body() body: TransitionShipmentDto,
  ): Promise<ShipmentDto> {
    return ShipmentDto.from(
      await this.service.transition(principal, shipmentId, {
        toStatus: body.toStatus,
        ...(body.note !== undefined ? { note: body.note } : {}),
      }),
    );
  }

  @Post("shipments/:shipmentId/waybill")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: SHIPPING_FEATURE, permission: "shipping.manage" })
  @ApiOperation({
    summary: "Waybill metadata (no PDF in this epic, see docs/api/shipping.md)",
    operationId: "generateWaybill",
  })
  @ApiOkResponse({ type: WaybillDto })
  async generateWaybill(
    @CurrentUser() principal: RequestPrincipal,
    @Param("shipmentId", ParseUUIDPipe) shipmentId: string,
  ): Promise<WaybillDto> {
    return WaybillDto.from(await this.service.generateWaybill(principal, shipmentId));
  }
}

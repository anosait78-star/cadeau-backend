import {
  Body,
  Controller,
  Get,
  Headers,
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
import { OrdersService } from "../application/orders.service";
import type { RawOrderListQuery } from "../domain/list-query";
import {
  AssignOrderDto,
  BulkAssignDto,
  BulkResultDto,
  BulkStatusDto,
  CreateOrderDto,
  ImportOrdersDto,
  ImportResultDto,
  OrderActivityListDto,
  OrderDto,
  OrderListDto,
  OrderStatusCountsDto,
  ParseOrderDto,
  ParsedDraftDto,
  TransitionOrderDto,
  UpdateOrderDto,
} from "./dto/orders.dto";

/** The feature key this module is gated under (access catalog). */
const ORDERS_FEATURE = "orders";

/** The idempotency header (api-conventions §Idempotency). */
const IDEMPOTENCY_HEADER = "Idempotency-Key";

/**
 * Order endpoints under `/v1/orders` (contract: docs/api/orders.md). Every route
 * requires a valid access token and the three-layer {@link AccessGuard}: reads
 * need `orders.read`, every write needs `orders.manage` (decision D1 — the
 * catalog defines only `read`/`manage`, so status/assign/import fold into
 * `manage`). The tenant comes from the token, never the payload (ADR-003).
 *
 * `POST /v1/orders` honours `Idempotency-Key` (the EPIC-9/10 pattern): a retry
 * replays the original order (`200`, not `201`) and writes no audit row / event.
 */
@ApiTags("orders")
@Controller("orders")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Get()
  @RequireCapability({ feature: ORDERS_FEATURE, permission: "orders.read" })
  @ApiOperation({ summary: "List orders (keyset, filtered)", operationId: "listOrders" })
  @ApiOkResponse({ type: OrderListDto })
  async list(
    @CurrentUser() principal: RequestPrincipal,
    @Query() rawQuery: RawOrderListQuery,
  ): Promise<OrderListDto> {
    return OrderListDto.from(await this.service.list(principal, rawQuery));
  }

  @Get("status-counts")
  @RequireCapability({ feature: ORDERS_FEATURE, permission: "orders.read" })
  @ApiOperation({
    summary: "Per-status counts for the status tabs",
    operationId: "orderStatusCounts",
  })
  @ApiOkResponse({ type: OrderStatusCountsDto })
  async statusCounts(
    @CurrentUser() principal: RequestPrincipal,
    @Query() rawQuery: RawOrderListQuery,
  ): Promise<OrderStatusCountsDto> {
    return OrderStatusCountsDto.from(await this.service.statusCounts(principal, rawQuery));
  }

  @Post()
  @RequireCapability({ feature: ORDERS_FEATURE, permission: "orders.manage" })
  @ApiOperation({ summary: "Create an order", operationId: "createOrder" })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: false })
  @ApiCreatedResponse({ type: OrderDto })
  async create(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: CreateOrderDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderDto> {
    const { order, replayed } = await this.service.create(principal, {
      ...body,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
    res.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    res.setHeader("Location", `/v1/orders/${order.id}`);
    return OrderDto.fromDetail(order);
  }

  @Post("bulk/status")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: ORDERS_FEATURE, permission: "orders.manage" })
  @ApiOperation({
    summary: "Bulk status change (per-item results)",
    operationId: "bulkOrderStatus",
  })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: false })
  @ApiOkResponse({ type: BulkResultDto })
  async bulkStatus(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: BulkStatusDto,
  ): Promise<BulkResultDto> {
    return BulkResultDto.from(
      await this.service.bulkTransition(principal, body.orderIds, {
        toStatus: body.toStatus,
        ...(body.reasonId !== undefined ? { reasonId: body.reasonId } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
      }),
    );
  }

  @Post("bulk/assign")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: ORDERS_FEATURE, permission: "orders.manage" })
  @ApiOperation({ summary: "Bulk assignment (per-item results)", operationId: "bulkOrderAssign" })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: false })
  @ApiOkResponse({ type: BulkResultDto })
  async bulkAssign(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: BulkAssignDto,
  ): Promise<BulkResultDto> {
    return BulkResultDto.from(
      await this.service.bulkAssign(principal, body.orderIds, body.assigneeId),
    );
  }

  @Post("parse")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: ORDERS_FEATURE, permission: "orders.manage" })
  @ApiOperation({
    summary: "Deterministic smart-paste → draft fields (no AI)",
    description:
      "Parses pasted text into name/phone/address/items using Regex + heuristics " +
      "only. 100% deterministic (ADR-0004); never calls an AI service.",
    operationId: "parseOrder",
  })
  @ApiOkResponse({ type: ParsedDraftDto })
  parse(@CurrentUser() principal: RequestPrincipal, @Body() body: ParseOrderDto): ParsedDraftDto {
    return ParsedDraftDto.from(this.service.parse(principal, body.text));
  }

  @Post("import")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: ORDERS_FEATURE, permission: "orders.manage" })
  @ApiOperation({
    summary: "Import orders from CSV with a column mapping",
    description: "Each data row becomes one order; the response reports a per-row result.",
    operationId: "importOrders",
  })
  @ApiOkResponse({ type: ImportResultDto })
  async importOrders(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: ImportOrdersDto,
  ): Promise<ImportResultDto> {
    const { results } = await this.service.importOrders(principal, body.csv, body.mapping);
    return ImportResultDto.from(results);
  }

  @Get(":orderId")
  @RequireCapability({ feature: ORDERS_FEATURE, permission: "orders.read" })
  @ApiOperation({ summary: "Order detail (items + money)", operationId: "getOrder" })
  @ApiOkResponse({ type: OrderDto })
  async getOne(
    @CurrentUser() principal: RequestPrincipal,
    @Param("orderId", ParseUUIDPipe) orderId: string,
  ): Promise<OrderDto> {
    return OrderDto.fromDetail(await this.service.getOne(principal, orderId));
  }

  @Patch(":orderId")
  @RequireCapability({ feature: ORDERS_FEATURE, permission: "orders.manage" })
  @ApiOperation({ summary: "Edit order fields", operationId: "updateOrder" })
  @ApiOkResponse({ type: OrderDto })
  async update(
    @CurrentUser() principal: RequestPrincipal,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() body: UpdateOrderDto,
  ): Promise<OrderDto> {
    return OrderDto.fromDetail(await this.service.update(principal, orderId, body));
  }

  @Post(":orderId/status")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: ORDERS_FEATURE, permission: "orders.manage" })
  @ApiOperation({ summary: "Transition order status", operationId: "transitionOrder" })
  @ApiOkResponse({ type: OrderDto })
  async transition(
    @CurrentUser() principal: RequestPrincipal,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() body: TransitionOrderDto,
  ): Promise<OrderDto> {
    return OrderDto.fromDetail(
      await this.service.transition(principal, orderId, {
        toStatus: body.toStatus,
        ...(body.reasonId !== undefined ? { reasonId: body.reasonId } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
      }),
    );
  }

  @Post(":orderId/assign")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: ORDERS_FEATURE, permission: "orders.manage" })
  @ApiOperation({ summary: "Assign an order to a member", operationId: "assignOrder" })
  @ApiOkResponse({ type: OrderDto })
  async assign(
    @CurrentUser() principal: RequestPrincipal,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() body: AssignOrderDto,
  ): Promise<OrderDto> {
    return OrderDto.fromDetail(await this.service.assign(principal, orderId, body.assigneeId));
  }

  @Get(":orderId/activity")
  @RequireCapability({ feature: ORDERS_FEATURE, permission: "orders.read" })
  @ApiOperation({ summary: "Order activity log (keyset)", operationId: "listOrderActivity" })
  @ApiOkResponse({ type: OrderActivityListDto })
  async activity(
    @CurrentUser() principal: RequestPrincipal,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
  ): Promise<OrderActivityListDto> {
    return OrderActivityListDto.from(
      await this.service.listActivity(principal, orderId, limit, cursor),
    );
  }
}

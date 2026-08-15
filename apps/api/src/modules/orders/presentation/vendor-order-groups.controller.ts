import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { CurrentUser } from "../../../shared/auth/current-user.decorator";
import { JwtAuthGuard } from "../../../shared/auth/jwt-auth.guard";
import { OrdersService } from "../application/orders.service";
import {
  OrderVendorGroupDto,
  OrderVendorGroupListDto,
  UpdateVendorGroupStatusDto,
} from "./dto/orders.dto";

/**
 * Vendor self-service endpoints under `/v1/vendor/order-groups`
 * (Vendor Accounts, Phase 3). Deliberately a **separate controller** from
 * {@link OrdersController} — a vendor holds none of
 * `orders.read`/`orders.manage`/`orders.assign` (Phase 1's `vendor` template
 * is `inventory.read` only), so `OrdersController`'s class-level `AccessGuard`
 * would reject them outright. Guarded by {@link JwtAuthGuard} only; every
 * authorization decision (which groups are "mine", which group I may
 * transition) is ownership-based and made fresh in `OrdersService`, the same
 * pattern already used for `/invitations/accept` and Phase 1's
 * `/warehouse-join-codes/accept`. The tenant comes from the token, never the
 * payload (ADR-003).
 */
@ApiTags("orders")
@Controller("vendor/order-groups")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class VendorOrderGroupsController {
  constructor(private readonly service: OrdersService) {}

  @Get()
  @ApiOperation({
    summary: "My vendor groups, across every order (Vendor Accounts, Phase 3)",
    operationId: "listMyVendorOrderGroups",
  })
  @ApiOkResponse({ type: OrderVendorGroupListDto })
  async list(@CurrentUser() principal: RequestPrincipal): Promise<OrderVendorGroupListDto> {
    return OrderVendorGroupListDto.from(await this.service.listMyVendorGroups(principal));
  }

  @Post(":groupId/status")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Advance one of my vendor groups by one step (new → processing → ready → delivered)",
    operationId: "updateMyVendorOrderGroupStatus",
  })
  @ApiOkResponse({ type: OrderVendorGroupDto })
  async updateStatus(
    @CurrentUser() principal: RequestPrincipal,
    @Param("groupId", ParseUUIDPipe) groupId: string,
    @Body() body: UpdateVendorGroupStatusDto,
  ): Promise<OrderVendorGroupDto> {
    return OrderVendorGroupDto.from(
      await this.service.updateMyVendorGroupStatus(principal, groupId, body.toStatus),
    );
  }
}

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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { AccessGuard } from "../../../shared/access/access.guard";
import { RequireCapability } from "../../../shared/access/require-capability.decorator";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { CurrentUser } from "../../../shared/auth/current-user.decorator";
import { JwtAuthGuard } from "../../../shared/auth/jwt-auth.guard";
import { AppErrors } from "../../../shared/errors/app-exception";
import { ReviewsService } from "../application/reviews.service";
import { CreateReviewDto, OrderReviewDto } from "./dto/reviews.dto";

/** The feature key this module is gated under (access catalog) — reuses `orders`. */
const ORDERS_FEATURE = "orders";

/**
 * Order review endpoints under `/v1/reviews` (Order Reviews feature). A
 * review is create-only — exactly one per order, no update route exists.
 * Gated by the same `orders.read`/`orders.manage` capabilities as the orders
 * module itself; the tenant comes from the token, never the payload (ADR-003).
 */
@ApiTags("reviews")
@Controller("reviews")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Get("orders/:orderId")
  @RequireCapability({ feature: ORDERS_FEATURE, permission: "orders.read" })
  @ApiOperation({ summary: "The review for one order, if any", operationId: "getOrderReview" })
  @ApiOkResponse({ type: OrderReviewDto })
  async getOne(
    @CurrentUser() principal: RequestPrincipal,
    @Param("orderId", ParseUUIDPipe) orderId: string,
  ): Promise<OrderReviewDto> {
    const review = await this.service.getByOrder(principal, orderId);
    if (review === null) throw AppErrors.notFound("No review for this order.");
    return OrderReviewDto.from(review);
  }

  @Post("orders/:orderId")
  @HttpCode(HttpStatus.CREATED)
  @RequireCapability({ feature: ORDERS_FEATURE, permission: "orders.manage" })
  @ApiOperation({
    summary: "Add the (one-time, immutable) review for a delivered/completed order",
    operationId: "createOrderReview",
  })
  @ApiCreatedResponse({ type: OrderReviewDto })
  async create(
    @CurrentUser() principal: RequestPrincipal,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() body: CreateReviewDto,
  ): Promise<OrderReviewDto> {
    const review = await this.service.create(principal, orderId, {
      productType: body.productType,
      ...(body.giftRecipientName === undefined
        ? {}
        : { giftRecipientName: body.giftRecipientName }),
      ...(body.giftRecipientRelation === undefined
        ? {}
        : { giftRecipientRelation: body.giftRecipientRelation }),
      ...(body.giftOccasion === undefined ? {} : { giftOccasion: body.giftOccasion }),
      qualityRating: body.qualityRating,
      ...(body.qualityLowReason === undefined ? {} : { qualityLowReason: body.qualityLowReason }),
      packagingRating: body.packagingRating,
      ...(body.packagingLowReason === undefined
        ? {}
        : { packagingLowReason: body.packagingLowReason }),
      shippingRating: body.shippingRating,
      ...(body.shippingLowReason === undefined
        ? {}
        : { shippingLowReason: body.shippingLowReason }),
    });
    return OrderReviewDto.from(review);
  }
}

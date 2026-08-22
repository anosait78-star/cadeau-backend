import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { CurrentUser } from "../../../shared/auth/current-user.decorator";
import { JwtAuthGuard } from "../../../shared/auth/jwt-auth.guard";
import { ProductsService } from "../application/products.service";
import { VendorProductListDto } from "./dto/products.dto";

/**
 * Vendor self-service read under `/v1/vendor/products` (Vendor Accounts).
 * Deliberately a **separate controller** from {@link ProductsController} —
 * a vendor holds none of `products.read`/`inventory.read`'s general reach
 * (their template is `inventory.read` scoped to their own warehouse only),
 * so `ProductsController`'s class-level `AccessGuard` would reject them
 * outright. Guarded by {@link JwtAuthGuard} only; the warehouse boundary is
 * resolved fresh from `company_members` in `ProductsService`, the same
 * pattern already used by `VendorOrderGroupsController`. Read-only by
 * construction — this controller exposes no write route at all.
 */
@ApiTags("products")
@Controller("vendor/products")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class VendorProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get()
  @ApiOperation({
    summary: "My warehouse's products (Vendor Accounts)",
    operationId: "listMyVendorProducts",
  })
  @ApiOkResponse({ type: VendorProductListDto })
  async list(@CurrentUser() principal: RequestPrincipal): Promise<VendorProductListDto> {
    return VendorProductListDto.from(await this.service.listMyVendorProducts(principal));
  }
}

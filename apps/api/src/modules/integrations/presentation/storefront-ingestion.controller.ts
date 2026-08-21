import { Body, Controller, HttpStatus, Post, Res, UseGuards } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { StorefrontIngestionService } from "../application/storefront-ingestion.service";
import { CurrentStorefrontConnection } from "./current-storefront-connection.decorator";
import {
  IngestOrderDto,
  IngestProductDto,
  IngestResultDto,
  IngestVendorDto,
  VendorSyncResultDto,
} from "./dto/storefront.dto";
import { StorefrontApiKeyGuard } from "./storefront-api-key.guard";
import type { ResolvedStorefrontConnection } from "../domain/storefront-connection.entity";

/**
 * Storefront ingestion routes under `/v1/integrations/storefront`
 * (contract: docs/api/storefront.md §ingestion). Authenticated by
 * {@link StorefrontApiKeyGuard} — an API key scoped to one connection, never
 * a JWT (storefront-integration §D3). The tenant is resolved from the key
 * alone; any `companyId`-shaped field in the request body is ignored.
 *
 * The body is intentionally typed `unknown`, not one of the DTOs below: the
 * SAME two routes serve every platform (one URL per store, regardless of
 * `platform` — D8). WooCommerce's native order/product JSON has nothing in
 * common with the generic contract's shape, so the global `ValidationPipe`
 * (`whitelist`/`forbidNonWhitelisted`) would reject it outright if the
 * handler declared a typed DTO parameter here. Shape validation instead
 * happens entirely inside whichever `StorefrontAdapterPort` the resolved
 * connection's `platform` selects (`GenericJsonAdapter` still enforces the
 * DTOs' shape itself; `WooCommerceAdapter` enforces WooCommerce's own
 * required fields) — see `StorefrontIngestionService`/
 * `StorefrontAdapterResolver`. `IngestOrderDto`/`IngestProductDto` remain
 * here purely to document the generic (`platform: "generic"`) wire shape in
 * OpenAPI via `@ApiBody`; they are never used to validate a request.
 */
@ApiTags("integrations-storefront")
@ApiSecurity("storefront-api-key")
@Controller("integrations/storefront")
@UseGuards(StorefrontApiKeyGuard)
export class StorefrontIngestionController {
  constructor(private readonly ingestion: StorefrontIngestionService) {}

  @Post("orders")
  @ApiOperation({
    summary: "Ingest an order from a storefront",
    description:
      "Body shape depends on the connection's platform: the generic contract " +
      '(documented below) for `platform: "generic"`, or the platform\'s own native ' +
      'webhook payload otherwise (e.g. WooCommerce\'s Order resource for `platform: "woocommerce"`).',
    operationId: "ingestStorefrontOrder",
  })
  @ApiBody({
    type: IngestOrderDto,
    description: "Shown for the generic platform; see operation description.",
  })
  @ApiOkResponse({ type: IngestResultDto })
  async ingestOrder(
    @CurrentStorefrontConnection() connection: ResolvedStorefrontConnection,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IngestResultDto> {
    const result = await this.ingestion.ingestOrder(connection, body);
    res.status(result.status === "created" ? HttpStatus.CREATED : HttpStatus.OK);
    return IngestResultDto.from(result);
  }

  @Post("products")
  @ApiOperation({
    summary: "Ingest a product from a storefront",
    description:
      "Body shape depends on the connection's platform: the generic contract " +
      '(documented below) for `platform: "generic"`, or the platform\'s own native ' +
      'webhook payload otherwise (e.g. WooCommerce\'s Product resource for `platform: "woocommerce"`).',
    operationId: "ingestStorefrontProduct",
  })
  @ApiBody({
    type: IngestProductDto,
    description: "Shown for the generic platform; see operation description.",
  })
  @ApiOkResponse({ type: IngestResultDto })
  async ingestProduct(
    @CurrentStorefrontConnection() connection: ResolvedStorefrontConnection,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IngestResultDto> {
    const result = await this.ingestion.ingestProduct(connection, body);
    res.status(result.status === "created" ? HttpStatus.CREATED : HttpStatus.OK);
    return IngestResultDto.from(result);
  }

  @Post("vendors")
  @ApiOperation({
    summary: "Auto-register a storefront vendor as a CRM warehouse",
    description:
      "Same shape for every platform (unlike orders/products, D8) — the storefront " +
      "side normalizes to `{ externalVendorId, vendorName }` before calling this route " +
      "(e.g. a WooCommerce/WCFM `wcfmmp_new_store_created` hook). Idempotent: a vendor " +
      "already mapped on this connection returns their existing warehouse instead of " +
      "creating a duplicate.",
    operationId: "ingestStorefrontVendor",
  })
  @ApiOkResponse({ type: VendorSyncResultDto })
  async ingestVendor(
    @CurrentStorefrontConnection() connection: ResolvedStorefrontConnection,
    @Body() body: IngestVendorDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<VendorSyncResultDto> {
    const result = await this.ingestion.ingestVendor(connection, body);
    res.status(result.status === "created" ? HttpStatus.CREATED : HttpStatus.OK);
    return VendorSyncResultDto.from(result);
  }
}

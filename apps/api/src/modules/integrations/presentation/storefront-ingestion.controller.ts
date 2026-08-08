import { Body, Controller, HttpStatus, Post, Res, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { StorefrontIngestionService } from "../application/storefront-ingestion.service";
import { CurrentStorefrontConnection } from "./current-storefront-connection.decorator";
import { IngestOrderDto, IngestProductDto, IngestResultDto } from "./dto/storefront.dto";
import { StorefrontApiKeyGuard } from "./storefront-api-key.guard";
import type { ResolvedStorefrontConnection } from "../domain/storefront-connection.entity";

/**
 * Storefront ingestion routes under `/v1/integrations/storefront`
 * (contract: docs/api/storefront.md §ingestion). Authenticated by
 * {@link StorefrontApiKeyGuard} — an API key scoped to one connection, never
 * a JWT (storefront-integration §D3). The tenant is resolved from the key
 * alone; any `companyId`-shaped field in the request body is ignored.
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
    operationId: "ingestStorefrontOrder",
  })
  @ApiOkResponse({ type: IngestResultDto })
  async ingestOrder(
    @CurrentStorefrontConnection() connection: ResolvedStorefrontConnection,
    @Body() body: IngestOrderDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IngestResultDto> {
    const result = await this.ingestion.ingestOrder(connection, body);
    res.status(result.status === "created" ? HttpStatus.CREATED : HttpStatus.OK);
    return IngestResultDto.from(result);
  }

  @Post("products")
  @ApiOperation({
    summary: "Ingest a product from a storefront",
    operationId: "ingestStorefrontProduct",
  })
  @ApiOkResponse({ type: IngestResultDto })
  async ingestProduct(
    @CurrentStorefrontConnection() connection: ResolvedStorefrontConnection,
    @Body() body: IngestProductDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IngestResultDto> {
    const result = await this.ingestion.ingestProduct(connection, body);
    res.status(result.status === "created" ? HttpStatus.CREATED : HttpStatus.OK);
    return IngestResultDto.from(result);
  }
}

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
import { ProductsService } from "../application/products.service";
import type { RawProductListQuery } from "../domain/list-query";
import {
  CreateProductDto,
  CreateVariantDto,
  ImportProductsDto,
  ProductDetailDto,
  ProductDto,
  ProductImportResultDto,
  ProductListDto,
  ProductVariantDto,
  UpdateProductDto,
  UpdateVariantDto,
  VariantListDto,
} from "./dto/products.dto";

const PRODUCTS_FEATURE = "products";

/**
 * Products endpoints under `/v1/products` (contract: docs/api/products.md). All
 * routes require a valid access token and the three-layer {@link AccessGuard}:
 * reads need `products.read`, writes `products.manage`, both under the
 * `products` feature. The tenant comes from the token, never the payload
 * (ADR-003).
 */
@ApiTags("products")
@Controller("products")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get()
  @RequireCapability({ feature: PRODUCTS_FEATURE, permission: "products.read" })
  @ApiOperation({ summary: "List products (keyset, filtered)", operationId: "listProducts" })
  @ApiOkResponse({ type: ProductListDto })
  async list(
    @CurrentUser() principal: RequestPrincipal,
    @Query() rawQuery: RawProductListQuery,
  ): Promise<ProductListDto> {
    return ProductListDto.from(await this.service.list(principal, rawQuery));
  }

  @Get(":productId")
  @RequireCapability({ feature: PRODUCTS_FEATURE, permission: "products.read" })
  @ApiOperation({ summary: "Product detail + variants", operationId: "getProduct" })
  @ApiOkResponse({ type: ProductDetailDto })
  async getOne(
    @CurrentUser() principal: RequestPrincipal,
    @Param("productId", ParseUUIDPipe) productId: string,
  ): Promise<ProductDetailDto> {
    return ProductDetailDto.fromDetail(await this.service.getOne(principal, productId));
  }

  @Post()
  @RequireCapability({ feature: PRODUCTS_FEATURE, permission: "products.manage" })
  @ApiOperation({ summary: "Create a product", operationId: "createProduct" })
  @ApiCreatedResponse({ type: ProductDto })
  async create(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: CreateProductDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProductDto> {
    const row = await this.service.create(principal, body);
    res.status(HttpStatus.CREATED);
    res.setHeader("Location", `/v1/products/${row.id}`);
    return ProductDto.from(row);
  }

  @Post("import")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: PRODUCTS_FEATURE, permission: "products.manage" })
  @ApiOperation({
    summary: "Import products from CSV with a column mapping",
    description: "Each data row becomes one product; the response reports a per-row result.",
    operationId: "importProducts",
  })
  @ApiOkResponse({ type: ProductImportResultDto })
  async importProducts(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: ImportProductsDto,
  ): Promise<ProductImportResultDto> {
    const { results } = await this.service.importProducts(principal, body.csv, body.mapping);
    return ProductImportResultDto.from(results);
  }

  @Patch(":productId")
  @RequireCapability({ feature: PRODUCTS_FEATURE, permission: "products.manage" })
  @ApiOperation({ summary: "Update a product", operationId: "updateProduct" })
  @ApiOkResponse({ type: ProductDto })
  async update(
    @CurrentUser() principal: RequestPrincipal,
    @Param("productId", ParseUUIDPipe) productId: string,
    @Body() body: UpdateProductDto,
  ): Promise<ProductDto> {
    return ProductDto.from(await this.service.update(principal, productId, body));
  }

  @Delete(":productId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireCapability({ feature: PRODUCTS_FEATURE, permission: "products.manage" })
  @ApiOperation({ summary: "Archive a product (soft-delete)", operationId: "archiveProduct" })
  async archive(
    @CurrentUser() principal: RequestPrincipal,
    @Param("productId", ParseUUIDPipe) productId: string,
  ): Promise<void> {
    await this.service.archive(principal, productId);
  }

  @Get(":productId/variants")
  @RequireCapability({ feature: PRODUCTS_FEATURE, permission: "products.read" })
  @ApiOperation({ summary: "List a product's variants", operationId: "listProductVariants" })
  @ApiOkResponse({ type: VariantListDto })
  async listVariants(
    @CurrentUser() principal: RequestPrincipal,
    @Param("productId", ParseUUIDPipe) productId: string,
  ): Promise<VariantListDto> {
    return VariantListDto.from(await this.service.listVariants(principal, productId));
  }

  @Post(":productId/variants")
  @RequireCapability({ feature: PRODUCTS_FEATURE, permission: "products.manage" })
  @ApiOperation({ summary: "Add a variant", operationId: "createProductVariant" })
  @ApiCreatedResponse({ type: ProductVariantDto })
  async createVariant(
    @CurrentUser() principal: RequestPrincipal,
    @Param("productId", ParseUUIDPipe) productId: string,
    @Body() body: CreateVariantDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProductVariantDto> {
    const variant = await this.service.createVariant(principal, productId, body);
    res.status(HttpStatus.CREATED);
    res.setHeader("Location", `/v1/products/${productId}/variants/${variant.id}`);
    return ProductVariantDto.from(variant);
  }

  @Patch(":productId/variants/:variantId")
  @RequireCapability({ feature: PRODUCTS_FEATURE, permission: "products.manage" })
  @ApiOperation({ summary: "Update a variant", operationId: "updateProductVariant" })
  @ApiOkResponse({ type: ProductVariantDto })
  async updateVariant(
    @CurrentUser() principal: RequestPrincipal,
    @Param("productId", ParseUUIDPipe) productId: string,
    @Param("variantId", ParseUUIDPipe) variantId: string,
    @Body() body: UpdateVariantDto,
  ): Promise<ProductVariantDto> {
    return ProductVariantDto.from(
      await this.service.updateVariant(principal, productId, variantId, body),
    );
  }
}

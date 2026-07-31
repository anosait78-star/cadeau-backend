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
import { CustomersService } from "../application/customers.service";
import type { RawCustomerListQuery } from "../domain/list-query";
import {
  AddressListDto,
  CreateAddressDto,
  CreateCustomerDto,
  CustomerAddressDto,
  CustomerDetailDto,
  CustomerDto,
  CustomerExportDto,
  CustomerListDto,
  CustomerMergeResultDto,
  CustomerOrderListDto,
  ExportCustomersDto,
  MergeCustomersDto,
  UpdateAddressDto,
  UpdateCustomerDto,
} from "./dto/customers.dto";

/** The feature key this module is gated under (access catalog). */
const CUSTOMERS_FEATURE = "customers";

/** The idempotency header (api-conventions §Idempotency). */
const IDEMPOTENCY_HEADER = "Idempotency-Key";

/**
 * Customer endpoints under `/v1/customers` (contract: docs/api/customers.md).
 * Every route requires a valid access token and the three-layer
 * {@link AccessGuard}: reads need `customers.read`, and **every write — export
 * included — needs `customers.manage`** (decision D2: the catalog defines only
 * `read`/`manage`, so there is no separate export action). The tenant comes from
 * the token, never the payload (ADR-003).
 *
 * Two things are specific to this resource:
 *
 * - **Phones are masked on the list and full on the detail.** That split is
 *   carried by the DTO types, not by a runtime check — see
 *   `CustomerListItemDto`.
 * - **`POST /v1/customers` honours `Idempotency-Key`** (decision D4, the EPIC-9
 *   pattern): a retry replays the original customer, and a replay writes no
 *   audit row and emits no event.
 */
@ApiTags("customers")
@Controller("customers")
@UseGuards(JwtAuthGuard, AccessGuard)
@ApiBearerAuth()
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  @RequireCapability({ feature: CUSTOMERS_FEATURE, permission: "customers.read" })
  @ApiOperation({ summary: "List customers (keyset, filtered)", operationId: "listCustomers" })
  @ApiOkResponse({ type: CustomerListDto })
  async list(
    @CurrentUser() principal: RequestPrincipal,
    @Query() rawQuery: RawCustomerListQuery,
  ): Promise<CustomerListDto> {
    return CustomerListDto.from(await this.service.list(principal, rawQuery));
  }

  @Post()
  @RequireCapability({ feature: CUSTOMERS_FEATURE, permission: "customers.manage" })
  @ApiOperation({ summary: "Create a customer", operationId: "createCustomer" })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: false })
  @ApiCreatedResponse({ type: CustomerDto })
  async create(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: CreateCustomerDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CustomerDto> {
    const { customer, replayed } = await this.service.create(principal, {
      ...body,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
    // A replay changed nothing, so it is not a creation: 200, not 201.
    res.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    res.setHeader("Location", `/v1/customers/${customer.id}`);
    return CustomerDto.from(customer);
  }

  @Post("export")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: CUSTOMERS_FEATURE, permission: "customers.manage" })
  @ApiOperation({
    summary: "Export customers (gated + audited)",
    description:
      "Returns full phone numbers. Gated by customers.manage, always audited, and " +
      "always emits customer.exported — there is no unaudited path to bulk PII.",
    operationId: "exportCustomers",
  })
  @ApiOkResponse({ type: CustomerExportDto })
  async export(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: ExportCustomersDto,
  ): Promise<CustomerExportDto> {
    return CustomerExportDto.from(await this.service.export(principal, toRawQuery(body)));
  }

  @Post("merge")
  @HttpCode(HttpStatus.OK)
  @RequireCapability({ feature: CUSTOMERS_FEATURE, permission: "customers.manage" })
  @ApiOperation({
    summary: "Merge two customers (re-parents all owned tables)",
    description:
      "Folds the merged customer into the surviving one — every order and address " +
      "is re-parented in one transaction, the merged customer is archived, and " +
      "customer.merged is emitted. Audited (EPIC-11, decision D5).",
    operationId: "mergeCustomers",
  })
  @ApiOkResponse({ type: CustomerMergeResultDto })
  async merge(
    @CurrentUser() principal: RequestPrincipal,
    @Body() body: MergeCustomersDto,
  ): Promise<CustomerMergeResultDto> {
    return CustomerMergeResultDto.from(
      await this.service.merge(principal, body.survivingCustomerId, body.mergedCustomerId),
    );
  }

  @Get(":customerId")
  @RequireCapability({ feature: CUSTOMERS_FEATURE, permission: "customers.read" })
  @ApiOperation({ summary: "Customer detail + KPIs + addresses", operationId: "getCustomer" })
  @ApiOkResponse({ type: CustomerDetailDto })
  async getOne(
    @CurrentUser() principal: RequestPrincipal,
    @Param("customerId", ParseUUIDPipe) customerId: string,
  ): Promise<CustomerDetailDto> {
    return CustomerDetailDto.fromDetail(await this.service.getOne(principal, customerId));
  }

  @Patch(":customerId")
  @RequireCapability({ feature: CUSTOMERS_FEATURE, permission: "customers.manage" })
  @ApiOperation({ summary: "Update a customer", operationId: "updateCustomer" })
  @ApiOkResponse({ type: CustomerDto })
  async update(
    @CurrentUser() principal: RequestPrincipal,
    @Param("customerId", ParseUUIDPipe) customerId: string,
    @Body() body: UpdateCustomerDto,
  ): Promise<CustomerDto> {
    return CustomerDto.from(await this.service.update(principal, customerId, body));
  }

  @Delete(":customerId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireCapability({ feature: CUSTOMERS_FEATURE, permission: "customers.manage" })
  @ApiOperation({ summary: "Archive a customer (soft-delete)", operationId: "archiveCustomer" })
  async archive(
    @CurrentUser() principal: RequestPrincipal,
    @Param("customerId", ParseUUIDPipe) customerId: string,
  ): Promise<void> {
    await this.service.archive(principal, customerId);
  }

  @Get(":customerId/orders")
  @RequireCapability({ feature: CUSTOMERS_FEATURE, permission: "customers.read" })
  @ApiOperation({
    summary: "A customer's order history (keyset)",
    operationId: "listCustomerOrders",
  })
  @ApiOkResponse({ type: CustomerOrderListDto })
  async listOrders(
    @CurrentUser() principal: RequestPrincipal,
    @Param("customerId", ParseUUIDPipe) customerId: string,
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
  ): Promise<CustomerOrderListDto> {
    return CustomerOrderListDto.from(
      await this.service.listOrders(principal, customerId, limit, cursor),
    );
  }

  @Get(":customerId/addresses")
  @RequireCapability({ feature: CUSTOMERS_FEATURE, permission: "customers.read" })
  @ApiOperation({ summary: "List a customer's addresses", operationId: "listCustomerAddresses" })
  @ApiOkResponse({ type: AddressListDto })
  async listAddresses(
    @CurrentUser() principal: RequestPrincipal,
    @Param("customerId", ParseUUIDPipe) customerId: string,
  ): Promise<AddressListDto> {
    return AddressListDto.from(await this.service.listAddresses(principal, customerId));
  }

  @Post(":customerId/addresses")
  @RequireCapability({ feature: CUSTOMERS_FEATURE, permission: "customers.manage" })
  @ApiOperation({ summary: "Add an address", operationId: "createCustomerAddress" })
  @ApiCreatedResponse({ type: CustomerAddressDto })
  async createAddress(
    @CurrentUser() principal: RequestPrincipal,
    @Param("customerId", ParseUUIDPipe) customerId: string,
    @Body() body: CreateAddressDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CustomerAddressDto> {
    const address = await this.service.createAddress(principal, customerId, body);
    res.status(HttpStatus.CREATED);
    res.setHeader("Location", `/v1/customers/${customerId}/addresses/${address.id}`);
    return CustomerAddressDto.from(address);
  }

  @Patch(":customerId/addresses/:addressId")
  @RequireCapability({ feature: CUSTOMERS_FEATURE, permission: "customers.manage" })
  @ApiOperation({ summary: "Update an address", operationId: "updateCustomerAddress" })
  @ApiOkResponse({ type: CustomerAddressDto })
  async updateAddress(
    @CurrentUser() principal: RequestPrincipal,
    @Param("customerId", ParseUUIDPipe) customerId: string,
    @Param("addressId", ParseUUIDPipe) addressId: string,
    @Body() body: UpdateAddressDto,
  ): Promise<CustomerAddressDto> {
    return CustomerAddressDto.from(
      await this.service.updateAddress(principal, customerId, addressId, body),
    );
  }
}

/**
 * Fold the export body into the same raw shape the list parser consumes, so both
 * surfaces are validated and normalized by one function rather than two.
 */
function toRawQuery(body: ExportCustomersDto): RawCustomerListQuery {
  return {
    ...(body.q !== undefined ? { q: body.q } : {}),
    ...(body.active !== undefined ? { active: body.active } : {}),
    ...(body.governorateId !== undefined ? { governorateId: body.governorateId } : {}),
    ...(body.createdAtFrom !== undefined ? { createdAtFrom: body.createdAtFrom } : {}),
    ...(body.createdAtTo !== undefined ? { createdAtTo: body.createdAtTo } : {}),
    ...(body.limit !== undefined ? { limit: String(body.limit) } : {}),
  };
}

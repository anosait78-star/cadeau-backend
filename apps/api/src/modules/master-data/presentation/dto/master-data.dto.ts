import { ApiProperty } from "@nestjs/swagger";
import type { KeysetPage } from "@cadeau/database";
import type { ResourceDescriptor, ResourceView } from "../../domain/resource.types";

/** Keyset page metadata (api-conventions §5). */
export class MasterDataPageDto {
  @ApiProperty({ example: 25 })
  limit!: number;

  @ApiProperty({ nullable: true, description: "Opaque cursor for the next page, or null." })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

/**
 * A master-data row. The four common fields are always present; each resource
 * adds its own attributes (e.g. `name`, `symbol`, `parentId`), so the object is
 * open (`additionalProperties`).
 */
export class MasterDataItemDto {
  @ApiProperty({ description: "Row id (uuid) or code for code-keyed reference tables." })
  id!: string;

  @ApiProperty({ description: "Soft-delete flag; false means deactivated." })
  active!: boolean;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  [attribute: string]: unknown;
}

/** Keyset-paginated collection envelope. */
export class MasterDataListDto {
  @ApiProperty({ type: [MasterDataItemDto] })
  data!: MasterDataItemDto[];

  @ApiProperty({ type: MasterDataPageDto })
  page!: MasterDataPageDto;

  static from(page: KeysetPage<ResourceView>): MasterDataListDto {
    const dto = new MasterDataListDto();
    dto.data = page.data.map((row) => ({ ...row }));
    dto.page = {
      limit: page.page.limit,
      nextCursor: page.page.nextCursor,
      hasMore: page.page.hasMore,
    };
    return dto;
  }
}

/** A resource entry on the discovery endpoint. */
export class ResourceSummaryDto {
  @ApiProperty({ example: "order-labels" })
  name!: string;

  @ApiProperty({ enum: ["system", "tenant"], example: "tenant" })
  scope!: "system" | "tenant";

  @ApiProperty({ description: "Whether the resource is editable via the API (tenant scope)." })
  editable!: boolean;

  static from(descriptor: ResourceDescriptor): ResourceSummaryDto {
    const dto = new ResourceSummaryDto();
    dto.name = descriptor.name;
    dto.scope = descriptor.scope;
    dto.editable = descriptor.scope === "tenant";
    return dto;
  }
}

/** The discovery response: the resources this module serves. */
export class ResourceListDto {
  @ApiProperty({ type: [ResourceSummaryDto] })
  data!: ResourceSummaryDto[];

  static from(descriptors: readonly ResourceDescriptor[]): ResourceListDto {
    const dto = new ResourceListDto();
    dto.data = descriptors.map((d) => ResourceSummaryDto.from(d));
    return dto;
  }
}

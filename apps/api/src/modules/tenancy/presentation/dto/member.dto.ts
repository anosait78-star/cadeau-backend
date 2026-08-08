import { ApiProperty } from "@nestjs/swagger";
import type { MemberView } from "../../domain/tenancy.types";

/** A company member row for the Team page (no secrets — id/name/email/role/status only). */
export class MemberDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ nullable: true, example: "Jane Doe" })
  name!: string | null;

  @ApiProperty({ example: "jane@acme.test" })
  email!: string;

  @ApiProperty({ example: "store_manager" })
  role!: string;

  @ApiProperty({ example: "active" })
  status!: string;

  @ApiProperty({ format: "date-time" })
  joinedAt!: string;

  static from(view: MemberView): MemberDto {
    const dto = new MemberDto();
    dto.id = view.id;
    dto.name = view.name;
    dto.email = view.email;
    dto.role = view.role;
    dto.status = view.status;
    dto.joinedAt = view.joinedAt.toISOString();
    return dto;
  }
}

/** Envelope for the members list. */
export class MemberListDto {
  @ApiProperty({ type: [MemberDto] })
  data!: MemberDto[];

  static from(views: readonly MemberView[]): MemberListDto {
    const dto = new MemberListDto();
    dto.data = views.map((v) => MemberDto.from(v));
    return dto;
  }
}

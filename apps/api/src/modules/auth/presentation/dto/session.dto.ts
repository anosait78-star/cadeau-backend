import { ApiProperty } from "@nestjs/swagger";
import type { SessionView } from "../../domain/auth.types";

/** A session as shown to its owner (no token material). */
export class SessionDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ description: "True for the session used by the current request." })
  current!: boolean;

  @ApiProperty({ nullable: true })
  userAgent!: string | null;

  @ApiProperty({ nullable: true })
  ipAddress!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  expiresAt!: string;

  @ApiProperty({ nullable: true, format: "date-time" })
  revokedAt!: string | null;

  static from(view: SessionView): SessionDto {
    const dto = new SessionDto();
    dto.id = view.id;
    dto.current = view.current;
    dto.userAgent = view.userAgent;
    dto.ipAddress = view.ipAddress;
    dto.createdAt = view.createdAt.toISOString();
    dto.expiresAt = view.expiresAt.toISOString();
    dto.revokedAt = view.revokedAt === null ? null : view.revokedAt.toISOString();
    return dto;
  }
}

/** Envelope for the sessions list. */
export class SessionListDto {
  @ApiProperty({ type: [SessionDto] })
  data!: SessionDto[];

  static from(views: SessionView[]): SessionListDto {
    const dto = new SessionListDto();
    dto.data = views.map((view) => SessionDto.from(view));
    return dto;
  }
}

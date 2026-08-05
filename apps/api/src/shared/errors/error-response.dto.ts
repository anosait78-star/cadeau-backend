import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ERROR_CODES, type ErrorCode } from "./error-codes";

/** The `error` object of the unified error envelope. */
export class ErrorBodyDto {
  @ApiProperty({ enum: ERROR_CODES, description: "Stable, machine-readable error code." })
  code!: ErrorCode;

  @ApiProperty({ description: "Human-readable, client-safe message." })
  message!: string;

  @ApiProperty({ description: "HTTP status code, mirrored for convenience." })
  statusCode!: number;

  @ApiProperty({ description: "Correlation id (also returned as the x-request-id header)." })
  requestId!: string;

  @ApiProperty({ format: "date-time", description: "When the error was produced (ISO-8601)." })
  timestamp!: string;

  @ApiProperty({ description: "Request path that produced the error." })
  path!: string;

  @ApiPropertyOptional({
    type: Object,
    description: "Optional structured details (e.g. field-level validation errors).",
  })
  details?: unknown;
}

/**
 * The single response shape for every error the API returns. Documented in
 * OpenAPI so clients can rely on it uniformly.
 */
export class ErrorResponseDto {
  @ApiProperty({ type: ErrorBodyDto })
  error!: ErrorBodyDto;
}

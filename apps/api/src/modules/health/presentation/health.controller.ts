import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { HealthService } from "../application/health.service";
import { LivenessResponseDto, ReadinessResponseDto } from "./dto/health-response.dto";

/**
 * Health endpoints under `/v1`:
 *  - `GET /v1/health`        liveness  — the process is up (no dependencies).
 *  - `GET /v1/health/ready`  readiness — dependencies (database) are reachable.
 *
 * Readiness always responds 200 with a `status` field (`ok` / `degraded`);
 * callers key off that field rather than the HTTP status.
 */
@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: "Liveness probe", operationId: "getLiveness" })
  @ApiOkResponse({ type: LivenessResponseDto })
  liveness(): LivenessResponseDto {
    return this.health.liveness();
  }

  @Get("ready")
  @ApiOperation({ summary: "Readiness probe", operationId: "getReadiness" })
  @ApiOkResponse({ type: ReadinessResponseDto })
  readiness(): Promise<ReadinessResponseDto> {
    return this.health.readiness();
  }
}

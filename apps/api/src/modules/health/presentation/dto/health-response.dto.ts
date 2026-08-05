import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { HealthStatus } from "../../domain/health.types";

/** Liveness response: the process is up. */
export class LivenessResponseDto {
  @ApiProperty({ enum: ["ok"], example: "ok" })
  status!: "ok";

  @ApiProperty({ description: "Process uptime in seconds.", example: 42 })
  uptimeSeconds!: number;
}

/** Health of a single dependency. */
export class DependencyHealthDto {
  @ApiProperty({ enum: ["up", "down"], example: "up" })
  status!: "up" | "down";

  @ApiProperty({ description: "Probe round-trip time in milliseconds.", example: 3.2 })
  latencyMs!: number;

  @ApiPropertyOptional({ description: "Failure message when the dependency is down." })
  error?: string;
}

/** Dependency probes included in the readiness report. */
export class ReadinessDependenciesDto {
  @ApiProperty({ type: DependencyHealthDto })
  database!: DependencyHealthDto;
}

/** Readiness response: whether the service can serve traffic. */
export class ReadinessResponseDto {
  @ApiProperty({ enum: ["ok", "degraded", "down"], example: "ok" })
  status!: HealthStatus;

  @ApiProperty({ description: "Process uptime in seconds.", example: 42 })
  uptimeSeconds!: number;

  @ApiProperty({ type: ReadinessDependenciesDto })
  dependencies!: ReadinessDependenciesDto;
}

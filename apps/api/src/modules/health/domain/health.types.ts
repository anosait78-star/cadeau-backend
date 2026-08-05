/** Overall health verdict. */
export type HealthStatus = "ok" | "degraded" | "down";

/** Result of probing a single dependency (e.g. the database). */
export interface DependencyHealth {
  readonly status: "up" | "down";
  readonly latencyMs: number;
  readonly error?: string;
}

/** Liveness: the process is up and serving. No dependencies are checked. */
export interface LivenessReport {
  readonly status: "ok";
  readonly uptimeSeconds: number;
}

/** Readiness: whether the service can serve traffic, given its dependencies. */
export interface ReadinessReport {
  readonly status: HealthStatus;
  readonly uptimeSeconds: number;
  readonly dependencies: {
    readonly database: DependencyHealth;
  };
}

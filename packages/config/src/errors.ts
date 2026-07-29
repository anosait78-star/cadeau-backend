/**
 * A single configuration problem: which variable failed and why.
 */
export interface ConfigIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * Thrown when environment configuration is missing or invalid.
 * The message lists every offending variable so the failure is actionable and
 * the application refuses to boot (Environment Validation, M1.3).
 */
export class ConfigValidationError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    const details = issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join("\n");
    super(`Invalid application configuration:\n${details}`);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

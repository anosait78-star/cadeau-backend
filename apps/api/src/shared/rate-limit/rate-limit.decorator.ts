import { SetMetadata } from "@nestjs/common";

/** Per-route rate-limit configuration attached by {@link RateLimit}. */
export interface RateLimitOptions {
  /** Max requests per window, per client key. */
  readonly limit: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
}

/** Metadata key under which {@link RateLimit} stores its options. */
export const RATE_LIMIT_KEY = "cadeau:rate-limit";

/**
 * Rate-limit a route handler. Applied to sensitive public endpoints (login,
 * refresh) so repeated attempts are throttled per client (§11). Enforced by
 * {@link RateLimitGuard}.
 */
export const RateLimit = (options: RateLimitOptions): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);

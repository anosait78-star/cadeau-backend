/** Outcome of a rate-limiter check. */
export interface RateLimitResult {
  readonly allowed: boolean;
  /** Requests still available in the current window (0 when blocked). */
  readonly remaining: number;
  /** Seconds until the window resets — the `Retry-After` value when blocked. */
  readonly retryAfterSeconds: number;
}

interface Window {
  count: number;
  /** Epoch ms when the current fixed window resets. */
  resetAt: number;
}

/**
 * A minimal in-memory fixed-window rate limiter — self-built (no external
 * dependency), sufficient for a single instance. Each key gets `limit` requests
 * per `windowMs`; the window resets as a whole. State is per-process, so behind
 * multiple instances it limits per instance; a shared store (Redis) can back the
 * same interface later without touching callers.
 *
 * Time is injected (`nowMs`) so behaviour is deterministic under test. Expired
 * windows are reaped opportunistically on each hit to bound memory.
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Record a hit for `key` and report whether it is allowed. */
  hit(key: string, nowMs: number): RateLimitResult {
    this.reap(nowMs);

    const existing = this.windows.get(key);
    if (existing === undefined || nowMs >= existing.resetAt) {
      this.windows.set(key, { count: 1, resetAt: nowMs + this.windowMs });
      return { allowed: true, remaining: this.limit - 1, retryAfterSeconds: 0 };
    }

    if (existing.count >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000)),
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: this.limit - existing.count,
      retryAfterSeconds: 0,
    };
  }

  private reap(nowMs: number): void {
    for (const [key, window] of this.windows) {
      if (nowMs >= window.resetAt) {
        this.windows.delete(key);
      }
    }
  }
}

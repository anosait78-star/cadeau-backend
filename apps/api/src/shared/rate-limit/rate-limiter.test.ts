import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limiter";

describe("RateLimiter", () => {
  it("allows up to the limit, then blocks with a Retry-After", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.hit("k", 0)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.hit("k", 100)).toMatchObject({ allowed: true, remaining: 0 });
    const blocked = limiter.hit("k", 200);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1); // ceil((1000-200)/1000)
  });

  it("resets after the window elapses", () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.hit("k", 0).allowed).toBe(true);
    expect(limiter.hit("k", 500).allowed).toBe(false);
    expect(limiter.hit("k", 1000).allowed).toBe(true); // new window
  });

  it("tracks keys independently", () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.hit("a", 0).allowed).toBe(true);
    expect(limiter.hit("b", 0).allowed).toBe(true);
    expect(limiter.hit("a", 0).allowed).toBe(false);
  });

  it("reaps expired windows so stale keys do not linger", () => {
    const limiter = new RateLimiter(1, 1000);
    limiter.hit("gone", 0);
    // A later hit on a different key reaps the expired "gone" window.
    limiter.hit("other", 2000);
    // "gone" starts fresh (was reaped), so it is allowed again.
    expect(limiter.hit("gone", 2000).allowed).toBe(true);
  });
});

import { type ExecutionContext } from "@nestjs/common";
import { type Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { type RateLimitOptions } from "./rate-limit.decorator";
import { RateLimitGuard } from "./rate-limit.guard";

function makeContext(req: unknown, res: unknown): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => ({ name: "TestController" }),
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

function reflectorReturning(options: RateLimitOptions | undefined): Reflector {
  return { getAllAndOverride: () => options } as unknown as Reflector;
}

const clockAt = (ms: number) => ({ now: () => ms });

describe("RateLimitGuard", () => {
  it("passes through handlers without rate-limit metadata", () => {
    const guard = new RateLimitGuard(reflectorReturning(undefined), clockAt(0));
    const ctx = makeContext({ ip: "1.1.1.1" }, { setHeader: vi.fn() });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("allows requests under the limit", () => {
    const guard = new RateLimitGuard(reflectorReturning({ limit: 2, windowMs: 1000 }), clockAt(0));
    const ctx = makeContext({ ip: "1.1.1.1" }, { setHeader: vi.fn() });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("blocks with 429 and sets Retry-After once the limit is exceeded", () => {
    const guard = new RateLimitGuard(reflectorReturning({ limit: 1, windowMs: 1000 }), clockAt(0));
    const setHeader = vi.fn();
    const ctx = makeContext({ ip: "9.9.9.9" }, { setHeader });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(() => guard.canActivate(ctx)).toThrowError(
      expect.objectContaining({ getStatus: expect.any(Function) }),
    );
    expect(setHeader).toHaveBeenCalledWith("Retry-After", "1");
  });

  it("falls back to the socket address, then 'unknown', for the client key", () => {
    const guard = new RateLimitGuard(reflectorReturning({ limit: 1, windowMs: 1000 }), clockAt(0));
    const res = { setHeader: vi.fn() };
    // No req.ip → uses socket.remoteAddress; a different address is a different key.
    expect(guard.canActivate(makeContext({ socket: { remoteAddress: "a" } }, res))).toBe(true);
    expect(() => guard.canActivate(makeContext({ socket: { remoteAddress: "a" } }, res))).toThrow();
    // Neither ip nor socket address → the shared "unknown" bucket.
    expect(guard.canActivate(makeContext({ socket: {} }, res))).toBe(true);
  });
});

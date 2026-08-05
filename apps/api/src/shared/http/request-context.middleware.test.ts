import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import type { AppLogger } from "../logging/app-logger";
import { getRequestId } from "../logging/request-context";
import { RequestContextMiddleware } from "./request-context.middleware";

function fakeLogger() {
  return { log: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as AppLogger;
}

interface Harness {
  headers: Record<string, string | undefined>;
  setHeader: ReturnType<typeof vi.fn>;
  finish: () => void;
  statusCode: number;
}

function run(
  logger: AppLogger,
  opts: { inbound?: string; statusCode?: number } = {},
): { harness: Harness; idInsideNext: string | undefined; sentId: unknown } {
  let finishCb: (() => void) | undefined;
  const req = {
    method: "GET",
    originalUrl: "/v1/health",
    header: (name: string) => (name === "x-request-id" ? opts.inbound : undefined),
  } as unknown as Request;

  const setHeader = vi.fn();
  const res = {
    statusCode: opts.statusCode ?? 200,
    setHeader,
    on: (event: string, cb: () => void) => {
      if (event === "finish") finishCb = cb;
    },
  } as unknown as Response;

  let idInsideNext: string | undefined;
  const next: NextFunction = () => {
    idInsideNext = getRequestId();
  };

  new RequestContextMiddleware(logger).use(req, res, next);

  const sentId = setHeader.mock.calls.at(-1)?.[1];
  return {
    harness: {
      headers: {},
      setHeader,
      statusCode: res.statusCode,
      finish: () => finishCb?.(),
    },
    idInsideNext,
    sentId,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("RequestContextMiddleware", () => {
  it("generates a request id, sets the header, and binds it for next()", () => {
    const { idInsideNext, sentId } = run(fakeLogger());
    expect(String(sentId)).toMatch(UUID);
    expect(idInsideNext).toBe(sentId);
  });

  it("honours a safe inbound x-request-id", () => {
    const { sentId, idInsideNext } = run(fakeLogger(), { inbound: "trace-abc_123" });
    expect(sentId).toBe("trace-abc_123");
    expect(idInsideNext).toBe("trace-abc_123");
  });

  it("rejects an unsafe inbound id and generates its own", () => {
    const { sentId } = run(fakeLogger(), { inbound: "bad id with spaces" });
    expect(String(sentId)).toMatch(UUID);
  });

  it("logs an access line at info on a normal response", () => {
    const logger = fakeLogger();
    const { harness } = run(logger, { statusCode: 204 });
    harness.finish();
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("GET /v1/health 204"), "HTTP");
  });

  it("logs at error level on a 5xx response", () => {
    const logger = fakeLogger();
    const { harness } = run(logger, { statusCode: 500 });
    harness.finish();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("500"), "HTTP");
  });
});

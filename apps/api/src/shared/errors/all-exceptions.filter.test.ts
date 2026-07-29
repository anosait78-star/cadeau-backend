import type { ArgumentsHost } from "@nestjs/common";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import type { AppLogger } from "../logging/app-logger";
import { runWithRequestContext } from "../logging/request-context";
import { AllExceptionsFilter } from "./all-exceptions.filter";
import { AppErrors } from "./app-exception";

interface Captured {
  status: number;
  body: { error: Record<string, unknown> };
}

function fakeLogger() {
  return { error: vi.fn(), warn: vi.fn(), log: vi.fn() } as unknown as AppLogger;
}

function invoke(
  exception: unknown,
  opts: { headerId?: string; url?: string } = {},
): { captured: Captured; logger: AppLogger } {
  const captured = { status: 0, body: { error: {} } } as Captured;
  const res = {
    status: (code: number) => {
      captured.status = code;
      return res;
    },
    json: (payload: { error: Record<string, unknown> }) => {
      captured.body = payload;
      return res;
    },
    getHeader: (name: string) => (name === "x-request-id" ? opts.headerId : undefined),
  } as unknown as Response;
  const req = { originalUrl: opts.url ?? "/v1/thing" } as unknown as Request;
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;

  const logger = fakeLogger();
  new AllExceptionsFilter(logger).catch(exception, host);
  return { captured, logger };
}

describe("AllExceptionsFilter", () => {
  it("renders an AppException into the unified envelope", () => {
    const { captured } = invoke(AppErrors.notFound("no user"));
    expect(captured.status).toBe(404);
    expect(captured.body.error).toMatchObject({
      code: "NOT_FOUND",
      message: "no user",
      statusCode: 404,
      path: "/v1/thing",
    });
    expect(typeof captured.body.error["timestamp"]).toBe("string");
  });

  it("maps a built-in Nest HttpException by status", () => {
    const { captured, logger } = invoke(new NotFoundException("missing"));
    expect(captured.status).toBe(404);
    expect(captured.body.error).toMatchObject({ code: "NOT_FOUND", message: "missing" });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("joins array messages from built-in exceptions", () => {
    const { captured } = invoke(new BadRequestException({ message: ["a", "b"], statusCode: 400 }));
    expect(captured.body.error["message"]).toBe("a; b");
  });

  it("collapses unknown errors into a generic 500 without leaking internals", () => {
    const { captured, logger } = invoke(new Error("db password is 1234"));
    expect(captured.status).toBe(500);
    expect(captured.body.error).toMatchObject({
      code: "INTERNAL",
      message: "Internal server error",
    });
    expect(captured.body.error["message"]).not.toContain("1234");
    expect(logger.error).toHaveBeenCalled();
  });

  it("uses the request-context id, then the header, then 'unknown'", () => {
    const inContext = runWithRequestContext({ requestId: "ctx-1" }, () =>
      invoke(AppErrors.badRequest("x")),
    );
    expect(inContext.captured.body.error["requestId"]).toBe("ctx-1");

    expect(
      invoke(AppErrors.badRequest("x"), { headerId: "hdr-1" }).captured.body.error["requestId"],
    ).toBe("hdr-1");
    expect(invoke(AppErrors.badRequest("x")).captured.body.error["requestId"]).toBe("unknown");
  });
});

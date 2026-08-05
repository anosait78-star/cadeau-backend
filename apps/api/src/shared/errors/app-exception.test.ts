import { HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AppErrors, AppException } from "./app-exception";

describe("AppException", () => {
  it("carries status, code and message", () => {
    const ex = new AppException(HttpStatus.CONFLICT, "CONFLICT", "already exists");
    expect(ex.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(ex.getResponse()).toEqual({ code: "CONFLICT", message: "already exists" });
  });

  it("includes details only when provided", () => {
    const ex = new AppException(HttpStatus.BAD_REQUEST, "BAD_REQUEST", "bad", { field: "x" });
    expect(ex.getResponse()).toEqual({
      code: "BAD_REQUEST",
      message: "bad",
      details: { field: "x" },
    });
  });

  it("AppErrors factories produce the right status and code", () => {
    expect(AppErrors.notFound().getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(AppErrors.unauthorized().getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(AppErrors.forbidden().getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(AppErrors.badRequest("nope").getResponse()).toMatchObject({ code: "BAD_REQUEST" });
    expect(AppErrors.validation("bad", []).getResponse()).toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(AppErrors.conflict("dup").getResponse()).toMatchObject({ code: "CONFLICT" });
  });
});

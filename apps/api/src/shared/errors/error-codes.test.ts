import { HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { codeForStatus } from "./error-codes";

describe("codeForStatus", () => {
  it("maps known statuses to their codes", () => {
    expect(codeForStatus(HttpStatus.BAD_REQUEST)).toBe("BAD_REQUEST");
    expect(codeForStatus(HttpStatus.UNAUTHORIZED)).toBe("UNAUTHORIZED");
    expect(codeForStatus(HttpStatus.FORBIDDEN)).toBe("FORBIDDEN");
    expect(codeForStatus(HttpStatus.NOT_FOUND)).toBe("NOT_FOUND");
    expect(codeForStatus(HttpStatus.METHOD_NOT_ALLOWED)).toBe("METHOD_NOT_ALLOWED");
    expect(codeForStatus(HttpStatus.CONFLICT)).toBe("CONFLICT");
    expect(codeForStatus(HttpStatus.UNPROCESSABLE_ENTITY)).toBe("UNPROCESSABLE_ENTITY");
    expect(codeForStatus(HttpStatus.TOO_MANY_REQUESTS)).toBe("TOO_MANY_REQUESTS");
    expect(codeForStatus(HttpStatus.SERVICE_UNAVAILABLE)).toBe("SERVICE_UNAVAILABLE");
  });

  it("defaults 5xx to INTERNAL and other unknowns to BAD_REQUEST", () => {
    expect(codeForStatus(HttpStatus.INTERNAL_SERVER_ERROR)).toBe("INTERNAL");
    expect(codeForStatus(HttpStatus.BAD_GATEWAY)).toBe("INTERNAL");
    expect(codeForStatus(HttpStatus.I_AM_A_TEAPOT)).toBe("BAD_REQUEST");
  });
});

import { HttpStatus } from "@nestjs/common";
import type { ValidationError } from "class-validator";
import { describe, expect, it } from "vitest";
import type { AppExceptionPayload } from "./app-exception";
import { validationExceptionFactory } from "./validation";

function verr(partial: Partial<ValidationError>): ValidationError {
  return partial as ValidationError;
}

describe("validationExceptionFactory", () => {
  it("produces a 400 VALIDATION_FAILED exception with flattened details", () => {
    const errors = [
      verr({ property: "email", constraints: { isEmail: "email must be an email" } }),
    ];
    const ex = validationExceptionFactory(errors);
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    const body = ex.getResponse() as AppExceptionPayload;
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.details).toEqual([{ field: "email", messages: ["email must be an email"] }]);
  });

  it("flattens nested children with dotted paths", () => {
    const errors = [
      verr({
        property: "address",
        children: [
          verr({ property: "city", constraints: { isNotEmpty: "city should not be empty" } }),
        ],
      }),
    ];
    const body = validationExceptionFactory(errors).getResponse() as AppExceptionPayload;
    expect(body.details).toEqual([
      { field: "address.city", messages: ["city should not be empty"] },
    ]);
  });
});

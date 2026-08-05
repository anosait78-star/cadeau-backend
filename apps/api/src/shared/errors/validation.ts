import type { ValidationError } from "class-validator";
import { AppErrors } from "./app-exception";

/** One flattened field error: the offending path and its failed constraints. */
export interface FieldError {
  readonly field: string;
  readonly messages: string[];
}

function flatten(errors: readonly ValidationError[], parentPath = ""): FieldError[] {
  const out: FieldError[] = [];
  for (const error of errors) {
    const path = parentPath === "" ? error.property : `${parentPath}.${error.property}`;
    if (error.constraints !== undefined) {
      out.push({ field: path, messages: Object.values(error.constraints) });
    }
    if (error.children !== undefined && error.children.length > 0) {
      out.push(...flatten(error.children, path));
    }
  }
  return out;
}

/**
 * Turns class-validator failures into a single {@link AppException} carrying the
 * `VALIDATION_FAILED` code and a flattened, client-usable `details` array — so
 * validation errors flow through the exact same unified envelope as everything
 * else. Wired into the global `ValidationPipe` in `main.ts`.
 */
export function validationExceptionFactory(errors: ValidationError[]) {
  return AppErrors.validation("Request validation failed", flatten(errors));
}

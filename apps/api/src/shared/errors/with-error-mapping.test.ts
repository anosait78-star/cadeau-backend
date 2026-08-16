import { describe, expect, it } from "vitest";
import { withErrorMapping } from "./with-error-mapping";

describe("withErrorMapping", () => {
  it("returns the value fn resolves with, without touching mapError", async () => {
    const mapError = (error: unknown) => error;
    const result = await withErrorMapping(() => Promise.resolve(42), mapError);
    expect(result).toBe(42);
  });

  it("rethrows whatever mapError returns for a rejected fn", async () => {
    const original = new Error("boom");
    const mapped = new Error("mapped");
    const mapError = (error: unknown) => {
      expect(error).toBe(original);
      return mapped;
    };
    await expect(withErrorMapping(() => Promise.reject(original), mapError)).rejects.toBe(mapped);
  });
});

import { describe, expect, it } from "vitest";
import { NODE_ENVIRONMENTS, isNodeEnv, resolveNodeEnv, selectEnvFiles } from "../environment";
import { ConfigValidationError } from "../errors";

describe("environment helpers", () => {
  it("exposes exactly the four supported environments", () => {
    expect(NODE_ENVIRONMENTS).toEqual(["development", "test", "staging", "production"]);
  });

  it("narrows valid and invalid NODE_ENV strings", () => {
    expect(isNodeEnv("production")).toBe(true);
    expect(isNodeEnv("prod")).toBe(false);
    expect(isNodeEnv(undefined)).toBe(false);
  });

  it("resolves a valid NODE_ENV", () => {
    expect(resolveNodeEnv({ NODE_ENV: "staging" })).toBe("staging");
  });

  it("throws a clear error when NODE_ENV is missing", () => {
    expect(() => resolveNodeEnv({})).toThrow(ConfigValidationError);
  });

  it("throws a clear error when NODE_ENV is invalid", () => {
    expect(() => resolveNodeEnv({ NODE_ENV: "prod" })).toThrow(/allowed/);
  });

  it("selects only the env file matching the active environment (no cross-loading)", () => {
    const devFiles = selectEnvFiles("development");
    expect(devFiles).toContain(".env.development");
    expect(devFiles).not.toContain(".env.production");

    const prodFiles = selectEnvFiles("production");
    expect(prodFiles).toContain(".env.production");
    expect(prodFiles).not.toContain(".env.development");
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../load";
import { redactConfig } from "../build-config";
import { ConfigValidationError } from "../errors";

/** Every schema-owned variable; cleared from process.env so tests are deterministic. */
const SCHEMA_KEYS = [
  "NODE_ENV",
  "APP_PORT",
  "APP_URL",
  "LOG_LEVEL",
  "REQUEST_TIMEOUT_MS",
  "CORS_ALLOWED_ORIGINS",
  "CORS_CREDENTIALS",
  "DATABASE_URL",
  "DATABASE_POOL_MAX",
  "DATABASE_SSL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "JWT_ACCESS_TTL",
  "JWT_REFRESH_TTL",
  "JWT_ISSUER",
  "ENCRYPTION_KEY",
  "OAUTH_GOOGLE_CLIENT_ID",
  "OAUTH_GOOGLE_CLIENT_SECRET",
  "WHATSAPP_API_KEY",
  "SHIPPING_BOSTA_API_KEY",
] as const;

const FILE_ENV = [
  "APP_URL=http://localhost:3000",
  "APP_PORT=3000",
  "CORS_ALLOWED_ORIGINS=http://localhost:5173",
  "DATABASE_URL=postgresql://user:pass@localhost:5432/cadeau_dev",
  `JWT_ACCESS_SECRET=${"9f".repeat(20)}`,
  `JWT_REFRESH_SECRET=${"3c".repeat(20)}`,
  "JWT_ACCESS_TTL=15m",
  "JWT_REFRESH_TTL=7d",
  `ENCRYPTION_KEY=${"0".repeat(64)}`,
].join("\n");

let originalEnv: Record<string, string | undefined>;
let tmpDir: string;

beforeEach(() => {
  originalEnv = {};
  for (const key of SCHEMA_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  tmpDir = mkdtempSync(join(tmpdir(), "cadeau-config-"));
});

afterEach(() => {
  for (const key of SCHEMA_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadConfig — dotenv file loading", () => {
  it("loads values from the env file matching NODE_ENV", () => {
    writeFileSync(join(tmpDir, ".env.development"), FILE_ENV);
    process.env["NODE_ENV"] = "development";

    const config = loadConfig({ cwd: tmpDir });
    expect(config.env).toBe("development");
    expect(config.http.port).toBe(3000);
    expect(config.database.url).toContain("cadeau_dev");
  });

  it("lets process.env override values from the file", () => {
    writeFileSync(join(tmpDir, ".env.development"), FILE_ENV);
    process.env["NODE_ENV"] = "development";
    process.env["APP_PORT"] = "9999";

    const config = loadConfig({ cwd: tmpDir });
    expect(config.http.port).toBe(9999);
  });

  it("works from process.env alone when skipDotenv is set", () => {
    process.env["NODE_ENV"] = "development";
    process.env["APP_URL"] = "http://localhost:3000";
    process.env["CORS_ALLOWED_ORIGINS"] = "http://localhost:5173";
    process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/cadeau_dev";
    process.env["JWT_ACCESS_SECRET"] = "9f".repeat(20);
    process.env["JWT_REFRESH_SECRET"] = "3c".repeat(20);
    process.env["JWT_ACCESS_TTL"] = "15m";
    process.env["JWT_REFRESH_TTL"] = "7d";
    process.env["ENCRYPTION_KEY"] = "0".repeat(64);

    const config = loadConfig({ cwd: tmpDir, skipDotenv: true });
    expect(config.isDevelopment).toBe(true);
  });

  it("throws when NODE_ENV is absent from process.env", () => {
    expect(() => loadConfig({ cwd: tmpDir })).toThrow(ConfigValidationError);
  });
});

describe("redactConfig — optional third-party secrets", () => {
  it("masks a present third-party key and omits an absent one", () => {
    const config = loadConfig({
      env: {
        NODE_ENV: "development",
        APP_URL: "http://localhost:3000",
        CORS_ALLOWED_ORIGINS: "http://localhost:5173",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/cadeau_dev",
        JWT_ACCESS_SECRET: "9f".repeat(20),
        JWT_REFRESH_SECRET: "3c".repeat(20),
        JWT_ACCESS_TTL: "15m",
        JWT_REFRESH_TTL: "7d",
        ENCRYPTION_KEY: "0".repeat(64),
        SHIPPING_BOSTA_API_KEY: "bosta-key",
      },
    });
    expect(config.thirdParty.shippingBostaApiKey).toBe("bosta-key");
    expect(config.thirdParty.whatsappApiKey).toBeUndefined();

    const redacted = redactConfig(config) as Record<string, Record<string, unknown>>;
    expect(redacted["thirdParty"]?.["shippingBostaApiKey"]).toBe("***REDACTED***");
    expect(redacted["thirdParty"]?.["whatsappApiKey"]).toBeUndefined();
    expect(redacted["oauth"]).toEqual({});
  });
});

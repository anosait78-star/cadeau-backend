import { describe, expect, it } from "vitest";
import { loadConfig } from "../load";
import { redactConfig } from "../build-config";
import { ConfigValidationError } from "../errors";
import type { AppConfig } from "../types";

/** A complete, valid development environment; individual tests override fields. */
function validEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    NODE_ENV: "development",
    APP_URL: "http://localhost:3000",
    CORS_ALLOWED_ORIGINS: "http://localhost:5173,http://localhost:3000",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/cadeau_dev",
    JWT_ACCESS_SECRET: "9f".repeat(20),
    JWT_REFRESH_SECRET: "3c".repeat(20),
    JWT_ACCESS_TTL: "15m",
    JWT_REFRESH_TTL: "7d",
    ENCRYPTION_KEY: "0".repeat(64),
    ...overrides,
  };
}

function expectConfigError(
  env: Record<string, string | undefined>,
  expectedPath: string,
): ConfigValidationError {
  try {
    loadConfig({ env });
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    const configError = error as ConfigValidationError;
    expect(configError.issues.some((issue) => issue.path === expectedPath)).toBe(true);
    return configError;
  }
  throw new Error(`Expected a ConfigValidationError for "${expectedPath}" but none was thrown`);
}

describe("loadConfig — valid input", () => {
  it("accepts a complete valid environment and returns a structured config", () => {
    const config = loadConfig({ env: validEnv() });
    expect(config.env).toBe("development");
    expect(config.isDevelopment).toBe(true);
    expect(config.isProduction).toBe(false);
    expect(config.http.url).toBe("http://localhost:3000");
    expect(config.http.cors.allowedOrigins).toEqual([
      "http://localhost:5173",
      "http://localhost:3000",
    ]);
    expect(config.database.url).toContain("postgresql://");
    expect(config.jwt.accessTtl).toBe("15m");
    expect(config.encryption.key).toHaveLength(64);
  });

  it("applies documented defaults for omitted optional variables", () => {
    const config = loadConfig({ env: validEnv() });
    expect(config.http.port).toBe(3000);
    expect(config.http.requestTimeoutMs).toBe(30000);
    expect(config.logging.level).toBe("info");
    expect(config.database.poolMax).toBe(10);
    expect(config.database.ssl).toBe(false);
    expect(config.jwt.issuer).toBe("cadeau-crm");
  });

  it("coerces boolean and numeric strings", () => {
    const config = loadConfig({
      env: validEnv({ DATABASE_SSL: "true", CORS_CREDENTIALS: "1", APP_PORT: "8080" }),
    });
    expect(config.database.ssl).toBe(true);
    expect(config.http.cors.credentials).toBe(true);
    expect(config.http.port).toBe(8080);
  });

  it("returns a deeply frozen configuration object", () => {
    const config = loadConfig({ env: validEnv() });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.http.cors)).toBe(true);
    expect(() => {
      (config as { env: string }).env = "production";
    }).toThrow();
  });

  it("includes optional OAuth config only when both id and secret are present", () => {
    const without = loadConfig({ env: validEnv() });
    expect(without.oauth.google).toBeUndefined();

    const withPair = loadConfig({
      env: validEnv({ OAUTH_GOOGLE_CLIENT_ID: "id-123", OAUTH_GOOGLE_CLIENT_SECRET: "secret-123" }),
    });
    expect(withPair.oauth.google?.clientId).toBe("id-123");
  });
});

describe("loadConfig — rejects missing required variables (refuses boot)", () => {
  it("rejects a missing required secret", () => {
    const env = validEnv();
    delete env["JWT_ACCESS_SECRET"];
    expectConfigError(env, "JWT_ACCESS_SECRET");
  });

  it("rejects a missing NODE_ENV", () => {
    const env = validEnv();
    delete env["NODE_ENV"];
    expectConfigError(env, "NODE_ENV");
  });

  it("rejects a missing DATABASE_URL", () => {
    const env = validEnv();
    delete env["DATABASE_URL"];
    expectConfigError(env, "DATABASE_URL");
  });

  it("aggregates multiple missing variables into one error", () => {
    const env = validEnv();
    delete env["JWT_ACCESS_SECRET"];
    delete env["ENCRYPTION_KEY"];
    const error = expectConfigError(env, "JWT_ACCESS_SECRET");
    expect(error.issues.length).toBeGreaterThanOrEqual(2);
    expect(error.message).toContain("JWT_ACCESS_SECRET");
    expect(error.message).toContain("ENCRYPTION_KEY");
  });
});

describe("loadConfig — rejects invalid values (runtime validation)", () => {
  it("rejects an invalid NODE_ENV value", () => {
    expectConfigError(validEnv({ NODE_ENV: "prod" }), "NODE_ENV");
  });

  it("rejects a malformed APP_URL", () => {
    expectConfigError(validEnv({ APP_URL: "not-a-url" }), "APP_URL");
  });

  it("rejects an out-of-range port", () => {
    expectConfigError(validEnv({ APP_PORT: "70000" }), "APP_PORT");
  });

  it("rejects a short JWT secret", () => {
    expectConfigError(validEnv({ JWT_ACCESS_SECRET: "too-short" }), "JWT_ACCESS_SECRET");
  });

  it("rejects identical JWT access/refresh secrets", () => {
    const secret = "d".repeat(40);
    expectConfigError(
      validEnv({ JWT_ACCESS_SECRET: secret, JWT_REFRESH_SECRET: secret }),
      "JWT_REFRESH_SECRET",
    );
  });

  it("rejects a non-hex or wrong-length ENCRYPTION_KEY", () => {
    expectConfigError(validEnv({ ENCRYPTION_KEY: "zz" }), "ENCRYPTION_KEY");
    expectConfigError(validEnv({ ENCRYPTION_KEY: "abcd" }), "ENCRYPTION_KEY");
  });

  it("rejects an invalid JWT TTL duration", () => {
    expectConfigError(validEnv({ JWT_ACCESS_TTL: "soon" }), "JWT_ACCESS_TTL");
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expectConfigError(validEnv({ DATABASE_URL: "mysql://user:pass@localhost/db" }), "DATABASE_URL");
  });

  it("rejects an invalid CORS origin", () => {
    expectConfigError(
      validEnv({ CORS_ALLOWED_ORIGINS: "http://ok.com,not-a-url" }),
      "CORS_ALLOWED_ORIGINS",
    );
  });

  it("rejects OAuth id without its secret", () => {
    expectConfigError(
      validEnv({ OAUTH_GOOGLE_CLIENT_ID: "id-only" }),
      "OAUTH_GOOGLE_CLIENT_SECRET",
    );
  });
});

describe("loadConfig — production hardening", () => {
  function validProdEnv(
    overrides: Record<string, string | undefined> = {},
  ): Record<string, string | undefined> {
    return validEnv({
      NODE_ENV: "production",
      APP_URL: "https://app.cadeau.example",
      CORS_ALLOWED_ORIGINS: "https://app.cadeau.example",
      DATABASE_SSL: "true",
      JWT_ACCESS_SECRET: "9f".repeat(24),
      JWT_REFRESH_SECRET: "3c".repeat(24),
      ENCRYPTION_KEY: "a1b2c3d4".repeat(8),
      ...overrides,
    });
  }

  it("accepts a valid production environment", () => {
    const config = loadConfig({ env: validProdEnv() });
    expect(config.isProduction).toBe(true);
    expect(config.database.ssl).toBe(true);
  });

  it("rejects http (non-https) APP_URL in production", () => {
    expectConfigError(validProdEnv({ APP_URL: "http://app.cadeau.example" }), "APP_URL");
  });

  it("rejects wildcard CORS in production", () => {
    expectConfigError(validProdEnv({ CORS_ALLOWED_ORIGINS: "*" }), "CORS_ALLOWED_ORIGINS");
  });

  it("rejects DATABASE_SSL=false in production", () => {
    expectConfigError(validProdEnv({ DATABASE_SSL: "false" }), "DATABASE_SSL");
  });

  it("rejects placeholder secrets in production", () => {
    expectConfigError(
      validProdEnv({ JWT_ACCESS_SECRET: "change-me-change-me-change-me-change-me" }),
      "JWT_ACCESS_SECRET",
    );
  });
});

describe("redactConfig", () => {
  it("masks every secret while keeping non-secret values", () => {
    const config: AppConfig = loadConfig({
      env: validEnv({
        WHATSAPP_API_KEY: "wa-key",
        OAUTH_GOOGLE_CLIENT_ID: "id",
        OAUTH_GOOGLE_CLIENT_SECRET: "sec",
      }),
    });
    const redacted = redactConfig(config) as Record<string, Record<string, unknown>>;
    expect(redacted["jwt"]?.["accessSecret"]).toBe("***REDACTED***");
    expect(redacted["encryption"]?.["key"]).toBe("***REDACTED***");
    expect(String(redacted["database"]?.["url"])).toContain("***REDACTED***");
    expect(String(redacted["database"]?.["url"])).not.toContain("pass");
    expect(redacted["http"]?.["port"]).toBe(3000);
  });
});

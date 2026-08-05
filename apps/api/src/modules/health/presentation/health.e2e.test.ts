import { type INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../app.module";
import { validationExceptionFactory } from "../../../shared/errors/validation";
import { RequestContextMiddleware } from "../../../shared/http/request-context.middleware";
import { AppLogger } from "../../../shared/logging/app-logger";
import { setupOpenApi } from "../../../shared/openapi/setup-openapi";
import { DATABASE_HEALTH_PORT } from "../domain/database-health.port";
import { PRISMA_HEALTH_PROBE } from "../infrastructure/prisma-health-probe.provider";

/**
 * End-to-end boot of the real application, wired exactly like `main.ts` but with
 * the database dependency faked (no live Postgres needed). Verifies the M1.5
 * acceptance criteria: GET /v1/health works, the unified error envelope is
 * returned, and the OpenAPI document is generated.
 */
describe("API foundation (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_HEALTH_PORT)
      .useValue({ check: async () => ({ status: "up", latencyMs: 1 }) })
      .overrideProvider(PRISMA_HEALTH_PROBE)
      .useValue({ $queryRaw: async () => [] })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      }),
    );
    const requestContext = new RequestContextMiddleware(app.get(AppLogger));
    app.use(requestContext.use.bind(requestContext));
    setupOpenApi(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /v1/health returns liveness with a correlation header", async () => {
    const res = await request(app.getHttpServer()).get("/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
    expect(typeof res.body.uptimeSeconds).toBe("number");
    expect(res.headers["x-request-id"]).toBeDefined();
  });

  it("GET /v1/health/ready returns readiness", async () => {
    const res = await request(app.getHttpServer()).get("/v1/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", dependencies: { database: { status: "up" } } });
  });

  it("unknown routes produce the unified error envelope", async () => {
    const res = await request(app.getHttpServer()).get("/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    expect(res.body.error.requestId).toBeDefined();
    expect(res.body.error.path).toContain("/v1/does-not-exist");
  });

  it("serves the generated OpenAPI document", async () => {
    const res = await request(app.getHttpServer()).get("/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(String(res.body.openapi)).toMatch(/^3\./);
    expect(Object.keys(res.body.paths).some((p) => p.includes("health"))).toBe(true);
  });
});

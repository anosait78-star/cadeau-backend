import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

/**
 * NestJS relies on `emitDecoratorMetadata`, which esbuild (Vitest's default
 * transformer) does not emit. We transform with SWC instead so decorator-based
 * dependency injection works under test exactly as it does at runtime.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: "es6" },
    }),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Non-secret dummy configuration so the app boots under test (mirrors
    // .env.test.example / the CI `database` job). @cadeau/config reads these;
    // no test file touches process.env directly (ESLint-forbidden).
    env: {
      NODE_ENV: "test",
      APP_URL: "http://localhost:3001",
      APP_PORT: "3001",
      LOG_LEVEL: "error",
      CORS_ALLOWED_ORIGINS: "http://localhost:5173",
      DATABASE_URL: "postgresql://cadeau:cadeau@localhost:5432/cadeau_test",
      DATABASE_SSL: "false",
      JWT_ACCESS_SECRET: "2222222222222222222222222222222222222222",
      JWT_REFRESH_SECRET: "3333333333333333333333333333333333333333",
      JWT_ACCESS_TTL: "5m",
      JWT_REFRESH_TTL: "1d",
      ENCRYPTION_KEY: "000000000000000000000000000000000000000000000000000000000000ffff",
    },
    // Booting a Nest app in the e2e beforeAll (SWC compile + DI wiring) can take
    // well over the 10s default under parallel/cold CI load, so give hooks room.
    hookTimeout: 30000,
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        // Bootstrap and declarative wiring: exercised by the e2e boot, not unit
        // tests. main.ts calls listen(); modules/DTOs/providers are declarations.
        "src/main.ts",
        "src/**/*.module.ts",
        "src/**/*.dto.ts",
        "src/**/dto/**",
        // Thin DI factory that news up the shared Prisma client (needs a live DB).
        "src/**/*.provider.ts",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});

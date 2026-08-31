import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

/**
 * Playwright E2E config. The two independent shells (ADR-002) are tested as
 * independent projects, each at its own viewport: `desktop` (≥1024px → Desktop
 * shell) and `mobile` (Pixel 5, touch → Mobile shell). `smoke.spec.ts` runs on
 * both; `desktop.spec.ts` / `mobile.spec.ts` run only on their project. Tests run
 * against the built app served by `vite preview`.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] !== undefined ? 2 : 0,
  reporter:
    process.env["CI"] !== undefined ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    colorScheme: "light",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop",
      testMatch: /(smoke|desktop)\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    // The Mobile shell runs on three real device profiles, not one: the small
    // screen that everything has to survive (iPhone SE), the notched profile
    // where the safe-area insets are actually non-zero (iPhone 15 Pro), and
    // Android (Pixel 8). A layout that only ever sees one viewport is a layout
    // whose safe-area handling is untested.
    {
      name: "mobile",
      testMatch: /(smoke|mobile)\.spec\.ts$/,
      use: { ...devices["Pixel 8"] },
    },
    {
      name: "mobile-small",
      testMatch: /(smoke|mobile)\.spec\.ts$/,
      use: { ...devices["iPhone SE"] },
    },
    {
      name: "mobile-notched",
      testMatch: /(smoke|mobile)\.spec\.ts$/,
      use: { ...devices["iPhone 15 Pro"] },
    },
  ],
  webServer: {
    command: `vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: process.env["CI"] === undefined,
    timeout: 120_000,
  },
});

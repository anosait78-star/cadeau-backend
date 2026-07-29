import { expect, test } from "@playwright/test";

/**
 * Shell-agnostic boot smoke — runs on both the desktop and mobile projects.
 * Verifies the SPA loads (Arabic/RTL by default) and renders the standard states.
 */
test("SPA boots in Arabic/RTL with the standard states", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "أساس الواجهة الأمامية" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("status").first()).toBeVisible();
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Desktop shell (≥1024px) — runs only on the `desktop` project. Exercises the
 * sidebar, the ⌘K command palette, the topbar toggles, and accessibility.
 */
test.describe("Desktop shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("navigates from the sidebar", async ({ page }) => {
    const sidebar = page.getByRole("navigation", { name: "التنقّل الرئيسي" });
    await expect(sidebar).toBeVisible();
    await sidebar.getByRole("link", { name: "الطلبات" }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(sidebar.getByRole("link", { name: "الطلبات" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("opens the ⌘K palette and navigates from it", async ({ page }) => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByPlaceholder("اكتب أمرًا أو ابحث…")).toBeVisible();
    await page.getByRole("option", { name: "العملاء" }).click();
    await expect(page).toHaveURL(/\/customers$/);
  });

  test("toggles theme from the topbar", async ({ page }) => {
    await page.getByRole("button", { name: "تبديل السمة" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("has no serious accessibility violations", async ({ page }) => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious).toEqual([]);
  });
});

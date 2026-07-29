import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Mobile shell (Pixel 5, touch) — runs only on the `mobile` project. Exercises
 * the bottom nav, the FAB → command palette, the More sheet, and accessibility.
 */
test.describe("Mobile shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("navigates from the bottom nav", async ({ page }) => {
    const bottomNav = page.getByRole("navigation", { name: "التنقّل السفلي" });
    await expect(bottomNav).toBeVisible();
    await bottomNav.getByRole("link", { name: "الطلبات" }).click();
    await expect(page).toHaveURL(/\/orders$/);
  });

  test("opens the command palette from the FAB", async ({ page }) => {
    await page.getByRole("button", { name: "بحث…" }).click();
    await expect(page.getByPlaceholder("اكتب أمرًا أو ابحث…")).toBeVisible();
  });

  test("opens the More sheet and toggles the language (direction)", async ({ page }) => {
    await page.getByRole("button", { name: "المزيد" }).click();
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });

  test("has no serious accessibility violations", async ({ page }) => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious).toEqual([]);
  });
});

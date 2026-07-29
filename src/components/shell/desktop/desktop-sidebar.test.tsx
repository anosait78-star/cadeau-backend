import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/i18n/i18n-provider";
import { DesktopSidebar } from "./desktop-sidebar";

function renderSidebar(path = "/") {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <DesktopSidebar />
      </MemoryRouter>
    </I18nProvider>,
  );
}

const LABELS = ["لوحة التحكم", "الطلبات", "العملاء", "المنتجات", "المخزون", "الإعدادات"];

describe("DesktopSidebar", () => {
  it("renders the primary navigation with all items", () => {
    renderSidebar();
    expect(screen.getByRole("navigation", { name: "التنقّل الرئيسي" })).toBeInTheDocument();
    for (const label of LABELS) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("marks the active route with aria-current", () => {
    renderSidebar("/orders");
    expect(screen.getByRole("link", { name: "الطلبات" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "لوحة التحكم" })).not.toHaveAttribute("aria-current");
  });
});

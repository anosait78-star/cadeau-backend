import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthProvider } from "@/auth/auth-provider";
import { I18nProvider } from "@/i18n/i18n-provider";
import { DesktopSidebar } from "./desktop-sidebar";

function renderSidebar(path = "/") {
  return render(
    <I18nProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <DesktopSidebar />
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

const LABELS = ["لوحة التحكم", "الطلبات", "العملاء", "المنتجات", "المخزون", "الإعدادات"];

describe("DesktopSidebar", () => {
  beforeEach(() => {
    localStorage.clear();
  });

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

  it("collapses to an icon-only rail and persists the choice", async () => {
    const user = userEvent.setup();
    renderSidebar();
    const toggle = screen.getByRole("button", { name: "طيّ القائمة الجانبية" });
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "توسيع القائمة الجانبية" })).toBeInTheDocument();
    expect(localStorage.getItem("cadeau.sidebar.collapsed")).toBe("1");
  });

  it("shows the signed-out account footer with a sign-out control", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: "تسجيل الخروج" })).toBeInTheDocument();
  });
});

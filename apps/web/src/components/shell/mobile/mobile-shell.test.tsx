import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { AppProviders } from "@/providers/app-providers";
import { CommandPaletteProvider } from "@/providers/command-palette-provider";
import { MobileShell } from "./mobile-shell";

function renderMobile(path = "/") {
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[path]}>
        <CommandPaletteProvider>
          <Routes>
            <Route element={<MobileShell />}>
              <Route index element={<p>home content</p>} />
              <Route path="orders" element={<p>orders content</p>} />
              <Route path="settings" element={<p>settings content</p>} />
            </Route>
          </Routes>
        </CommandPaletteProvider>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("MobileShell", () => {
  it("renders the bottom nav (primary destinations + More) and content", () => {
    renderMobile();
    const nav = screen.getByRole("navigation", { name: "التنقّل السفلي" });
    expect(nav).toBeInTheDocument();
    for (const label of ["لوحة التحكم", "الطلبات", "العملاء", "المنتجات"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "المزيد" })).toBeInTheDocument();
    expect(screen.getByText("home content")).toBeInTheDocument();
  });

  it("navigates from the bottom nav", async () => {
    const user = userEvent.setup();
    renderMobile();
    await user.click(screen.getByRole("link", { name: "الطلبات" }));
    expect(screen.getByText("orders content")).toBeInTheDocument();
  });

  it("opens the More sheet with overflow destinations and navigates", async () => {
    const user = userEvent.setup();
    renderMobile();
    await user.click(screen.getByRole("button", { name: "المزيد" }));
    expect(await screen.findByRole("button", { name: "المخزون" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "الإعدادات" }));
    expect(screen.getByText("settings content")).toBeInTheDocument();
  });

  it("opens the command palette from the FAB", async () => {
    const user = userEvent.setup();
    renderMobile();
    await user.click(screen.getByRole("button", { name: "بحث…" }));
    expect(await screen.findByPlaceholderText("اكتب أمرًا أو ابحث…")).toBeInTheDocument();
  });
});

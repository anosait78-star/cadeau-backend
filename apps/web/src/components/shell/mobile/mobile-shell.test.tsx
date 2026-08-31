import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Plus } from "lucide-react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/providers/app-providers";
import { CommandPaletteProvider } from "@/providers/command-palette-provider";
import { useRegisterMobilePrimaryAction } from "./mobile-header-context";
import { MobileShell } from "./mobile-shell";

/** A screen that contributes a create action, the way a real domain page does. */
function ScreenWithAction({ onAction }: { onAction: () => void }) {
  useRegisterMobilePrimaryAction({ label: "طلب جديد", icon: Plus, onAction });
  return <p>orders content</p>;
}

function renderMobile(path = "/", ordersElement = <p>orders content</p>) {
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[path]}>
        <CommandPaletteProvider>
          <Routes>
            <Route element={<MobileShell />}>
              <Route index element={<p>home content</p>} />
              <Route path="orders" element={ordersElement} />
              <Route path="orders/:id" element={<p>order detail</p>} />
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

  it("opens the command palette from the header search control", async () => {
    const user = userEvent.setup();
    renderMobile();
    await user.click(screen.getByRole("button", { name: "بحث…" }));
    expect(await screen.findByPlaceholderText("اكتب أمرًا أو ابحث…")).toBeInTheDocument();
  });

  describe("navigation hierarchy", () => {
    it("gives a root destination a large title and no back control", () => {
      renderMobile("/orders");
      expect(screen.getByRole("heading", { level: 1, name: "الطلبات" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "رجوع" })).not.toBeInTheDocument();
    });

    it("gives a deeper screen a back control and drops the large title", () => {
      renderMobile("/orders/42");
      expect(screen.getByRole("button", { name: "رجوع" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
      // The bar still names where you are, inherited from the parent destination.
      expect(screen.getAllByText("الطلبات").length).toBeGreaterThan(0);
    });

    it("goes back from a deeper screen to the one before it", async () => {
      const user = userEvent.setup();
      render(
        <AppProviders>
          <MemoryRouter initialEntries={["/orders", "/orders/42"]} initialIndex={1}>
            <CommandPaletteProvider>
              <Routes>
                <Route element={<MobileShell />}>
                  <Route path="orders" element={<p>orders content</p>} />
                  <Route path="orders/:id" element={<p>order detail</p>} />
                </Route>
              </Routes>
            </CommandPaletteProvider>
          </MemoryRouter>
        </AppProviders>,
      );
      expect(screen.getByText("order detail")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "رجوع" }));
      expect(screen.getByText("orders content")).toBeInTheDocument();
    });
  });

  describe("floating action button", () => {
    it("renders nothing when the screen has no create action", () => {
      renderMobile("/orders");
      expect(screen.queryByRole("button", { name: "طلب جديد" })).not.toBeInTheDocument();
    });

    it("runs the create action the screen registered", async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();
      renderMobile("/orders", <ScreenWithAction onAction={onAction} />);
      await user.click(screen.getByRole("button", { name: "طلب جديد" }));
      expect(onAction).toHaveBeenCalledOnce();
    });
  });
});

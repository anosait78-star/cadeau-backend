import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { AppProviders } from "@/providers/app-providers";
import { setViewport } from "@/test/setup";
import { AppShell } from "./app-shell";

function renderShell() {
  return render(
    <AppProviders>
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<p>page content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("AppShell", () => {
  it("renders the Desktop shell (sidebar) at desktop width", () => {
    setViewport(true);
    renderShell();
    expect(screen.getByRole("navigation", { name: "التنقّل الرئيسي" })).toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("renders the Mobile shell (bottom nav, no sidebar) below desktop width", () => {
    setViewport(false);
    renderShell();
    expect(screen.getByRole("navigation", { name: "التنقّل السفلي" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "التنقّل الرئيسي" })).not.toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});

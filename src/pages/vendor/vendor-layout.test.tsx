import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AppProviders } from "@/providers/app-providers";
import { VendorLayout } from "./vendor-layout";

describe("VendorLayout (Vendor Accounts, Phase 7)", () => {
  it("shows Home/Orders navigation and sign out, nothing else", () => {
    localStorage.setItem("cadeau.locale", "en");
    render(
      <MemoryRouter initialEntries={["/vendor"]}>
        <AppProviders>
          <VendorLayout>
            <p>content</p>
          </VendorLayout>
        </AppProviders>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /Home/ })).toHaveAttribute("href", "/vendor");
    expect(screen.getByRole("link", { name: /Orders/ })).toHaveAttribute("href", "/vendor/orders");
    expect(screen.getByRole("button", { name: /Sign out/i })).toBeInTheDocument();

    // No company-only surfaces (Customers, Products, Inventory, Finance, …)
    // are reachable from this shell at all.
    expect(screen.queryByRole("link", { name: /Customers/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Products/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Inventory/i })).not.toBeInTheDocument();

    expect(screen.getByText("content")).toBeInTheDocument();
  });
});

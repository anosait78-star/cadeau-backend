import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/providers/app-providers";
import { CommandPaletteProvider } from "@/providers/command-palette-provider";
import { CommandPalette } from "./command-palette";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname}</div>;
}

const PLACEHOLDER = "اكتب أمرًا أو ابحث…";

describe("Command palette", () => {
  it("opens on ⌘K and closes on a second ⌘K", async () => {
    const user = userEvent.setup();
    render(
      <AppProviders>
        <MemoryRouter>
          <CommandPaletteProvider>
            <div>content</div>
          </CommandPaletteProvider>
        </MemoryRouter>
      </AppProviders>,
    );
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument();
    await user.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByPlaceholderText(PLACEHOLDER)).toBeInTheDocument();
  });

  it("lists navigation + action commands and navigates on select", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <AppProviders>
        <MemoryRouter initialEntries={["/"]}>
          <LocationProbe />
          <CommandPalette open={true} onOpenChange={onOpenChange} />
        </MemoryRouter>
      </AppProviders>,
    );
    // Navigation + action commands are present.
    expect(await screen.findByRole("option", { name: "الطلبات" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "تبديل السمة" })).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "الطلبات" }));
    expect(screen.getByTestId("loc")).toHaveTextContent("/orders");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("filters and shows the empty state when nothing matches", async () => {
    const user = userEvent.setup();
    render(
      <AppProviders>
        <MemoryRouter>
          <CommandPalette open={true} onOpenChange={vi.fn()} />
        </MemoryRouter>
      </AppProviders>,
    );
    await user.type(screen.getByPlaceholderText(PLACEHOLDER), "zzzzz");
    expect(await screen.findByText("لا توجد نتائج.")).toBeInTheDocument();
  });
});

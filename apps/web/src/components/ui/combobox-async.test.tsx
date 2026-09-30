import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/providers/app-providers";
import { Combobox, type ComboboxOption } from "./combobox";

const RESULTS: ComboboxOption[] = [
  { value: "v1", label: "قميص قطن", hint: "L" },
  { value: "v2", label: "فستان سواريه", hint: "M" },
];

function renderAsync(props: Partial<ComponentProps<typeof Combobox>> = {}) {
  const onSearch = vi.fn();
  render(
    <AppProviders>
      <Combobox
        value=""
        onChange={vi.fn()}
        options={RESULTS}
        onSearch={onSearch}
        emptyText="No results"
        {...props}
      />
    </AppProviders>,
  );
  return { onSearch };
}

describe("Combobox — server-side search", () => {
  it("reports what was typed to the caller", async () => {
    const user = userEvent.setup();
    const { onSearch } = renderAsync();

    await user.click(screen.getByRole("combobox"));
    await user.type(await screen.findByPlaceholderText("ابحث…"), "قميص");

    expect(onSearch).toHaveBeenLastCalledWith("قميص");
  });

  /*
   * The server already filtered. Filtering again here would hide rows it
   * deliberately returned — a variant whose product name matched the query
   * while its own name does not contain it, say.
   */
  it("shows every option it is given, even ones the query does not match", async () => {
    const user = userEvent.setup();
    renderAsync();

    await user.click(screen.getByRole("combobox"));
    await user.type(await screen.findByPlaceholderText("ابحث…"), "zzzz");

    expect(await screen.findByText("قميص قطن")).toBeInTheDocument();
    expect(screen.getByText("فستان سواريه")).toBeInTheDocument();
  });

  it("says it is searching rather than saying there is nothing", async () => {
    const user = userEvent.setup();
    renderAsync({ options: [], loading: true });

    await user.click(screen.getByRole("combobox"));

    expect(await screen.findByText("جارٍ البحث…")).toBeInTheDocument();
    expect(screen.queryByText("No results")).not.toBeInTheDocument();
  });

  // A dropped request and an empty catalogue must not look alike, or someone
  // goes hunting for a product that is there.
  it("reports a failed search instead of showing an empty list", async () => {
    const user = userEvent.setup();
    renderAsync({ options: [], errorText: "Couldn't load products." });

    await user.click(screen.getByRole("combobox"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load products.");
    expect(screen.queryByText("No results")).not.toBeInTheDocument();
  });

  it("falls back to the empty state once a search has finished and found nothing", async () => {
    const user = userEvent.setup();
    renderAsync({ options: [], loading: false });

    await user.click(screen.getByRole("combobox"));

    expect(await screen.findByText("No results")).toBeInTheDocument();
  });

  /*
   * With server-side search the options hold only the current results, so a
   * selection made under an earlier query is no longer among them — and the
   * trigger would show the placeholder, as if nothing had been picked.
   */
  it("keeps showing the selection after the results have moved on", () => {
    render(
      <AppProviders>
        <Combobox
          value="v9"
          onChange={vi.fn()}
          options={RESULTS}
          onSearch={vi.fn()}
          placeholder="Select…"
          selectedOption={{ value: "v9", label: "حقيبة يد", hint: "S" }}
        />
      </AppProviders>,
    );

    expect(screen.getByRole("combobox")).toHaveTextContent("حقيبة يد");
  });

  it("prefers the option in the results when the selection is among them", () => {
    render(
      <AppProviders>
        <Combobox
          value="v1"
          onChange={vi.fn()}
          options={RESULTS}
          onSearch={vi.fn()}
          selectedOption={{ value: "v9", label: "حقيبة يد" }}
        />
      </AppProviders>,
    );

    expect(screen.getByRole("combobox")).toHaveTextContent("قميص قطن");
  });
});

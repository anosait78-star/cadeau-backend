import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/providers/app-providers";
import { Combobox } from "./combobox";

const OPTIONS = [
  { value: "cairo", label: "Cairo" },
  { value: "giza", label: "Giza" },
  { value: "alex", label: "Alexandria" },
];

function ControlledCombobox({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <Combobox value={value} onChange={setValue} options={OPTIONS} placeholder="Select…" />;
}

describe("Combobox", () => {
  it("shows the placeholder when nothing is selected, and the option label once selected", async () => {
    const user = userEvent.setup();
    render(
      <AppProviders>
        <ControlledCombobox />
      </AppProviders>,
    );
    expect(screen.getByRole("combobox")).toHaveTextContent("Select…");

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("Giza"));

    expect(screen.getByRole("combobox")).toHaveTextContent("Giza");
  });

  it("filters options by search text", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AppProviders>
        <Combobox value="" onChange={onChange} options={OPTIONS} />
      </AppProviders>,
    );
    await user.click(screen.getByRole("combobox"));
    await user.type(await screen.findByPlaceholderText("ابحث…"), "gi");

    expect(await screen.findByText("Giza")).toBeInTheDocument();
    expect(screen.queryByText("Cairo")).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", async () => {
    const user = userEvent.setup();
    render(
      <AppProviders>
        <Combobox value="" onChange={vi.fn()} options={OPTIONS} emptyText="No results" />
      </AppProviders>,
    );
    await user.click(screen.getByRole("combobox"));
    await user.type(await screen.findByPlaceholderText("ابحث…"), "zzzzz");

    expect(await screen.findByText("No results")).toBeInTheDocument();
  });
});

/*
 * The order form's product list looked like it was missing products: a vendor
 * typing "ازرق" saw nothing, because cmdk's character-by-character scoring
 * gave "أزرق" a zero and dropped the row entirely.
 */
describe("Combobox — Arabic search", () => {
  const ARABIC = [
    { value: "shirt", label: "قميص قطن أزرق" },
    { value: "abaya", label: "عباية سوداء" },
    { value: "bag", label: "حقيبة يد" },
  ];

  function renderArabic() {
    render(
      <AppProviders>
        <Combobox value="" onChange={vi.fn()} options={ARABIC} emptyText="No results" />
      </AppProviders>,
    );
  }

  it.each([
    ["ازرق", "قميص قطن أزرق"],
    ["عبايه", "عباية سوداء"],
    ["حقيبه", "حقيبة يد"],
  ])("finds a product when %s is typed without the careful spelling", async (typed, expected) => {
    const user = userEvent.setup();
    renderArabic();

    await user.click(screen.getByRole("combobox"));
    await user.type(await screen.findByPlaceholderText("ابحث…"), typed);

    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it("matches words in any order", async () => {
    const user = userEvent.setup();
    renderArabic();

    await user.click(screen.getByRole("combobox"));
    await user.type(await screen.findByPlaceholderText("ابحث…"), "ازرق قميص");

    expect(await screen.findByText("قميص قطن أزرق")).toBeInTheDocument();
  });

  // Widening what matches must not turn the list into "everything matches".
  it("still hides products that do not match", async () => {
    const user = userEvent.setup();
    renderArabic();

    await user.click(screen.getByRole("combobox"));
    await user.type(await screen.findByPlaceholderText("ابحث…"), "عبايه");

    expect(await screen.findByText("عباية سوداء")).toBeInTheDocument();
    expect(screen.queryByText("قميص قطن أزرق")).not.toBeInTheDocument();
  });
});

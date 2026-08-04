import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/providers/app-providers";
import { DatePicker } from "./date-picker";

function ControlledDatePicker({ initial = null }: { initial?: string | null }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <DatePicker
      value={value}
      onChange={setValue}
      placeholder="Pick a date"
      ariaLabel="Pick a date"
    />
  );
}

describe("DatePicker", () => {
  beforeEach(() => {
    localStorage.setItem("cadeau.locale", "en");
  });

  it("shows the placeholder, then the formatted date after picking a day", async () => {
    const user = userEvent.setup();
    render(
      <AppProviders>
        <ControlledDatePicker initial="2026-03-15" />
      </AppProviders>,
    );
    const trigger = screen.getByRole("button", { name: "Pick a date" });
    expect(trigger).toHaveTextContent("Mar 15, 2026");

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "20" }));

    expect(trigger).toHaveTextContent("Mar 20, 2026");
  });

  it("navigates between months", async () => {
    const user = userEvent.setup();
    render(
      <AppProviders>
        <ControlledDatePicker initial="2026-03-15" />
      </AppProviders>,
    );
    await user.click(screen.getByRole("button", { name: "Pick a date" }));
    expect(screen.getByText("March 2026")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("April 2026")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("March 2026")).toBeInTheDocument();
  });

  it("clears the value via the clear button", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AppProviders>
        <DatePicker
          value="2026-03-15"
          onChange={onChange}
          placeholder="Pick a date"
          ariaLabel="Pick a date"
        />
      </AppProviders>,
    );
    await user.click(screen.getByRole("button", { name: "Pick a date" }));
    await user.click(screen.getByText("Clear"));

    expect(onChange).toHaveBeenCalledWith(null);
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

describe("PopoverContent", () => {
  it("opens from its trigger", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>open</PopoverTrigger>
        <PopoverContent>the content</PopoverContent>
      </Popover>,
    );
    await user.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByText("the content")).toBeInTheDocument();
  });

  /**
   * Regression guard. The content is portaled to <body>, and a modal Radix
   * dialog (every Modal and BottomSheet in the app) sets `pointer-events: none`
   * there to seal off what is behind it. Without re-enabling them on the content
   * itself, a popover opened from inside a sheet — a date picker, a combobox —
   * renders perfectly and ignores every tap.
   */
  it("keeps its own pointer events so it works inside a modal sheet", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>open</PopoverTrigger>
        <PopoverContent>the content</PopoverContent>
      </Popover>,
    );
    await user.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByText("the content").className).toContain("pointer-events-auto");
  });
});

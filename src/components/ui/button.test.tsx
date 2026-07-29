import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders the primary variant by default and fires onClick", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).toContain("bg-primary");
    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("applies the requested variant and merges custom classes", () => {
    render(
      <Button variant="outline" className="w-full">
        Cancel
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Cancel" });
    expect(button.className).toContain("border");
    expect(button.className).toContain("w-full");
  });

  it("defaults to type=button", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute("type", "button");
  });
});

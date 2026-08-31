import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { AppProviders } from "@/providers/app-providers";
import { BottomSheet, type SheetDetent } from "./sheet";

function OpenSheet({ detent = "auto" }: { detent?: SheetDetent }) {
  const [open, setOpen] = useState(true);
  return (
    <AppProviders>
      <BottomSheet open={open} onOpenChange={setOpen} title="الفلاتر" detent={detent}>
        <p>sheet body</p>
      </BottomSheet>
    </AppProviders>
  );
}

describe("BottomSheet", () => {
  it("renders its title and body", () => {
    render(<OpenSheet />);
    expect(screen.getByText("الفلاتر")).toBeInTheDocument();
    expect(screen.getByText("sheet body")).toBeInTheDocument();
  });

  it("stands at the height its detent asks for", () => {
    const { rerender } = render(<OpenSheet detent="medium" />);
    expect(screen.getByRole("dialog").className).toContain("h-[50dvh]");

    rerender(<OpenSheet detent="large" />);
    expect(screen.getByRole("dialog").className).toContain("h-[92dvh]");
  });

  it("hugs its content by default rather than claiming a fixed height", () => {
    render(<OpenSheet />);
    expect(screen.getByRole("dialog").className).toContain("max-h-[85dvh]");
  });

  it("can be dismissed from its close affordance", async () => {
    const user = userEvent.setup();
    render(<OpenSheet />);
    await user.keyboard("{Escape}");
    expect(screen.queryByText("sheet body")).not.toBeInTheDocument();
  });
});

// The drag itself is covered in `use-drag-dismiss.test.ts`: jsdom's PointerEvent
// drops `clientY` from its init dictionary, so a gesture dispatched at the DOM
// level arrives with no coordinates and cannot exercise the behavior.

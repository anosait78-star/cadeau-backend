import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BulkActionsBar } from "./bulk-actions-bar";

describe("BulkActionsBar", () => {
  it("renders nothing when count is 0", () => {
    const { container } = render(
      <BulkActionsBar
        count={0}
        onClear={() => {}}
        actions={<button type="button">Assign</button>}
        countLabel={(n) => `${n} selected`}
        clearLabel="Clear"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the count label and actions, and fires onClear", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(
      <BulkActionsBar
        count={3}
        onClear={onClear}
        actions={<button type="button">Assign</button>}
        countLabel={(n) => `${n} selected`}
        clearLabel="Clear"
      />,
    );
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    expect(screen.getByText("Assign")).toBeInTheDocument();
    await user.click(screen.getByText("Clear"));
    expect(onClear).toHaveBeenCalledOnce();
  });
});

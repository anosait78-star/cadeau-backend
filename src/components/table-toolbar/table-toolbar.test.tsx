import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TableToolbar } from "./table-toolbar";

describe("TableToolbar", () => {
  it("renders the search input and fires onChange/onSubmit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <TableToolbar
        search={{ value: "", onChange, onSubmit, placeholder: "Search…", label: "Search" }}
      />,
    );
    const input = screen.getByLabelText("Search");
    await user.type(input, "x");
    expect(onChange).toHaveBeenCalled();
    await user.type(input, "{Enter}");
    expect(onSubmit).toHaveBeenCalled();
  });

  it("renders primary and secondary action slots", () => {
    render(
      <TableToolbar
        primaryActions={<button type="button">New</button>}
        secondaryActions={<button type="button">Export</button>}
      />,
    );
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Export")).toBeInTheDocument();
  });

  it("omits the search slot when not provided", () => {
    render(<TableToolbar primaryActions={<button type="button">New</button>} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

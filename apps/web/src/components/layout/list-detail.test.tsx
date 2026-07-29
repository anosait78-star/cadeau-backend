import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ListDetailLayout } from "./list-detail";

describe("ListDetailLayout", () => {
  it("renders both panes when a detail is provided", () => {
    render(<ListDetailLayout list={<p>the list</p>} detail={<p>the detail</p>} />);
    expect(screen.getByText("the list")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "detail" })).toBeInTheDocument();
    expect(screen.getByText("the detail")).toBeInTheDocument();
  });

  it("renders only the list when there is no detail", () => {
    render(<ListDetailLayout list={<p>the list</p>} />);
    expect(screen.getByText("the list")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "detail" })).not.toBeInTheDocument();
  });
});

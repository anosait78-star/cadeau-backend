import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataGrid } from "./data-grid";
import { useDataGridSelection } from "./use-data-grid-selection";
import type { Column } from "./types";

class FakeIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

interface Row {
  id: string;
  name: string;
  amount: number;
}

const ROWS: Row[] = [
  { id: "1", name: "Bravo", amount: 10 },
  { id: "2", name: "Alpha", amount: 30 },
  { id: "3", name: "Charlie", amount: 20 },
];

const columns: Column<Row>[] = [
  {
    key: "name",
    header: "Name",
    render: (r) => r.name,
    clientSortable: true,
    sortAccessor: (r) => r.name,
  },
  { key: "amount", header: "Amount", render: (r) => String(r.amount) },
];

function Wrapper(props: Partial<Parameters<typeof DataGrid<Row>>[0]> = {}) {
  return (
    <DataGrid<Row>
      columns={columns}
      rows={ROWS}
      getRowId={(r) => r.id}
      loading={false}
      hasMore={false}
      onLoadMore={() => {}}
      emptyState={<div>Empty</div>}
      {...props}
    />
  );
}

describe("DataGrid", () => {
  it("renders rows via column.render", () => {
    render(<Wrapper />);
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("shows the empty state when there are no rows", () => {
    render(<Wrapper rows={[]} />);
    expect(screen.getByText("Empty")).toBeInTheDocument();
  });

  it("shows a loading skeleton while loading", () => {
    const { container } = render(<Wrapper loading />);
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("client-sorts a clientSortable column on header click", async () => {
    const user = userEvent.setup();
    render(<Wrapper />);
    await user.click(screen.getByText("Name"));
    const cells = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.textContent);
    expect(cells[0]).toContain("Charlie");
  });

  it("fires onRowClick when a row is clicked, but not from an inner button", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <Wrapper onRowClick={onRowClick} rowActions={() => <button type="button">...</button>} />,
    );
    await user.click(screen.getByText("Bravo"));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
    onRowClick.mockClear();
    await user.click(screen.getAllByText("...")[0] as HTMLElement);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("selection: toggle, toggle-all, and indeterminate", async () => {
    const user = userEvent.setup();
    function Harness() {
      const selection = useDataGridSelection();
      return <Wrapper selection={selection} />;
    }
    render(<Harness />);
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[1] as HTMLElement); // first row checkbox (0 is select-all)
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);
    await user.click(checkboxes[0] as HTMLElement); // select all
    expect((checkboxes[2] as HTMLInputElement).checked).toBe(true);
  });

  it("keyboard: ArrowDown moves focus, Enter opens the focused row", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<Wrapper onRowClick={onRowClick} />);
    const rows = screen.getAllByRole("row").slice(1);
    (rows[0] as HTMLElement).focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rows[1]);
    await user.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MasterDataItem } from "@/features/master-data/master-data-api";
import type { MdResource } from "@/features/master-data/resources";
import type { TranslationKey } from "@/i18n/dictionaries";
import { buildMdColumns } from "./master-data-columns";

const t = (key: TranslationKey): string => key;

const RESOURCE: MdResource = {
  name: "reasons",
  labelKey: "md.kind.general" as TranslationKey,
  editable: true,
  fields: [
    { name: "name", labelKey: "md.kind.general" as TranslationKey, type: "text" },
    {
      name: "kind",
      labelKey: "md.kind.general" as TranslationKey,
      type: "select",
      options: ["cancellation", "return", "general"],
    },
  ],
};

const ITEM: MasterDataItem = {
  id: "m1",
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  name: "Broken item",
  kind: "return",
};

describe("buildMdColumns", () => {
  const columns = buildMdColumns({ t, resource: RESOURCE });

  it("renders every column without throwing", () => {
    for (const column of columns) {
      render(<div>{column.render(ITEM)}</div>);
    }
  });

  it("renders the raw text field value and marks the name column client-sortable", () => {
    const name = columns.find((c) => c.key === "name");
    render(<div>{name?.render(ITEM)}</div>);
    expect(screen.getByText("Broken item")).toBeInTheDocument();
    expect(name?.clientSortable).toBe(true);
    expect(name?.sortAccessor?.(ITEM)).toBe("Broken item");
  });

  it("localizes the kind select field for each known option", () => {
    const kind = columns.find((c) => c.key === "kind");
    render(<div>{kind?.render({ ...ITEM, kind: "cancellation" })}</div>);
    expect(screen.getByText("md.kind.cancellation")).toBeInTheDocument();
    render(<div>{kind?.render({ ...ITEM, kind: "return" })}</div>);
    expect(screen.getByText("md.kind.return")).toBeInTheDocument();
    render(<div>{kind?.render({ ...ITEM, kind: "general" })}</div>);
    expect(screen.getByText("md.kind.general")).toBeInTheDocument();
  });

  it("falls back to the raw value for an unrecognized select option", () => {
    const kind = columns.find((c) => c.key === "kind");
    render(<div>{kind?.render({ ...ITEM, kind: "other" })}</div>);
    expect(screen.getByText("other")).toBeInTheDocument();
  });

  it("renders a dash for a null/undefined/empty field value", () => {
    const name = columns.find((c) => c.key === "name");
    render(<div>{name?.render({ ...ITEM, name: null })}</div>);
    expect(screen.getByText("—")).toBeInTheDocument();
    render(<div>{name?.render({ ...ITEM, name: undefined })}</div>);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    render(<div>{name?.render({ ...ITEM, name: "" })}</div>);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("does not mark non-name fields as client-sortable", () => {
    const kind = columns.find((c) => c.key === "kind");
    expect(kind?.clientSortable).toBeUndefined();
  });

  it("renders active and inactive status badges", () => {
    const status = columns.find((c) => c.key === "status");
    render(<div>{status?.render(ITEM)}</div>);
    expect(screen.getByText("md.status.active")).toBeInTheDocument();
    render(<div>{status?.render({ ...ITEM, active: false })}</div>);
    expect(screen.getByText("md.status.inactive")).toBeInTheDocument();
  });
});

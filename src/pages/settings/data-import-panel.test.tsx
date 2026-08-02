import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilityRequirement,
} from "@/features/access/capabilities-context";
import { I18nProvider } from "@/i18n/i18n-provider";
import { DataImportPanel } from "./data-import-panel";

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPanel() {
  const value: CapabilitiesContextValue = {
    status: "ready",
    features: ["products", "orders"],
    permissions: ["products.manage", "orders.manage"],
    isSuperAdmin: false,
    has: (req: CapabilityRequirement) =>
      (req.feature === undefined || value.features.includes(req.feature)) &&
      (req.permission === undefined || value.permissions.includes(req.permission)),
    reload: () => Promise.resolve(),
  };
  return render(
    <I18nProvider>
      <CapabilitiesContext value={value}>
        <DataImportPanel />
      </CapabilitiesContext>
    </I18nProvider>,
  );
}

describe("DataImportPanel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps columns from an uploaded CSV and imports products", async () => {
    const user = userEvent.setup();
    renderPanel();

    const file = new File(["name,sku\nMug,MUG-1"], "products.csv", { type: "text/csv" });
    const fileInput = screen.getByLabelText("استيراد المنتجات");
    await user.upload(fileInput, file);

    const nameSelect = await screen.findByLabelText("الاسم *");
    await user.selectOptions(nameSelect, "name");

    fetchMock.mockResolvedValueOnce(
      json(200, { results: [{ row: 1, ok: true, productId: "p1" }] }),
    );
    const importButtons = screen.getAllByRole("button", { name: "بدء الاستيراد" });
    await user.click(importButtons[0]!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find((c) => (c[0] as string).includes("/products/import"));
    expect(call).toBeDefined();
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
      csv: "name,sku\nMug,MUG-1",
      mapping: { name: "name" },
    });
    expect(await screen.findByText("تم استيراد 1، وفشل 0.")).toBeInTheDocument();
  });

  it("keeps the start-import button disabled until required columns are mapped", async () => {
    const user = userEvent.setup();
    renderPanel();

    const file = new File(["a,b\n1,2"], "orders.csv", { type: "text/csv" });
    const fileInput = screen.getByLabelText("استيراد الطلبات");
    await user.upload(fileInput, file);

    const importButton = await screen.findByRole("button", { name: "بدء الاستيراد" });
    expect(importButton).toBeDisabled();
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/i18n-provider";
import { SelectCarrierDialog } from "./select-carrier-dialog";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderDialog(onCreated: (shipment: unknown) => void) {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <SelectCarrierDialog
          open
          onOpenChange={() => {}}
          orderId="order-1"
          customerId="cust-1"
          onCreated={onCreated}
        />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("SelectCarrierDialog — Bosta fields (moved from the customer/order forms)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("cadeau.locale", "en");
    fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/shipping/carriers")) {
        return Promise.resolve(
          json(200, {
            data: [
              { key: "manual", connected: true, pickupLocationWarning: false, connectedAt: null },
              {
                key: "bosta",
                connected: true,
                pickupLocationWarning: false,
                connectedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
        );
      }
      if (url.includes("/shipping/bosta/cities/") && url.includes("/districts")) {
        return Promise.resolve(
          json(200, {
            data: [
              {
                districtId: "d1",
                districtName: "1st Settlement",
                zoneId: "z1",
                zoneName: "New Cairo",
              },
            ],
          }),
        );
      }
      if (url.endsWith("/shipping/bosta/cities")) {
        return Promise.resolve(json(200, { data: [{ id: "c1", name: "Cairo", nameAr: null }] }));
      }
      if (url.match(/\/customers\/cust-1$/) && method === "GET") {
        return Promise.resolve(
          json(200, {
            id: "cust-1",
            name: "Naruto Uzumaki",
            phone: "+201065685435",
            email: null,
            notes: null,
            active: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            ordersCount: 0,
            totalSpent: 0,
            lastOrderAt: null,
            addresses: [],
          }),
        );
      }
      if (url.endsWith("/shipping/shipments") && method === "POST") {
        return Promise.resolve(
          json(201, {
            id: "s1",
            orderId: "order-1",
            carrier: "bosta",
            trackingNumber: "TRACK-1",
            status: "created",
            fee: 0,
            waybillIssued: false,
            deliveredAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
        );
      }
      return Promise.resolve(json(404, { error: { code: "NOT_FOUND", statusCode: 404 } }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reveals city/district/notes/goods-value only once Bosta is chosen, cascading city -> district", async () => {
    const user = userEvent.setup();
    renderDialog(() => {});

    expect(screen.queryByLabelText("Bosta city")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Shipping company"));
    await user.click(await screen.findByRole("option", { name: "bosta" }));

    const citySelect = await screen.findByLabelText("Bosta city");
    expect(screen.getByLabelText("Bosta district")).toBeDisabled();
    expect(screen.getByLabelText("Goods value (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();

    await user.click(citySelect);
    await user.click(await screen.findByRole("option", { name: "Cairo" }));

    const districtSelect = await screen.findByLabelText("Bosta district");
    await waitFor(() => expect(districtSelect).not.toBeDisabled());
    await user.click(districtSelect);
    expect(await screen.findByRole("option", { name: "1st Settlement" })).toBeInTheDocument();
  });

  it("keeps Continue disabled for Bosta until both city and district are picked", async () => {
    const user = userEvent.setup();
    renderDialog(() => {});

    await user.click(screen.getByLabelText("Shipping company"));
    await user.click(await screen.findByRole("option", { name: "bosta" }));

    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(continueButton).toBeDisabled();

    const citySelect = await screen.findByLabelText("Bosta city");
    await user.click(citySelect);
    await user.click(await screen.findByRole("option", { name: "Cairo" }));
    expect(continueButton).toBeDisabled();

    const districtSelect = await screen.findByLabelText("Bosta district");
    await user.click(districtSelect);
    await user.click(await screen.findByRole("option", { name: "1st Settlement" }));
    // The recipient's first name is prefilled from the customer (async) and
    // is required for Bosta, same as city/district.
    await waitFor(() => expect(screen.getByLabelText("First name")).toHaveValue("Naruto"));
    expect(continueButton).not.toBeDisabled();
  });

  it("prefills the recipient name from the customer, and lets the zone narrow the district list", async () => {
    const user = userEvent.setup();
    renderDialog(() => {});

    await user.click(screen.getByLabelText("Shipping company"));
    await user.click(await screen.findByRole("option", { name: "bosta" }));

    await waitFor(() => expect(screen.getByLabelText("First name")).toHaveValue("Naruto"));
    expect(screen.getByLabelText("Last name")).toHaveValue("Uzumaki");

    const citySelect = await screen.findByLabelText("Bosta city");
    await user.click(citySelect);
    await user.click(await screen.findByRole("option", { name: "Cairo" }));

    const zoneSelect = await screen.findByLabelText("Zone");
    await user.click(zoneSelect);
    expect(await screen.findByRole("option", { name: "New Cairo" })).toBeInTheDocument();
  });

  it("sends city/district/notes/goodsValue/recipient/phone2/allowToOpenPackage to POST /shipping/shipments", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    renderDialog(onCreated);

    await user.click(screen.getByLabelText("Shipping company"));
    await user.click(await screen.findByRole("option", { name: "bosta" }));
    await waitFor(() => expect(screen.getByLabelText("First name")).toHaveValue("Naruto"));

    const citySelect = await screen.findByLabelText("Bosta city");
    await user.click(citySelect);
    await user.click(await screen.findByRole("option", { name: "Cairo" }));
    const districtSelect = await screen.findByLabelText("Bosta district");
    await user.click(districtSelect);
    await user.click(await screen.findByRole("option", { name: "1st Settlement" }));

    await user.clear(screen.getByLabelText("Last name"));
    await user.type(screen.getByLabelText("Last name"), "Namikaze");
    await user.type(screen.getByLabelText("Second phone (optional)"), "01099998888");
    await user.type(screen.getByLabelText("Goods value (optional)"), "123.45");
    await user.type(screen.getByLabelText("Notes"), "Ring the bell");
    await user.click(
      screen.getByLabelText("Allow the customer to open the package before accepting it"),
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(
      ([u, i]) =>
        String(u).endsWith("/shipping/shipments") && (i as RequestInit)?.method === "POST",
    );
    const body = JSON.parse(String((call?.[1] as RequestInit).body));
    expect(body).toMatchObject({
      orderId: "order-1",
      carrier: "bosta",
      bostaCityId: "c1",
      bostaCityName: "Cairo",
      bostaDistrictId: "d1",
      notes: "Ring the bell",
      goodsValue: 12345,
      recipientFirstName: "Naruto",
      recipientLastName: "Namikaze",
      recipientPhone2: "01099998888",
      allowToOpenPackage: true,
    });
  });
});

import { getConfig } from "@cadeau/config";
import { encrypt } from "@cadeau/crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarrierConnectionsRepositoryPort } from "../domain/carrier-connections-repository.port";
import {
  CarrierNotConnectedError,
  CodLimitExceededError,
  CustomerAddressMissingError,
  CustomerAddressNotMappedError,
  ReferenceNotFoundError,
} from "../domain/shipping.errors";
import { BostaCarrierAdapter } from "./bosta-carrier.adapter";

const config = getConfig();
const COMPANY = "11111111-1111-1111-1111-111111111111";
const ORDER = "22222222-2222-2222-2222-222222222222";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeAdapter(
  options: {
    order?: Record<string, unknown> | null;
    customer?: Record<string, unknown> | null;
    address?: Record<string, unknown> | null;
    connected?: boolean;
  } = {},
) {
  const order =
    options.order === undefined
      ? { customerId: "cust-1", total: 15_000n, collectedAmount: 0n }
      : options.order;
  const customer =
    options.customer === undefined
      ? { name: "Sasuke Uchiha", phoneEncrypted: encrypt("01065685435", config.encryption.key) }
      : options.customer;
  const address =
    options.address === undefined
      ? {
          lineEncrypted: encrypt("Helwan street x", config.encryption.key),
          landmark: "Near the school",
          bostaCityId: "cityId1",
          bostaDistrictId: "districtId1",
          bostaCityName: "Helwan",
        }
      : options.address;

  const tx = {
    order: { findFirst: vi.fn().mockResolvedValue(order) },
    customer: { findFirst: vi.fn().mockResolvedValue(customer) },
    customerAddress: { findFirst: vi.fn().mockResolvedValue(address) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  const prisma = { $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(tx)) };

  const connections = {
    list: vi.fn(),
    findActive: vi.fn().mockResolvedValue(
      options.connected === false
        ? null
        : {
            apiKeyEncrypted: encrypt("real-bosta-key", config.encryption.key),
            webhookTokenHash: "h",
          },
    ),
    upsert: vi.fn(),
    deactivate: vi.fn(),
  };

  const adapter = new BostaCarrierAdapter(
    prisma as never,
    connections as unknown as CarrierConnectionsRepositoryPort,
    config,
  );
  return { adapter, tx, connections };
}

describe("BostaCarrierAdapter.createShipment", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the Bosta payload from the order/customer/address and returns the tracking number", async () => {
    const { adapter } = makeAdapter();
    fetchMock.mockResolvedValueOnce(json(200, { data: { trackingNumber: "5108002" } }));

    const handle = await adapter.createShipment({ companyId: COMPANY, orderId: ORDER });

    expect(handle).toEqual({ trackingNumber: "5108002", carrier: "bosta" });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain("/deliveries?apiVersion=1");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("real-bosta-key");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      type: 10,
      cod: 150, // 15,000 minor units / 100
      businessReference: ORDER,
      uniqueBusinessReference: ORDER,
      dropOffAddress: {
        city: "Helwan",
        districtId: "districtId1",
        firstLine: "Helwan street x",
        secondLine: "Near the school",
      },
      receiver: { firstName: "Sasuke", lastName: "Uchiha", phone: "01065685435" },
    });
  });

  it("nets the COD against amount already collected", async () => {
    const { adapter } = makeAdapter({
      order: { customerId: "cust-1", total: 15_000n, collectedAmount: 5_000n },
    });
    fetchMock.mockResolvedValueOnce(json(200, { data: { trackingNumber: "5108002" } }));
    await adapter.createShipment({ companyId: COMPANY, orderId: ORDER });
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(init.body as string).cod).toBe(100);
  });

  it("rejects when the company has no active Bosta connection", async () => {
    const { adapter } = makeAdapter({ connected: false });
    await expect(
      adapter.createShipment({ companyId: COMPANY, orderId: ORDER }),
    ).rejects.toBeInstanceOf(CarrierNotConnectedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when the order is missing", async () => {
    const { adapter } = makeAdapter({ order: null });
    await expect(
      adapter.createShipment({ companyId: COMPANY, orderId: ORDER }),
    ).rejects.toBeInstanceOf(ReferenceNotFoundError);
  });

  it("rejects when the customer has no default address", async () => {
    const { adapter } = makeAdapter({ address: null });
    await expect(
      adapter.createShipment({ companyId: COMPANY, orderId: ORDER }),
    ).rejects.toBeInstanceOf(CustomerAddressMissingError);
  });

  it("refuses to guess when the address is not mapped to a Bosta city/district", async () => {
    const { adapter } = makeAdapter({
      address: {
        lineEncrypted: encrypt("Helwan street x", config.encryption.key),
        landmark: null,
        bostaCityId: null,
        bostaDistrictId: null,
        bostaCityName: null,
      },
    });
    await expect(
      adapter.createShipment({ companyId: COMPANY, orderId: ORDER }),
    ).rejects.toBeInstanceOf(CustomerAddressNotMappedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a COD amount over Bosta's 30,000 EGP cap", async () => {
    const { adapter } = makeAdapter({
      order: { customerId: "cust-1", total: 3_000_001n, collectedAmount: 0n },
    });
    await expect(
      adapter.createShipment({ companyId: COMPANY, orderId: ORDER }),
    ).rejects.toBeInstanceOf(CodLimitExceededError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("BostaCarrierAdapter.getTracking / cancelShipment / generateWaybill", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a known maskedState to our ShipmentStatus", async () => {
    const { adapter } = makeAdapter();
    fetchMock.mockResolvedValueOnce(
      json(200, { data: { trackingNumber: "5108002", maskedState: "In Transit" } }),
    );
    const info = await adapter.getTracking(COMPANY, "5108002");
    expect(info).toEqual({ trackingNumber: "5108002", status: "in_transit" });
  });

  it("falls back to 'created' for an unrecognized maskedState rather than guessing", async () => {
    const { adapter } = makeAdapter();
    fetchMock.mockResolvedValueOnce(
      json(200, { data: { trackingNumber: "5108002", maskedState: "Something New" } }),
    );
    const info = await adapter.getTracking(COMPANY, "5108002");
    expect(info.status).toBe("created");
  });

  it("cancels by resolving the internal id via the v2 business lookup, then DELETEing it on v1", async () => {
    const { adapter } = makeAdapter();
    fetchMock
      .mockResolvedValueOnce(
        json(200, { data: { _id: "SjY5yDvzHbmzBsm13zlIW", trackingNumber: "5108002" } }),
      )
      .mockResolvedValueOnce(
        json(200, { success: true, message: "Delivery canceled successfully!" }),
      );

    await adapter.cancelShipment(COMPANY, "5108002");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [lookupUrl, lookupInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(lookupUrl)).toBe("https://app.bosta.co/api/v2/deliveries/business/5108002");
    expect(lookupInit.method).toBe("GET");

    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(String(deleteUrl)).toBe("https://app.bosta.co/api/v1/deliveries/SjY5yDvzHbmzBsm13zlIW");
    expect(deleteInit.method).toBe("DELETE");
  });

  it("generateWaybill returns metadata only, requiring a live connection", async () => {
    const { adapter } = makeAdapter();
    const waybill = await adapter.generateWaybill(COMPANY, "5108002");
    expect(waybill).toEqual({ trackingNumber: "5108002", carrier: "bosta" });

    const { adapter: disconnected } = makeAdapter({ connected: false });
    await expect(disconnected.generateWaybill(COMPANY, "5108002")).rejects.toBeInstanceOf(
      CarrierNotConnectedError,
    );
  });
});

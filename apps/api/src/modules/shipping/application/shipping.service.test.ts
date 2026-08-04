import { getConfig } from "@cadeau/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppException } from "../../../shared/errors/app-exception";
import type { CarrierConnectionsRepositoryPort } from "../domain/carrier-connections-repository.port";
import { BostaCatalogCache } from "../infrastructure/bosta-catalog-cache";
import { BostaHttpClient } from "../infrastructure/bosta-http-client";
import type { ShipmentStatusChangeResult, ShipmentView } from "../domain/shipment.entity";
import type { ShippingAuditPort } from "../domain/shipping-audit.port";
import type { ShippingRepositoryPort } from "../domain/shipping-repository.port";
import {
  CarrierRejectedError,
  CarrierUnavailableError,
  DuplicateActiveShipmentError,
  DuplicateShipmentError,
  IllegalTransitionError,
  OrderNotShippableError,
  ReferenceNotFoundError,
} from "../domain/shipping.errors";
import { ShippingService } from "./shipping.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const SHIPMENT = "33333333-3333-3333-3333-333333333333";
const ORDER = "44444444-4444-4444-4444-444444444444";

function principal(overrides: Partial<RequestPrincipal> = {}): RequestPrincipal {
  return { userId: USER, sessionId: "s", companyId: COMPANY, ...overrides };
}

function shipment(extra: Partial<ShipmentView> = {}): ShipmentView {
  return {
    id: SHIPMENT,
    orderId: ORDER,
    carrier: "manual",
    trackingNumber: "MAN-ABC123",
    status: "created",
    fee: 0,
    waybillIssued: false,
    deliveredAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

interface Harness {
  service: ShippingService;
  repo: { [K in keyof ShippingRepositoryPort]: ReturnType<typeof vi.fn> };
  audit: { record: ReturnType<typeof vi.fn> };
  events: { publish: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
  connections: { [K in keyof CarrierConnectionsRepositoryPort]: ReturnType<typeof vi.fn> };
}

function makeHarness(): Harness {
  const repo = {
    findById: vi.fn().mockResolvedValue(shipment()),
    findByTrackingNumber: vi.fn().mockResolvedValue(shipment()),
    findLatestByOrderId: vi.fn().mockResolvedValue(shipment()),
    create: vi.fn().mockResolvedValue({ shipment: shipment(), replayed: false }),
    bulkCreate: vi.fn().mockResolvedValue({
      results: [{ orderId: ORDER, ok: true, shipmentId: SHIPMENT }],
      created: [{ shipment: shipment(), replayed: false }],
    }),
    transition: vi.fn().mockResolvedValue({
      shipment: shipment({ status: "picked_up" }),
      fromStatus: "created",
      toStatus: "picked_up",
      feeDeducted: 0,
    } satisfies ShipmentStatusChangeResult),
    issueWaybill: vi.fn().mockResolvedValue(shipment({ waybillIssued: true })),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const events = { publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn() };
  const clock = { now: (): number => 1_700_000_000_000 };
  const carrier = {
    name: "manual",
    createShipment: vi.fn(),
    getTracking: vi.fn(),
    generateWaybill: vi.fn().mockResolvedValue({ trackingNumber: "MAN-ABC123", carrier: "manual" }),
    cancelShipment: vi.fn(),
  };
  const connections = {
    list: vi.fn().mockResolvedValue([]),
    findActive: vi.fn().mockResolvedValue(null),
    upsert: vi.fn(),
    deactivate: vi.fn().mockResolvedValue("conn-1"),
  };
  const service = new ShippingService(
    repo as unknown as ShippingRepositoryPort,
    audit as unknown as ShippingAuditPort,
    events,
    clock,
    carrier,
    connections as unknown as CarrierConnectionsRepositoryPort,
    getConfig(),
    new BostaCatalogCache({ now: () => 1_700_000_000_000 }),
    new BostaHttpClient(getConfig().shipping.bostaBaseUrl),
  );
  return { service, repo, audit, events, connections };
}

describe("ShippingService", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("requires an active tenant", async () => {
    await expect(h.service.getOne(principal({ companyId: null }), SHIPMENT)).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it("gets an existing shipment", async () => {
    const result = await h.service.getOne(principal(), SHIPMENT);
    expect(result.id).toBe(SHIPMENT);
  });

  it("finds a shipment by tracking number (used by the M12.4 webhook processor)", async () => {
    const result = await h.service.findShipmentByTracking(COMPANY, "manual", "MAN-ABC123");
    expect(h.repo.findByTrackingNumber).toHaveBeenCalledWith(COMPANY, "manual", "MAN-ABC123");
    expect(result?.id).toBe(SHIPMENT);
  });

  describe("getByOrder", () => {
    it("returns the most recent shipment for an order", async () => {
      const result = await h.service.getByOrder(principal(), ORDER);
      expect(h.repo.findLatestByOrderId).toHaveBeenCalledWith(COMPANY, ORDER);
      expect(result.id).toBe(SHIPMENT);
    });

    it("throws not-found when the order has no shipment yet", async () => {
      h.repo.findLatestByOrderId.mockResolvedValueOnce(null);
      await expect(h.service.getByOrder(principal(), ORDER)).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe("create", () => {
    const body = { orderId: ORDER };

    it("audits and emits shipment.created on a fresh create", async () => {
      await h.service.create(principal(), body);
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "shipment.created", entityType: "shipment" }),
      );
      expect(h.events.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: "shipment.created" }),
      );
    });

    it("writes nothing on an idempotent replay", async () => {
      h.repo.create.mockResolvedValueOnce({ shipment: shipment(), replayed: true });
      await h.service.create(principal(), body);
      expect(h.audit.record).not.toHaveBeenCalled();
      expect(h.events.publish).not.toHaveBeenCalled();
    });

    it("maps a not-shippable order to 422", async () => {
      h.repo.create.mockRejectedValueOnce(new OrderNotShippableError("new"));
      await expect(h.service.create(principal(), body)).rejects.toMatchObject({ status: 422 });
    });

    it("maps a duplicate active shipment to 409", async () => {
      h.repo.create.mockRejectedValueOnce(new DuplicateActiveShipmentError());
      await expect(h.service.create(principal(), body)).rejects.toMatchObject({ status: 409 });
    });

    it("maps a duplicate idempotency key to 409", async () => {
      h.repo.create.mockRejectedValueOnce(new DuplicateShipmentError());
      await expect(h.service.create(principal(), body)).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("bulkCreate", () => {
    it("audits and emits once per created shipment", async () => {
      await h.service.bulkCreate(principal(), [{ orderId: ORDER }]);
      expect(h.audit.record).toHaveBeenCalledTimes(1);
      expect(h.events.publish).toHaveBeenCalledTimes(1);
    });

    it("skips audit/events for a replayed item in the batch", async () => {
      h.repo.bulkCreate.mockResolvedValueOnce({
        results: [{ orderId: ORDER, ok: true, shipmentId: SHIPMENT }],
        created: [{ shipment: shipment(), replayed: true }],
      });
      await h.service.bulkCreate(principal(), [{ orderId: ORDER }]);
      expect(h.audit.record).not.toHaveBeenCalled();
      expect(h.events.publish).not.toHaveBeenCalled();
    });
  });

  describe("transition", () => {
    it("audits shipment.status_changed and emits the event", async () => {
      await h.service.transition(principal(), SHIPMENT, { toStatus: "picked_up" });
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "shipment.status_changed" }),
      );
      expect(h.events.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: "shipment.status_changed" }),
      );
    });

    it("audits shipment.cancelled distinctly on cancel", async () => {
      h.repo.transition.mockResolvedValueOnce({
        shipment: shipment({ status: "cancelled" }),
        fromStatus: "created",
        toStatus: "cancelled",
        feeDeducted: 0,
      } satisfies ShipmentStatusChangeResult);
      await h.service.cancel(principal(), SHIPMENT);
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "shipment.cancelled" }),
      );
    });

    it("emits shipment.delivered in addition to status_changed when a fee was deducted", async () => {
      h.repo.transition.mockResolvedValueOnce({
        shipment: shipment({ status: "delivered", deliveredAt: "2026-01-02T00:00:00.000Z" }),
        fromStatus: "in_transit",
        toStatus: "delivered",
        feeDeducted: 2500,
      } satisfies ShipmentStatusChangeResult);
      await h.service.transition(principal(), SHIPMENT, { toStatus: "delivered" });
      expect(h.events.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: "shipment.status_changed" }),
      );
      expect(h.events.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "shipment.delivered",
          payload: expect.objectContaining({ feeMinor: 2500 }),
        }),
      );
    });

    it("throws not-found for a missing shipment", async () => {
      h.repo.transition.mockResolvedValueOnce(null);
      await expect(
        h.service.transition(principal(), SHIPMENT, { toStatus: "picked_up" }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("maps an illegal transition to 422", async () => {
      h.repo.transition.mockRejectedValueOnce(new IllegalTransitionError("created", "delivered"));
      await expect(
        h.service.transition(principal(), SHIPMENT, { toStatus: "delivered" }),
      ).rejects.toMatchObject({ status: 422 });
    });

    it("maps a reference-not-found error to 422 (carrying its field)", async () => {
      h.repo.transition.mockRejectedValueOnce(new ReferenceNotFoundError("orderId"));
      await expect(
        h.service.transition(principal(), SHIPMENT, { toStatus: "picked_up" }),
      ).rejects.toMatchObject({ status: 422 });
    });

    it("forwards an optional note through to the repository", async () => {
      await h.service.transition(principal(), SHIPMENT, {
        toStatus: "picked_up",
        note: "left at door",
      });
      expect(h.repo.transition).toHaveBeenCalledWith(expect.anything(), SHIPMENT, {
        toStatus: "picked_up",
        note: "left at door",
      });
    });

    it("cancel forwards an optional note through to transition", async () => {
      await h.service.cancel(principal(), SHIPMENT, "wrong address");
      expect(h.repo.transition).toHaveBeenCalledWith(expect.anything(), SHIPMENT, {
        toStatus: "cancelled",
        note: "wrong address",
      });
    });

    it("maps a carrier's rejection of a cancel to a 422 carrying the carrier's own message", async () => {
      h.repo.transition.mockRejectedValueOnce(
        new CarrierRejectedError("bosta", "Cannot terminate a delivered delivery"),
      );
      await expect(h.service.cancel(principal(), SHIPMENT)).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({
          message: "Cannot terminate a delivered delivery",
        }),
      });
    });

    it("maps a carrier outage during cancel to 503, not a swallowed generic error", async () => {
      h.repo.transition.mockRejectedValueOnce(
        new CarrierUnavailableError("bosta", "Bosta did not respond in time."),
      );
      await expect(h.service.cancel(principal(), SHIPMENT)).rejects.toMatchObject({
        status: 503,
        response: expect.objectContaining({
          message: "Bosta did not respond in time.",
        }),
      });
    });
  });

  describe("applySystemTransition (M12.4 webhook processor)", () => {
    it("applies the transition with a null actorId and records the audit/events", async () => {
      const result = await h.service.applySystemTransition(COMPANY, SHIPMENT, {
        toStatus: "picked_up",
      });
      expect(h.repo.transition).toHaveBeenCalledWith(
        { companyId: COMPANY, actorId: null },
        SHIPMENT,
        { toStatus: "picked_up" },
      );
      expect(h.audit.record).toHaveBeenCalledWith(expect.objectContaining({ actorId: null }));
      expect(result.id).toBe(SHIPMENT);
    });

    it("forwards an optional note", async () => {
      await h.service.applySystemTransition(COMPANY, SHIPMENT, {
        toStatus: "returned",
        note: "damaged in transit",
      });
      expect(h.repo.transition).toHaveBeenCalledWith(
        { companyId: COMPANY, actorId: null },
        SHIPMENT,
        { toStatus: "returned", note: "damaged in transit" },
      );
    });

    it("throws ReferenceNotFoundError (unwrapped) for a missing shipment", async () => {
      h.repo.transition.mockResolvedValueOnce(null);
      await expect(
        h.service.applySystemTransition(COMPANY, SHIPMENT, { toStatus: "picked_up" }),
      ).rejects.toBeInstanceOf(ReferenceNotFoundError);
    });
  });

  it("lists manual (always connected) and bosta (not connected by default)", async () => {
    expect(await h.service.listCarriers(principal())).toEqual([
      {
        id: null,
        carrier: "manual",
        connected: true,
        pickupLocationWarning: false,
        connectedAt: null,
      },
      {
        id: null,
        carrier: "bosta",
        connected: false,
        pickupLocationWarning: false,
        connectedAt: null,
      },
    ]);
  });

  describe("generateWaybill", () => {
    it("flips the metadata flag and audits shipment.waybill_issued", async () => {
      const result = await h.service.generateWaybill(principal(), SHIPMENT);
      expect(result.trackingNumber).toBe("MAN-ABC123");
      expect(h.repo.issueWaybill).toHaveBeenCalled();
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "shipment.waybill_issued" }),
      );
    });

    it("throws not-found for a missing shipment", async () => {
      h.repo.issueWaybill.mockResolvedValueOnce(null);
      await expect(h.service.generateWaybill(principal(), SHIPMENT)).rejects.toMatchObject({
        status: 404,
      });
    });
  });
});

function bostaResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("ShippingService.connectCarrier / disconnectCarrier", () => {
  let h: Harness;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    h = makeHarness();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects an unsupported carrier without probing anything", async () => {
    await expect(h.service.connectCarrier(principal(), "aramex", "some-key")).rejects.toMatchObject(
      { status: 400 },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates the key against Bosta, encrypts it, and persists the connection", async () => {
    fetchMock.mockResolvedValueOnce(
      bostaResponse(200, { success: true, data: { list: [{ _id: "loc1" }] } }),
    );
    h.connections.upsert.mockResolvedValueOnce({
      id: "conn-1",
      carrier: "bosta",
      connected: true,
      pickupLocationWarning: false,
      connectedAt: "2026-01-01T00:00:00.000Z",
    });

    const view = await h.service.connectCarrier(principal(), "bosta", "real-key");

    expect(view.connected).toBe(true);
    expect(view.pickupLocationWarning).toBe(false);
    const upsertArg = h.connections.upsert.mock.calls[0]?.[0];
    expect(upsertArg).toMatchObject({ companyId: COMPANY, carrier: "bosta", actorId: USER });
    expect(upsertArg.apiKeyEncrypted).not.toBe("real-key"); // encrypted, never stored raw
    expect(upsertArg.apiKeyEncrypted).toMatch(/^v1\./);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "carrier.connected", entityId: "conn-1" }),
    );
  });

  it("flags pickupLocationWarning when the business has no pickup location yet", async () => {
    fetchMock.mockResolvedValueOnce(bostaResponse(200, { success: true, data: { list: [] } }));
    h.connections.upsert.mockImplementationOnce((input) =>
      Promise.resolve({
        id: "conn-1",
        carrier: input.carrier,
        connected: true,
        pickupLocationWarning: input.pickupLocationWarning,
        connectedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    const view = await h.service.connectCarrier(principal(), "bosta", "real-key");
    expect(view.pickupLocationWarning).toBe(true);
  });

  it("rejects a bad key with a client-actionable error, persisting nothing", async () => {
    fetchMock.mockResolvedValueOnce(bostaResponse(401, { success: false }));
    await expect(h.service.connectCarrier(principal(), "bosta", "bad-key")).rejects.toMatchObject({
      status: 422,
    });
    expect(h.connections.upsert).not.toHaveBeenCalled();
  });

  it("maps a Bosta outage to 503", async () => {
    fetchMock.mockResolvedValueOnce(bostaResponse(500, { success: false }));
    await expect(h.service.connectCarrier(principal(), "bosta", "key")).rejects.toMatchObject({
      status: 503,
    });
  });

  it("disconnects an active connection and audits it", async () => {
    h.connections.deactivate.mockResolvedValueOnce("conn-1");
    await h.service.disconnectCarrier(principal(), "bosta");
    expect(h.connections.deactivate).toHaveBeenCalledWith(COMPANY, "bosta", USER);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "carrier.disconnected", entityId: "conn-1" }),
    );
  });

  it("404s disconnecting a carrier with no active connection", async () => {
    h.connections.deactivate.mockResolvedValueOnce(null);
    await expect(h.service.disconnectCarrier(principal(), "bosta")).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("ShippingService.listBostaCities / listBostaDistricts", () => {
  let h: Harness;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    h = makeHarness();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps and caches the city catalog, hitting Bosta only once", async () => {
    fetchMock.mockResolvedValueOnce(
      bostaResponse(200, {
        data: { list: [{ _id: "c1", name: "Cairo", nameAr: "القاهرة" }] },
      }),
    );

    const first = await h.service.listBostaCities(principal());
    expect(first).toEqual([{ id: "c1", name: "Cairo", nameAr: "القاهرة" }]);

    const second = await h.service.listBostaCities(principal());
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1); // second call served from cache
  });

  it("requires no API key for the public cities endpoint", async () => {
    fetchMock.mockResolvedValueOnce(bostaResponse(200, { data: { list: [] } }));
    await h.service.listBostaCities(principal());
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });

  it("maps and caches districts per city", async () => {
    fetchMock.mockResolvedValueOnce(
      bostaResponse(200, {
        data: [
          { districtId: "d1", districtName: "1st Settlement", zoneId: "z1", zoneName: "New Cairo" },
        ],
      }),
    );

    const districts = await h.service.listBostaDistricts(principal(), "c1");
    expect(districts).toEqual([
      { districtId: "d1", districtName: "1st Settlement", zoneId: "z1", zoneName: "New Cairo" },
    ]);

    await h.service.listBostaDistricts(principal(), "c1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps a Bosta outage while fetching the catalog to 503", async () => {
    fetchMock.mockResolvedValueOnce(bostaResponse(500, { success: false }));
    await expect(h.service.listBostaCities(principal())).rejects.toMatchObject({ status: 503 });
  });
});

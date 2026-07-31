import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppException } from "../../../shared/errors/app-exception";
import type { ShipmentStatusChangeResult, ShipmentView } from "../domain/shipment.entity";
import type { ShippingAuditPort } from "../domain/shipping-audit.port";
import type { ShippingRepositoryPort } from "../domain/shipping-repository.port";
import {
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
}

function makeHarness(): Harness {
  const repo = {
    findById: vi.fn().mockResolvedValue(shipment()),
    findByTrackingNumber: vi.fn().mockResolvedValue(shipment()),
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
  const service = new ShippingService(
    repo as unknown as ShippingRepositoryPort,
    audit as unknown as ShippingAuditPort,
    events,
    clock,
    carrier,
  );
  return { service, repo, audit, events };
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

  it("lists the manual carrier (D1)", () => {
    expect(h.service.listCarriers(principal())).toEqual([{ key: "manual" }]);
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

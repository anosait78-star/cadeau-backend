import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppLogger } from "../logging/app-logger";
import type { DomainEvent } from "./event-catalog";
import { InProcessEventBus } from "./in-process-event-bus";

/** A logger stub capturing error() calls, standing in for the global AppLogger. */
function makeLogger(): AppLogger & { errors: string[] } {
  const errors: string[] = [];
  return {
    errors,
    error: (message: unknown) => {
      errors.push(String(message));
    },
  } as unknown as AppLogger & { errors: string[] };
}

const featureToggled = (enabled: boolean): DomainEvent<"access.feature_toggled"> => ({
  type: "access.feature_toggled",
  companyId: "c1",
  actorId: "u1",
  occurredAt: 1_000,
  payload: { featureKey: "orders", enabled },
});

describe("InProcessEventBus", () => {
  let logger: AppLogger & { errors: string[] };
  let bus: InProcessEventBus;

  beforeEach(() => {
    logger = makeLogger();
    bus = new InProcessEventBus(logger);
  });

  it("delivers a published event to every subscriber of that type", async () => {
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe("access.feature_toggled", a);
    bus.subscribe("access.feature_toggled", b);

    const event = featureToggled(true);
    await bus.publish(event);

    expect(a).toHaveBeenCalledExactlyOnceWith(event);
    expect(b).toHaveBeenCalledExactlyOnceWith(event);
  });

  it("does not deliver to subscribers of a different type", async () => {
    const other = vi.fn();
    bus.subscribe("subscription.changed", other);

    await bus.publish(featureToggled(true));

    expect(other).not.toHaveBeenCalled();
  });

  it("is a no-op when nothing subscribes to the type", async () => {
    await expect(bus.publish(featureToggled(false))).resolves.toBeUndefined();
    expect(logger.errors).toHaveLength(0);
  });

  it("awaits async handlers before resolving", async () => {
    const order: string[] = [];
    bus.subscribe("access.feature_toggled", async () => {
      await Promise.resolve();
      order.push("handler");
    });

    await bus.publish(featureToggled(true));
    order.push("after-publish");

    expect(order).toEqual(["handler", "after-publish"]);
  });

  it("isolates a throwing subscriber: peers still run and publish resolves", async () => {
    const before = vi.fn();
    const after = vi.fn();
    bus.subscribe("access.feature_toggled", before);
    bus.subscribe("access.feature_toggled", () => {
      throw new Error("boom");
    });
    bus.subscribe("access.feature_toggled", after);

    await expect(bus.publish(featureToggled(true))).resolves.toBeUndefined();

    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toContain("access.feature_toggled");
    expect(logger.errors[0]).toContain("boom");
  });

  it("isolates a rejecting async subscriber the same way", async () => {
    const peer = vi.fn();
    bus.subscribe("access.feature_toggled", async () => {
      await Promise.reject(new Error("async-boom"));
    });
    bus.subscribe("access.feature_toggled", peer);

    await bus.publish(featureToggled(true));

    expect(peer).toHaveBeenCalledOnce();
    expect(logger.errors[0]).toContain("async-boom");
  });

  it("stops delivering after unsubscribe", async () => {
    const handler = vi.fn();
    const off = bus.subscribe("access.feature_toggled", handler);

    await bus.publish(featureToggled(true));
    off();
    await bus.publish(featureToggled(false));

    expect(handler).toHaveBeenCalledOnce();
  });

  it("unsubscribe is idempotent and does not remove a re-added handler", async () => {
    const handler = vi.fn();
    const off = bus.subscribe("access.feature_toggled", handler);
    off();
    off(); // second call is a no-op
    bus.subscribe("access.feature_toggled", handler);

    await bus.publish(featureToggled(true));

    expect(handler).toHaveBeenCalledOnce();
  });

  it("a handler unsubscribing during dispatch does not disturb the current publish", async () => {
    const seen: string[] = [];
    const off = bus.subscribe("access.feature_toggled", () => {
      seen.push("first");
      off(); // remove self mid-dispatch
    });
    bus.subscribe("access.feature_toggled", () => {
      seen.push("second");
    });

    await bus.publish(featureToggled(true));
    expect(seen).toEqual(["first", "second"]);

    // Next publish sees only the still-subscribed handler.
    seen.length = 0;
    await bus.publish(featureToggled(false));
    expect(seen).toEqual(["second"]);
  });
});

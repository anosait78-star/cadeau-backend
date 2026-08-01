import type { AppConfig } from "@cadeau/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveryProcessorService } from "../application/delivery-processor.service";
import { DeliveryRetryWorker } from "./delivery-retry-worker";

function configWith(isTest: boolean): AppConfig {
  return { isTest } as unknown as AppConfig;
}

function makeProcessor(): { processBatch: ReturnType<typeof vi.fn> } {
  return { processBatch: vi.fn().mockResolvedValue({ processed: 0, failed: 0 }) };
}

describe("DeliveryRetryWorker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not start polling under test (config.isTest)", async () => {
    const processor = makeProcessor();
    const worker = new DeliveryRetryWorker(
      configWith(true),
      processor as unknown as DeliveryProcessorService,
    );
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(processor.processBatch).not.toHaveBeenCalled();
  });

  it("polls on an interval outside test", async () => {
    const processor = makeProcessor();
    const worker = new DeliveryRetryWorker(
      configWith(false),
      processor as unknown as DeliveryProcessorService,
    );
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(processor.processBatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(processor.processBatch).toHaveBeenCalledTimes(2);
    worker.onModuleDestroy();
  });

  it("stops polling after onModuleDestroy", async () => {
    const processor = makeProcessor();
    const worker = new DeliveryRetryWorker(
      configWith(false),
      processor as unknown as DeliveryProcessorService,
    );
    worker.onModuleInit();
    worker.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(processor.processBatch).not.toHaveBeenCalled();
  });

  it("onModuleDestroy is a no-op when the worker never started", () => {
    const processor = makeProcessor();
    const worker = new DeliveryRetryWorker(
      configWith(true),
      processor as unknown as DeliveryProcessorService,
    );
    expect(() => {
      worker.onModuleDestroy();
    }).not.toThrow();
  });

  it("does not overlap ticks when a poll runs long", async () => {
    const processor = makeProcessor();
    let resolveFirst: (() => void) | undefined;
    processor.processBatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({ processed: 0, failed: 0 });
        }),
    );
    const worker = new DeliveryRetryWorker(
      configWith(false),
      processor as unknown as DeliveryProcessorService,
    );
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(processor.processBatch).toHaveBeenCalledTimes(1);
    resolveFirst?.();
    await vi.advanceTimersByTimeAsync(0);
    worker.onModuleDestroy();
  });

  it("logs but does not throw when processBatch rejects", async () => {
    const processor = makeProcessor();
    processor.processBatch.mockRejectedValueOnce(new Error("db down"));
    const worker = new DeliveryRetryWorker(
      configWith(false),
      processor as unknown as DeliveryProcessorService,
    );
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(processor.processBatch).toHaveBeenCalledTimes(1);
    worker.onModuleDestroy();
  });

  it("logs when a tick processed or failed at least one delivery", async () => {
    const processor = makeProcessor();
    processor.processBatch.mockResolvedValueOnce({ processed: 2, failed: 1 });
    const worker = new DeliveryRetryWorker(
      configWith(false),
      processor as unknown as DeliveryProcessorService,
    );
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(processor.processBatch).toHaveBeenCalledTimes(1);
    worker.onModuleDestroy();
  });
});

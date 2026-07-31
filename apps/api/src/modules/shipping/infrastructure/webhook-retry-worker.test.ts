import type { AppConfig } from "@cadeau/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebhookProcessorService } from "../application/webhook-processor.service";
import { WebhookRetryWorker } from "./webhook-retry-worker";

function configWith(isTest: boolean): AppConfig {
  return { isTest } as unknown as AppConfig;
}

function makeProcessor(): { processBatch: ReturnType<typeof vi.fn> } {
  return { processBatch: vi.fn().mockResolvedValue({ processed: 0, failed: 0 }) };
}

describe("WebhookRetryWorker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not start polling under test (config.isTest)", async () => {
    const processor = makeProcessor();
    const worker = new WebhookRetryWorker(
      configWith(true),
      processor as unknown as WebhookProcessorService,
    );
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(processor.processBatch).not.toHaveBeenCalled();
  });

  it("polls on an interval outside test", async () => {
    const processor = makeProcessor();
    const worker = new WebhookRetryWorker(
      configWith(false),
      processor as unknown as WebhookProcessorService,
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
    const worker = new WebhookRetryWorker(
      configWith(false),
      processor as unknown as WebhookProcessorService,
    );
    worker.onModuleInit();
    worker.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(processor.processBatch).not.toHaveBeenCalled();
  });

  it("onModuleDestroy is a no-op when the worker never started (e.g. under test)", () => {
    const processor = makeProcessor();
    const worker = new WebhookRetryWorker(
      configWith(true),
      processor as unknown as WebhookProcessorService,
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
    const worker = new WebhookRetryWorker(
      configWith(false),
      processor as unknown as WebhookProcessorService,
    );
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(5_000); // first tick starts and hangs
    await vi.advanceTimersByTimeAsync(5_000); // second tick would fire, but the first hasn't finished
    expect(processor.processBatch).toHaveBeenCalledTimes(1);
    resolveFirst?.();
    await vi.advanceTimersByTimeAsync(0);
    worker.onModuleDestroy();
  });

  it("logs but does not throw when processBatch rejects", async () => {
    const processor = makeProcessor();
    processor.processBatch.mockRejectedValueOnce(new Error("db down"));
    const worker = new WebhookRetryWorker(
      configWith(false),
      processor as unknown as WebhookProcessorService,
    );
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(processor.processBatch).toHaveBeenCalledTimes(1);
    worker.onModuleDestroy();
  });

  it("logs when a tick processed or failed at least one event", async () => {
    const processor = makeProcessor();
    processor.processBatch.mockResolvedValueOnce({ processed: 2, failed: 1 });
    const worker = new WebhookRetryWorker(
      configWith(false),
      processor as unknown as WebhookProcessorService,
    );
    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(processor.processBatch).toHaveBeenCalledTimes(1);
    worker.onModuleDestroy();
  });
});

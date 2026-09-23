import { describe, expect, it, vi } from "vitest";
import type { AttachmentRecord } from "../domain/message.entity";
import type { MessagingRepositoryPort } from "../domain/messaging-repository.port";
import {
  ORPHAN_BATCH_SIZE,
  ORPHAN_GRACE_MS,
  OrphanAttachmentSweeper,
} from "./orphan-attachment-sweeper";

const NOW = new Date("2026-09-23T12:00:00.000Z");

function orphan(id: string): AttachmentRecord {
  return {
    id,
    storageKey: `companies/c1/messages/${id}.webp`,
    mimeType: "image/webp",
    sizeBytes: 100,
    width: 10,
    height: 10,
  };
}

function makeSweeper(orphans: AttachmentRecord[]) {
  const repo = {
    findOrphanedAttachments: vi.fn().mockResolvedValue(orphans),
    deleteAttachments: vi.fn().mockImplementation((ids: string[]) => Promise.resolve(ids.length)),
  };
  const storage = {
    put: vi.fn(),
    getSignedUrl: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const sweeper = new OrphanAttachmentSweeper(repo as unknown as MessagingRepositoryPort, storage);
  return { sweeper, repo, storage };
}

describe("OrphanAttachmentSweeper", () => {
  it("does nothing when there is nothing to sweep", async () => {
    const { sweeper, storage, repo } = makeSweeper([]);

    expect(await sweeper.sweep(NOW)).toBe(0);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(repo.deleteAttachments).not.toHaveBeenCalled();
  });

  it("only considers uploads older than the grace period, in bounded batches", async () => {
    const { sweeper, repo } = makeSweeper([]);

    await sweeper.sweep(NOW);

    expect(repo.findOrphanedAttachments).toHaveBeenCalledWith(
      new Date(NOW.getTime() - ORPHAN_GRACE_MS),
      ORPHAN_BATCH_SIZE,
    );
  });

  // The object first: if the process dies between the two, the row survives
  // and the next pass retries. The other order would lose the only record of
  // the key and leak the bytes forever.
  it("deletes the object before dropping the row", async () => {
    const { sweeper, repo, storage } = makeSweeper([orphan("a")]);
    const order: string[] = [];
    storage.delete.mockImplementation(() => {
      order.push("object");
      return Promise.resolve();
    });
    repo.deleteAttachments.mockImplementation(() => {
      order.push("row");
      return Promise.resolve(1);
    });

    expect(await sweeper.sweep(NOW)).toBe(1);
    expect(order).toEqual(["object", "row"]);
  });

  it("keeps the row when its object could not be deleted, so the next pass retries", async () => {
    const { sweeper, repo, storage } = makeSweeper([orphan("a"), orphan("b")]);
    storage.delete.mockImplementation((key: string) =>
      key.endsWith("/a.webp") ? Promise.reject(new Error("bucket down")) : Promise.resolve(),
    );

    await sweeper.sweep(NOW);

    expect(repo.deleteAttachments).toHaveBeenCalledWith(["b"]);
  });

  it("sweeps the rest of the batch when one object fails", async () => {
    const { sweeper, storage } = makeSweeper([orphan("a"), orphan("b"), orphan("c")]);
    storage.delete.mockImplementationOnce(() => Promise.reject(new Error("bucket down")));

    expect(await sweeper.sweep(NOW)).toBe(2);
    expect(storage.delete).toHaveBeenCalledTimes(3);
  });
});

import { describe, expect, it } from "vitest";
import { DisabledFileStorage } from "./disabled-file-storage";
import { FileStorageError } from "./file-storage.port";

describe("DisabledFileStorage", () => {
  it("rejects every operation with a FileStorageError", async () => {
    const storage = new DisabledFileStorage();
    await expect(storage.put("k", Buffer.from("x"), "image/webp")).rejects.toBeInstanceOf(
      FileStorageError,
    );
    await expect(storage.getSignedUrl("k", 60)).rejects.toBeInstanceOf(FileStorageError);
    await expect(storage.delete("k")).rejects.toBeInstanceOf(FileStorageError);
  });

  it("carries a 503 status so callers can map it to a temporary failure", async () => {
    const storage = new DisabledFileStorage();
    await expect(storage.put("k", Buffer.from("x"), "image/webp")).rejects.toMatchObject({
      status: 503,
    });
  });
});

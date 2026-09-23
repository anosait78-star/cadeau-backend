import { describe, expect, it } from "vitest";
import { FileStorageError } from "./file-storage.port";
import { InMemoryFileStorage } from "./in-memory-file-storage";

const KEY = "companies/c1/messages/a.webp";

function bytes(text = "image-bytes"): Buffer {
  return Buffer.from(text, "utf8");
}

describe("InMemoryFileStorage", () => {
  it("stores bytes and reads them back with their content type", async () => {
    const storage = new InMemoryFileStorage();

    await storage.put(KEY, bytes(), "image/webp");

    expect(storage.read(KEY)).toEqual({ body: bytes(), contentType: "image/webp" });
    expect(storage.keys()).toEqual([KEY]);
  });

  // The caller keeps its own reference to the buffer it passed in; if the store
  // held that same instance, a later mutation would silently rewrite the object.
  it("copies the bytes rather than aliasing the caller's buffer", async () => {
    const storage = new InMemoryFileStorage();
    const original = bytes("abc");

    await storage.put(KEY, original, "image/webp");
    original.write("xyz");

    expect(storage.read(KEY)?.body.toString()).toBe("abc");
  });

  it("replaces what is stored under a key it already has", async () => {
    const storage = new InMemoryFileStorage();

    await storage.put(KEY, bytes("first"), "image/webp");
    await storage.put(KEY, bytes("second"), "image/webp");

    expect(storage.read(KEY)?.body.toString()).toBe("second");
    expect(storage.keys()).toHaveLength(1);
  });

  it("hands out a URL that carries the key and an expiry", async () => {
    const storage = new InMemoryFileStorage();
    await storage.put(KEY, bytes(), "image/webp");

    const url = new URL(await storage.getSignedUrl(KEY, 300));

    expect(decodeURIComponent(url.host + url.pathname)).toBe(KEY);
    expect(Number(url.searchParams.get("expiresAt"))).toBeGreaterThan(Date.now());
  });

  it("refuses to sign a URL for an object it does not have", async () => {
    const storage = new InMemoryFileStorage();

    await expect(storage.getSignedUrl("missing.webp", 300)).rejects.toBeInstanceOf(
      FileStorageError,
    );
  });

  it("removes an object", async () => {
    const storage = new InMemoryFileStorage();
    await storage.put(KEY, bytes(), "image/webp");

    await storage.delete(KEY);

    expect(storage.read(KEY)).toBeUndefined();
  });

  // Same contract as the S3 adapter: the caller wanted it gone, and it is.
  it("treats deleting an absent object as success", async () => {
    const storage = new InMemoryFileStorage();

    await expect(storage.delete("missing.webp")).resolves.toBeUndefined();
  });

  it("empties itself on clear", async () => {
    const storage = new InMemoryFileStorage();
    await storage.put(KEY, bytes(), "image/webp");

    storage.clear();

    expect(storage.keys()).toEqual([]);
  });
});

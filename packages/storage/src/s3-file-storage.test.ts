import { describe, expect, it, vi } from "vitest";
import { FileStorageError } from "./file-storage.port";
import { S3FileStorage, type S3StorageConfig } from "./s3-file-storage";

const config: S3StorageConfig = {
  endpoint: "https://s3.eu-central-1.amazonaws.com",
  bucket: "cadeau-uploads",
  region: "eu-central-1",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  forcePathStyle: true,
};

function makeStorage(response: Response | Error, overrides: Partial<S3StorageConfig> = {}) {
  const fetchImpl = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  const storage = new S3FileStorage({ ...config, ...overrides }, fetchImpl);
  return { storage, fetchImpl };
}

function ok(status = 200): Response {
  return new Response(null, { status });
}

describe("S3FileStorage — put", () => {
  it("PUTs the bytes to the path-style object URL with a signature", async () => {
    const { storage, fetchImpl } = makeStorage(ok());

    await storage.put("companies/c1/messages/a.webp", Buffer.from("bytes"), "image/webp");

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://s3.eu-central-1.amazonaws.com/cadeau-uploads/companies/c1/messages/a.webp",
    );
    expect(init?.method).toBe("PUT");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toContain("AWS4-HMAC-SHA256");
    expect(headers["content-type"]).toBe("image/webp");
    expect(headers["content-length"]).toBe("5");
  });

  it("uses the virtual-host URL when path style is off", async () => {
    const { storage, fetchImpl } = makeStorage(ok(), { forcePathStyle: false });

    await storage.put("a.webp", Buffer.from("x"), "image/webp");

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://cadeau-uploads.s3.eu-central-1.amazonaws.com/a.webp",
    );
  });

  it("tolerates a trailing slash on the configured endpoint", async () => {
    const { storage, fetchImpl } = makeStorage(ok(), {
      endpoint: "https://s3.eu-central-1.amazonaws.com/",
    });

    await storage.put("a.webp", Buffer.from("x"), "image/webp");

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://s3.eu-central-1.amazonaws.com/cadeau-uploads/a.webp",
    );
  });

  // Encoding alone does not defuse these: `.` is unreserved, so `..` passes
  // through percent-encoding untouched and the path gets normalized downstream,
  // addressing an object outside the intended prefix.
  it.each(["companies/c1/../../etc/passwd", "a//b", "", "./a", "a/."])(
    "refuses to address the un-addressable key %j",
    async (key) => {
      const { storage, fetchImpl } = makeStorage(ok());

      await expect(storage.put(key, Buffer.from("x"), "image/webp")).rejects.toBeInstanceOf(
        FileStorageError,
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("raises a storage error when the bucket rejects the write", async () => {
    const { storage } = makeStorage(ok(403));

    await expect(storage.put("a.webp", Buffer.from("x"), "image/webp")).rejects.toBeInstanceOf(
      FileStorageError,
    );
  });

  it("raises a storage error when the bucket is unreachable", async () => {
    const { storage } = makeStorage(new Error("ECONNREFUSED"));

    await expect(storage.put("a.webp", Buffer.from("x"), "image/webp")).rejects.toMatchObject({
      name: "FileStorageError",
    });
  });
});

describe("S3FileStorage — getSignedUrl", () => {
  it("returns a presigned URL that carries its own expiry", async () => {
    const { storage, fetchImpl } = makeStorage(ok());

    const url = await storage.getSignedUrl("companies/c1/a.webp", 300);

    const params = new URL(url).searchParams;
    expect(params.get("X-Amz-Expires")).toBe("300");
    expect(params.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    // Handing out a link must not require talking to the bucket.
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("S3FileStorage — delete", () => {
  it("DELETEs the object", async () => {
    const { storage, fetchImpl } = makeStorage(ok(204));

    await storage.delete("companies/c1/a.webp");

    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("DELETE");
  });

  // The caller asked for the object to be gone; it is.
  it("treats an already-absent object as success", async () => {
    const { storage } = makeStorage(ok(404));

    await expect(storage.delete("gone.webp")).resolves.toBeUndefined();
  });

  it("raises on any other failure", async () => {
    const { storage } = makeStorage(ok(500));

    await expect(storage.delete("a.webp")).rejects.toBeInstanceOf(FileStorageError);
  });
});

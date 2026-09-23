import { FileStorageError, type FileStoragePort } from "./file-storage.port";

/** What an in-memory store kept for one key. */
export interface StoredObject {
  readonly body: Buffer;
  readonly contentType: string;
}

/**
 * An in-process {@link FileStoragePort} for tests and local runs with no
 * bucket (EPIC-17 · M17.3).
 *
 * Not for production: the contents live in one process's heap and vanish with
 * it, and the "signed" URLs it hands out are opaque strings nothing can
 * actually fetch. It exists so the upload path can be exercised end to end
 * without credentials.
 */
export class InMemoryFileStorage implements FileStoragePort {
  private readonly objects = new Map<string, StoredObject>();

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType });
    return Promise.resolve();
  }

  // `async`, not a synchronous throw: the port is async, so a caller awaits or
  // `.catch()`es this — a sync throw would escape past both and behave
  // differently from the S3 adapter for the same mistake.
  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    if (!this.objects.has(key)) {
      throw new FileStorageError(`No object stored under '${key}'.`, 404);
    }
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    return `memory://${encodeURIComponent(key)}?expiresAt=${expiresAt}`;
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  // ---- test helpers ----------------------------------------------------------

  /** What is stored under `key`, or `undefined`. */
  read(key: string): StoredObject | undefined {
    return this.objects.get(key);
  }

  /** Every key currently held. */
  keys(): string[] {
    return [...this.objects.keys()];
  }

  clear(): void {
    this.objects.clear();
  }
}

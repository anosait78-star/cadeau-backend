/**
 * The object-storage contract (EPIC-17 · M17.3).
 *
 * Deliberately tiny: put bytes under a key, hand out a short-lived URL to read
 * them, delete. Anything richer (listing, copying, lifecycle rules) belongs to
 * the bucket's own configuration, not to application code.
 *
 * Objects are private. Nothing here returns a public URL — reads always go
 * through {@link FileStoragePort.getSignedUrl}, so an object is only ever
 * reachable by someone the application has just authorized.
 */
export interface FileStoragePort {
  /** Stores (or replaces) the object at `key`. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;

  /**
   * A URL that reads the object and stops working after `expiresInSeconds`.
   * The expiry is a cap on how long a leaked link stays useful, so callers
   * pass the shortest window their UI can live with.
   */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;

  /** Removes the object. Deleting a key that is already gone is not an error. */
  delete(key: string): Promise<void>;
}

/** Raised when the store rejects or fails a request. */
export class FileStorageError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FileStorageError";
  }
}

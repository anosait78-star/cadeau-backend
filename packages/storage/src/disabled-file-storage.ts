import { FileStorageError, type FileStoragePort } from "./file-storage.port";

/**
 * A {@link FileStoragePort} that refuses every call (EPIC-17). For a
 * production/staging deploy with no bucket configured yet — the feature that
 * needs it (message attachments) is meant to be temporarily unavailable, not
 * a reason for the whole process to fail to boot. Every other route in the
 * app is unrelated to object storage and must keep working.
 *
 * Contrast with {@link ../in-memory-file-storage.ts | InMemoryFileStorage}:
 * that one silently "succeeds" and then loses the data on restart, which is
 * fine for a developer with no credentials but actively misleading in
 * production — a caller here gets an honest, immediate failure instead.
 */
export class DisabledFileStorage implements FileStoragePort {
  async put(): Promise<void> {
    throw new FileStorageError(
      "Image uploads are temporarily unavailable — object storage is not configured.",
      503,
    );
  }

  async getSignedUrl(): Promise<string> {
    throw new FileStorageError(
      "Image uploads are temporarily unavailable — object storage is not configured.",
      503,
    );
  }

  async delete(): Promise<void> {
    throw new FileStorageError(
      "Image uploads are temporarily unavailable — object storage is not configured.",
      503,
    );
  }
}

/**
 * `@cadeau/storage` — object storage for user-uploaded files (EPIC-17).
 *
 * A small port with two adapters: an S3-compatible one signed by a self-built
 * AWS SigV4 implementation (`node:crypto` + `fetch`, no vendor SDK), and an
 * in-memory one for tests.
 */
export { FileStorageError } from "./file-storage.port";
export type { FileStoragePort } from "./file-storage.port";

export { S3FileStorage } from "./s3-file-storage";
export type { FetchLike, S3StorageConfig } from "./s3-file-storage";

export { InMemoryFileStorage } from "./in-memory-file-storage";
export type { StoredObject } from "./in-memory-file-storage";

export { MAX_PRESIGN_SECONDS, presignUrl, signRequest, uriEncode } from "./sigv4";
export type { PresignInput, SignRequestInput, SignedRequest, SigV4Credentials } from "./sigv4";

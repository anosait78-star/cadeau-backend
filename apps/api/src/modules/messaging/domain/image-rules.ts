/**
 * What counts as an acceptable image upload (EPIC-17 · M17.3).
 *
 * Pure checks over the raw bytes, kept out of the processor so the rules that
 * decide what the server will open can be tested directly. Nothing here trusts
 * the client: not the declared content type, not the filename, not the size
 * the request claimed.
 */

/** Largest upload accepted, matching `message_attachments_size_check`. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Longest edge of the stored image; anything larger is scaled down. */
export const MAX_IMAGE_EDGE = 2048;

/** Attachments allowed on one message — enough for a shelf, not a photo dump. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/** What every stored attachment is re-encoded to. */
export const STORED_MIME_TYPE = "image/webp";

/** The formats we are willing to decode. */
export type AcceptedImageFormat = "jpeg" | "png" | "webp";

/**
 * Leading bytes that identify each accepted format.
 *
 * The magic bytes are the only evidence worth acting on: `Content-Type` and
 * the filename are attacker-controlled, so a `.png` that is really a script is
 * exactly the upload this check exists to reject.
 */
const SIGNATURES: readonly { format: AcceptedImageFormat; bytes: readonly number[] }[] = [
  { format: "jpeg", bytes: [0xff, 0xd8, 0xff] },
  { format: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // RIFF....WEBP — bytes 8..11 are checked separately, below.
  { format: "webp", bytes: [0x52, 0x49, 0x46, 0x46] },
];

function startsWith(buffer: Buffer, bytes: readonly number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

/**
 * The format the bytes actually are, or `null` if they are not an image we
 * accept. A RIFF container must also declare `WEBP`, since RIFF is a wrapper
 * used for audio and video too.
 */
export function detectImageFormat(buffer: Buffer): AcceptedImageFormat | null {
  for (const signature of SIGNATURES) {
    if (!startsWith(buffer, signature.bytes)) continue;
    if (signature.format === "webp") {
      if (buffer.length < 12 || buffer.toString("ascii", 8, 12) !== "WEBP") return null;
    }
    return signature.format;
  }
  return null;
}

/** Why an upload was refused. */
export type UploadRejection = "empty" | "too-large" | "unsupported-format";

/**
 * Whether these bytes may be handed to the image decoder.
 *
 * Size is checked before format so an oversized file is refused without
 * inspecting it, and both are checked before the decoder runs — the decoder is
 * the largest attack surface in this path, so it only ever sees bytes that
 * already look like an image we asked for.
 */
export function validateUpload(buffer: Buffer): UploadRejection | null {
  if (buffer.length === 0) return "empty";
  if (buffer.length > MAX_UPLOAD_BYTES) return "too-large";
  if (detectImageFormat(buffer) === null) return "unsupported-format";
  return null;
}

/** A human-readable reason for each rejection, for the API error body. */
export function describeRejection(rejection: UploadRejection): string {
  switch (rejection) {
    case "empty":
      return "The uploaded file is empty.";
    case "too-large":
      return `Images must be ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB or smaller.`;
    case "unsupported-format":
      return "Only JPEG, PNG and WebP images can be uploaded.";
  }
}

/**
 * The object key an attachment is stored under.
 *
 * Company-prefixed so a bucket listing is already partitioned by tenant, and
 * named by a server-generated id — never by anything the uploader supplied,
 * which is how a filename turns into a path or overwrites someone else's
 * object.
 */
export function attachmentStorageKey(companyId: string, attachmentId: string): string {
  return `companies/${companyId}/messages/${attachmentId}.webp`;
}

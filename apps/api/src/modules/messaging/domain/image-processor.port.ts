/** A re-encoded image, ready to store. */
export interface ProcessedImage {
  readonly body: Buffer;
  readonly contentType: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Turns whatever was uploaded into the one format we store (EPIC-17 · M17.3).
 *
 * Re-encoding, not passing bytes through, is the point. It drops EXIF — which
 * carries the GPS coordinates of wherever the photo was taken — and it means a
 * file that is both a valid image and a valid script cannot survive: what gets
 * stored is what our encoder produced, not what the uploader sent.
 */
export interface ImageProcessorPort {
  /** Throws {@link ImageProcessingError} if the bytes cannot be decoded. */
  toStorableImage(source: Buffer): Promise<ProcessedImage>;
}

/** The decoder refused the bytes, or the re-encode failed. */
export class ImageProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageProcessingError";
  }
}

/** DI token for {@link ImageProcessorPort}. */
export const IMAGE_PROCESSOR = Symbol("IMAGE_PROCESSOR");

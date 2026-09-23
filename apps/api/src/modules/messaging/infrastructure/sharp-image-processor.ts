import { Injectable } from "@nestjs/common";
import sharp from "sharp";
import {
  ImageProcessingError,
  type ImageProcessorPort,
  type ProcessedImage,
} from "../domain/image-processor.port";
import { MAX_IMAGE_EDGE, STORED_MIME_TYPE } from "../domain/image-rules";

/** Quality/effort for the stored WebP — visually clean at a fraction of the bytes. */
const WEBP_QUALITY = 82;

/**
 * Re-encodes uploads to WebP with `sharp` (EPIC-17 · M17.3).
 *
 * Three things happen here that a straight byte copy would not do:
 *
 *   - **Metadata is dropped.** `sharp` keeps none by default, and a phone
 *     photo's EXIF carries the GPS coordinates of where it was taken. A vendor
 *     photographing stock in their warehouse should not be publishing its
 *     location to everyone in the conversation (docs/privacy-model.md).
 *   - **The output is ours.** A file crafted to be both a valid image and a
 *     valid script does not survive decode-and-re-encode: what we store is
 *     what our encoder emitted.
 *   - **Dimensions are capped.** A 20000×20000 image is small compressed and
 *     enormous decoded, so the edge limit bounds what any later resize costs.
 *
 * `limitInputPixels` bounds the decode itself: without it a "decompression
 * bomb" — a tiny file declaring a vast canvas — allocates its full pixel
 * buffer before any of our limits are consulted.
 */
@Injectable()
export class SharpImageProcessor implements ImageProcessorPort {
  async toStorableImage(source: Buffer): Promise<ProcessedImage> {
    try {
      const pipeline = sharp(source, {
        // ~178 megapixels; comfortably above any real photo, far below what a
        // crafted header can claim.
        limitInputPixels: MAX_IMAGE_EDGE * MAX_IMAGE_EDGE * 42,
        // One frame only: an animated GIF/WebP would otherwise be re-encoded
        // frame by frame into something far larger than it arrived.
        animated: false,
      })
        // Honour the EXIF orientation flag before stripping it, so a portrait
        // photo does not come back on its side once the metadata is gone.
        .rotate()
        .resize({
          width: MAX_IMAGE_EDGE,
          height: MAX_IMAGE_EDGE,
          fit: "inside",
          // Never upscale: a small image stays small rather than being blown
          // up to the cap.
          withoutEnlargement: true,
        })
        .webp({ quality: WEBP_QUALITY });

      const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
      return {
        body: data,
        contentType: STORED_MIME_TYPE,
        width: info.width,
        height: info.height,
      };
    } catch (cause) {
      // The decoder's own messages name internal libraries and file offsets;
      // neither helps the uploader, and both describe our internals.
      throw new ImageProcessingError(
        `The image could not be processed: ${cause instanceof Error ? cause.message : "unknown error"}`,
      );
    }
  }
}

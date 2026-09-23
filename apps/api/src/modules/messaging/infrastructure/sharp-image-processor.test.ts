import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ImageProcessingError } from "../domain/image-processor.port";
import { MAX_IMAGE_EDGE, STORED_MIME_TYPE } from "../domain/image-rules";
import { SharpImageProcessor } from "./sharp-image-processor";

const processor = new SharpImageProcessor();

function solid(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } },
  });
}

describe("SharpImageProcessor", () => {
  it("re-encodes an uploaded JPEG as WebP", async () => {
    const jpeg = await solid(64, 48).jpeg().toBuffer();

    const result = await processor.toStorableImage(jpeg);

    expect(result.contentType).toBe(STORED_MIME_TYPE);
    expect(await sharp(result.body).metadata()).toMatchObject({ format: "webp" });
    expect(result).toMatchObject({ width: 64, height: 48 });
  });

  it("re-encodes PNG and WebP sources too", async () => {
    for (const source of [
      await solid(20, 20).png().toBuffer(),
      await solid(20, 20).webp().toBuffer(),
    ]) {
      const result = await processor.toStorableImage(source);
      expect(await sharp(result.body).metadata()).toMatchObject({ format: "webp" });
    }
  });

  // A phone photo's EXIF carries where it was taken. A vendor sending a picture
  // of stock should not be publishing their warehouse's coordinates with it.
  // The fixture uses IFD0 tags rather than a GPS block because sharp's
  // `withExif` types cover IFD0 only; the processor keeps no EXIF at all, so
  // dropping these is the same evidence as dropping GPS would be.
  it("strips EXIF from the stored image", async () => {
    const withExif = await solid(32, 32)
      .withExif({ IFD0: { Copyright: "vendor-co", Make: "TestPhone" } })
      .jpeg()
      .toBuffer();
    // The fixture is only meaningful if the metadata really is in there.
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const result = await processor.toStorableImage(withExif);

    const metadata = await sharp(result.body).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(result.body.toString("latin1")).not.toContain("vendor-co");
    expect(result.body.toString("latin1")).not.toContain("TestPhone");
  });

  it("scales an oversized image down to the edge limit, keeping its shape", async () => {
    const huge = await solid(MAX_IMAGE_EDGE * 2, MAX_IMAGE_EDGE)
      .png()
      .toBuffer();

    const result = await processor.toStorableImage(huge);

    expect(result.width).toBe(MAX_IMAGE_EDGE);
    expect(result.height).toBe(MAX_IMAGE_EDGE / 2);
  });

  it("leaves a small image at its own size rather than enlarging it", async () => {
    const small = await solid(10, 10).png().toBuffer();

    const result = await processor.toStorableImage(small);

    expect(result).toMatchObject({ width: 10, height: 10 });
  });

  // Rotating before the metadata is dropped keeps a portrait photo upright.
  it("applies the EXIF orientation before discarding it", async () => {
    // `withMetadata({ orientation })`, not `withExif` — the latter writes the
    // tag into IFD0 without sharp treating it as the image's orientation, so
    // the fixture would carry no rotation to apply.
    const rotated = await solid(40, 20).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    expect((await sharp(rotated).metadata()).orientation).toBe(6);

    const result = await processor.toStorableImage(rotated);

    expect(result).toMatchObject({ width: 20, height: 40 });
  });

  it("raises a processing error for bytes that are not a decodable image", async () => {
    await expect(
      processor.toStorableImage(Buffer.from("not an image at all", "utf8")),
    ).rejects.toBeInstanceOf(ImageProcessingError);
  });

  it("raises a processing error rather than crashing on a truncated image", async () => {
    const jpeg = await solid(64, 64).jpeg().toBuffer();

    await expect(processor.toStorableImage(jpeg.subarray(0, 20))).rejects.toBeInstanceOf(
      ImageProcessingError,
    );
  });
});

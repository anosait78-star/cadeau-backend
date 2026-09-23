import { describe, expect, it } from "vitest";
import {
  attachmentStorageKey,
  describeRejection,
  detectImageFormat,
  MAX_UPLOAD_BYTES,
  validateUpload,
} from "./image-rules";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function webp(fourCC = "WEBP"): Buffer {
  return Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from(fourCC, "ascii"),
  ]);
}

describe("detectImageFormat", () => {
  it.each([
    ["jpeg", JPEG],
    ["png", PNG],
    ["webp", webp()],
  ])("recognizes %s from its magic bytes", (format, buffer) => {
    expect(detectImageFormat(buffer)).toBe(format);
  });

  it("rejects bytes that are not an image at all", () => {
    expect(detectImageFormat(Buffer.from("#!/bin/sh\nrm -rf /", "utf8"))).toBeNull();
  });

  // RIFF wraps audio and video too, so the container alone proves nothing.
  it("rejects a RIFF container that is not WebP", () => {
    expect(detectImageFormat(webp("WAVE"))).toBeNull();
  });

  it("rejects a truncated file whose signature cannot be read", () => {
    expect(detectImageFormat(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageFormat(Buffer.from("RIFF", "ascii"))).toBeNull();
  });

  it("rejects an empty buffer", () => {
    expect(detectImageFormat(Buffer.alloc(0))).toBeNull();
  });
});

describe("validateUpload", () => {
  it("accepts an image of an allowed format", () => {
    expect(validateUpload(PNG)).toBeNull();
  });

  it("refuses an empty file", () => {
    expect(validateUpload(Buffer.alloc(0))).toBe("empty");
  });

  it("refuses anything over the size ceiling", () => {
    const oversized = Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES)]);
    expect(validateUpload(oversized)).toBe("too-large");
  });

  it("accepts a file exactly at the ceiling", () => {
    const exact = Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES - PNG.length)]);
    expect(exact).toHaveLength(MAX_UPLOAD_BYTES);
    expect(validateUpload(exact)).toBeNull();
  });

  // The whole point: a script named .png must never reach the decoder.
  it("refuses a non-image whatever it claims to be", () => {
    expect(validateUpload(Buffer.from("<?php system($_GET[0]); ?>", "utf8"))).toBe(
      "unsupported-format",
    );
  });

  // Size first: an oversized file is refused without being inspected.
  it("reports size rather than format for an oversized non-image", () => {
    expect(validateUpload(Buffer.alloc(MAX_UPLOAD_BYTES + 1))).toBe("too-large");
  });
});

describe("describeRejection", () => {
  it("explains each rejection in terms the uploader can act on", () => {
    expect(describeRejection("too-large")).toContain("5MB");
    expect(describeRejection("unsupported-format")).toContain("JPEG");
    expect(describeRejection("empty")).toContain("empty");
  });
});

describe("attachmentStorageKey", () => {
  it("partitions objects by company and names them by the server's own id", () => {
    expect(attachmentStorageKey("c-1", "a-2")).toBe("companies/c-1/messages/a-2.webp");
  });
});

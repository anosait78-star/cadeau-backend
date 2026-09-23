import { describe, expect, it } from "vitest";
import type { Participant } from "./message.entity";
import {
  buildPreview,
  canAccessThread,
  isVendor,
  PREVIEW_MAX,
  senderKindOf,
  type ThreadIdentity,
} from "./participation";

const staff: Participant = { memberId: "m-staff", warehouseId: null };
const vendorA: Participant = { memberId: "m-a", warehouseId: "wh-a" };
const vendorB: Participant = { memberId: "m-b", warehouseId: "wh-b" };

const threadA: ThreadIdentity = { id: "t-a", warehouseId: "wh-a" };
const threadB: ThreadIdentity = { id: "t-b", warehouseId: "wh-b" };

describe("senderKindOf", () => {
  it("reads an unscoped member as staff", () => {
    expect(senderKindOf(staff)).toBe("staff");
  });

  it("reads a warehouse-scoped member as a vendor", () => {
    expect(senderKindOf(vendorA)).toBe("vendor");
  });
});

describe("isVendor", () => {
  it("is true only when the membership is confined to a warehouse", () => {
    expect(isVendor(vendorA)).toBe(true);
    expect(isVendor(staff)).toBe(false);
  });
});

describe("canAccessThread", () => {
  it("lets staff into any thread in the company", () => {
    expect(canAccessThread(staff, threadA)).toBe(true);
    expect(canAccessThread(staff, threadB)).toBe(true);
  });

  it("lets a vendor into their own warehouse's thread", () => {
    expect(canAccessThread(vendorA, threadA)).toBe(true);
  });

  // The isolation this whole module turns on: one vendor must never reach
  // another's conversation, even though both threads live in one company.
  it("keeps a vendor out of another vendor's thread", () => {
    expect(canAccessThread(vendorA, threadB)).toBe(false);
    expect(canAccessThread(vendorB, threadA)).toBe(false);
  });
});

describe("buildPreview", () => {
  it("collapses whitespace so a multi-line message previews as one line", () => {
    expect(buildPreview("first line\n\n  second   line ")).toBe("first line second line");
  });

  it("has no preview for an image-only message", () => {
    expect(buildPreview(null)).toBeNull();
  });

  it("has no preview for a body that is only whitespace", () => {
    expect(buildPreview("   \n\t ")).toBeNull();
  });

  it("keeps a body that already fits", () => {
    const body = "a".repeat(PREVIEW_MAX);
    expect(buildPreview(body)).toBe(body);
  });

  // The ellipsis has to fit inside the budget too, or the stored preview
  // would break `message_threads_preview_check`.
  it("truncates a longer body to the constraint's limit, ellipsis included", () => {
    const preview = buildPreview("a".repeat(PREVIEW_MAX + 50));
    expect(preview).toHaveLength(PREVIEW_MAX);
    expect(preview?.endsWith("…")).toBe(true);
  });
});

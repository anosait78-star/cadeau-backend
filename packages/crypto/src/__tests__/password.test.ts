import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../password";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("is salted: the same password hashes differently each time", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("stores its parameters in a self-describing format", async () => {
    const hash = await hashPassword("x");
    expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(hash.split("$")).toHaveLength(6);
  });

  it("returns false (never throws) for malformed stored hashes", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "scrypt$16384$8$1$only-five-parts")).toBe(false);
    expect(await verifyPassword("x", "scrypt$notanumber$8$1$c2FsdA$aGFzaA")).toBe(false);
    expect(await verifyPassword("x", "scrypt$16384$8$1$$")).toBe(false);
  });
});

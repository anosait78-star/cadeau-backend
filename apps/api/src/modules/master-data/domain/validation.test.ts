import { describe, expect, it } from "vitest";
import { findResource } from "./resource-registry";
import type { ResourceDescriptor } from "./resource.types";
import { validateCreate, validateUpdate } from "./validation";

function resource(name: string): ResourceDescriptor {
  const descriptor = findResource(name);
  if (descriptor === undefined) throw new Error(`missing test resource ${name}`);
  return descriptor;
}

describe("validateCreate", () => {
  it("accepts a valid tenant row and trims strings", () => {
    const { data, errors } = validateCreate(resource("order-labels"), {
      name: "  VIP  ",
      color: "#E11931",
    });
    expect(errors).toEqual([]);
    expect(data).toEqual({ name: "VIP", color: "#E11931" });
  });

  it("requires required fields", () => {
    const { errors } = validateCreate(resource("order-labels"), {});
    expect(errors).toContainEqual({ field: "name", messages: ["name is required"] });
  });

  it("rejects unknown properties", () => {
    const { errors } = validateCreate(resource("order-labels"), { name: "x", bogus: 1 });
    expect(errors).toContainEqual({ field: "bogus", messages: ["unexpected property bogus"] });
  });

  it("enforces enum values", () => {
    const ok = validateCreate(resource("order-reasons"), { name: "Damaged", kind: "return" });
    expect(ok.errors).toEqual([]);
    const bad = validateCreate(resource("order-reasons"), { name: "Damaged", kind: "nope" });
    expect(bad.errors[0]?.field).toBe("kind");
  });

  it("validates hex colors", () => {
    const { errors } = validateCreate(resource("order-labels"), { name: "x", color: "red" });
    expect(errors).toContainEqual({
      field: "color",
      messages: ["color must be a hex color (e.g. #E11931)"],
    });
  });

  it("validates a uuid reference field", () => {
    const { errors } = validateCreate(resource("product-categories"), {
      name: "Shoes",
      parentId: "not-a-uuid",
    });
    expect(errors).toContainEqual({
      field: "parentId",
      messages: ["parentId must be a valid uuid"],
    });
  });

  it("accepts an explicit null for a nullable field", () => {
    const { data, errors } = validateCreate(resource("product-categories"), {
      name: "Shoes",
      parentId: null,
    });
    expect(errors).toEqual([]);
    expect(data["parentId"]).toBeNull();
  });

  it("enforces maxLength", () => {
    const { errors } = validateCreate(resource("order-labels"), { name: "x".repeat(65) });
    expect(errors[0]?.field).toBe("name");
  });

  it("enforces integer type and range", () => {
    const notInt = validateCreate(resource("currencies"), {
      code: "EGP",
      name: "x",
      symbol: "y",
      decimalDigits: 2.5,
    });
    expect(notInt.errors).toContainEqual({
      field: "decimalDigits",
      messages: ["decimalDigits must be an integer"],
    });
    const tooBig = validateCreate(resource("currencies"), {
      code: "EGP",
      name: "x",
      symbol: "y",
      decimalDigits: 9,
    });
    expect(tooBig.errors).toContainEqual({
      field: "decimalDigits",
      messages: ["decimalDigits must be at most 6"],
    });
  });

  it("rejects null for a required, non-nullable field", () => {
    const { errors } = validateCreate(resource("order-labels"), { name: null });
    expect(errors).toContainEqual({ field: "name", messages: ["name must not be null"] });
  });

  it("rejects a non-string where a string is expected", () => {
    const { errors } = validateCreate(resource("order-labels"), { name: 42 });
    expect(errors).toContainEqual({ field: "name", messages: ["name must be a string"] });
  });

  it("rejects a non-object body", () => {
    const { errors } = validateCreate(resource("order-labels"), "nope");
    expect(errors).toEqual([{ field: "body", messages: ["body must be an object"] }]);
  });

  it("validates a client-provided code id (currencies)", () => {
    const ok = validateCreate(resource("currencies"), {
      code: "EGP",
      name: "Egyptian Pound",
      symbol: "E£",
      decimalDigits: 2,
    });
    expect(ok.errors).toEqual([]);
    expect(ok.data["code"]).toBe("EGP");
    const bad = validateCreate(resource("currencies"), {
      code: "EGPP",
      name: "x",
      symbol: "y",
    });
    expect(bad.errors.some((e) => e.field === "code")).toBe(true);
  });
});

describe("validateUpdate", () => {
  it("accepts a partial update", () => {
    const { data, errors } = validateUpdate(resource("order-labels"), { color: "#000000" });
    expect(errors).toEqual([]);
    expect(data).toEqual({ color: "#000000" });
  });

  it("maps `active` to isActive", () => {
    const { data, errors } = validateUpdate(resource("order-labels"), { active: false });
    expect(errors).toEqual([]);
    expect(data).toEqual({ isActive: false });
  });

  it("requires at least one field", () => {
    const { errors } = validateUpdate(resource("order-labels"), {});
    expect(errors).toContainEqual({
      field: "body",
      messages: ["provide at least one field to update"],
    });
  });

  it("rejects unknown properties", () => {
    const { errors } = validateUpdate(resource("order-labels"), { bogus: 1 });
    expect(errors).toContainEqual({ field: "bogus", messages: ["unexpected property bogus"] });
  });

  it("rejects a non-boolean active", () => {
    const { errors } = validateUpdate(resource("order-labels"), { active: "yes" });
    expect(errors).toContainEqual({ field: "active", messages: ["active must be a boolean"] });
  });

  it("rejects a non-object body", () => {
    const { errors } = validateUpdate(resource("order-labels"), 5);
    expect(errors).toEqual([{ field: "body", messages: ["body must be an object"] }]);
  });

  it("updates active together with a field", () => {
    const { data, errors } = validateUpdate(resource("order-labels"), { name: "x", active: true });
    expect(errors).toEqual([]);
    expect(data).toEqual({ name: "x", isActive: true });
  });
});

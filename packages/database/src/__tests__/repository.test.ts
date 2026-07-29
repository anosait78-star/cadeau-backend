import { describe, expect, it } from "vitest";
import { InvalidCompanyIdError } from "../errors";
import { scopedWhere, stampForCreate, stampForUpdate } from "../repository";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";

describe("scopedWhere", () => {
  it("injects the tenant filter, preserving other conditions", () => {
    expect(scopedWhere(COMPANY, { status: "active" })).toEqual({
      status: "active",
      companyId: COMPANY,
    });
  });

  it("works with no base filter", () => {
    expect(scopedWhere(COMPANY)).toEqual({ companyId: COMPANY });
  });

  it("rejects a non-UUID tenant", () => {
    expect(() => scopedWhere("not-a-uuid")).toThrow(InvalidCompanyIdError);
  });
});

describe("stampForCreate", () => {
  it("stamps tenant + created/updated actor", () => {
    expect(stampForCreate({ companyId: COMPANY, actorId: ACTOR }, { name: "x" })).toEqual({
      name: "x",
      companyId: COMPANY,
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
  });

  it("allows a null actor (system action, pre-Auth)", () => {
    const stamped = stampForCreate({ companyId: COMPANY, actorId: null }, {});
    expect(stamped).toEqual({ companyId: COMPANY, createdBy: null, updatedBy: null });
  });

  it("rejects a non-UUID tenant", () => {
    expect(() => stampForCreate({ companyId: "nope", actorId: null }, {})).toThrow(
      InvalidCompanyIdError,
    );
  });
});

describe("stampForUpdate", () => {
  it("stamps only the updating actor (updated_at is DB-managed)", () => {
    expect(stampForUpdate({ companyId: COMPANY, actorId: ACTOR }, { name: "y" })).toEqual({
      name: "y",
      updatedBy: ACTOR,
    });
  });
});

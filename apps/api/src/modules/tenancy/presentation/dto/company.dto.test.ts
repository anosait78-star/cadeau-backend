import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateCompanyDto } from "./company.dto";

const VALID = {
  name: "Acme Gifts",
  phone: "+201234567890",
  monthlyOrdersRange: "100_500",
};

async function fieldErrors(overrides: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateCompanyDto, { ...VALID, ...overrides });
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe("CreateCompanyDto validation", () => {
  it("accepts a valid payload with only the required fields", async () => {
    expect(await fieldErrors({})).toEqual([]);
  });

  it("accepts the full onboarding payload including optional fields", async () => {
    expect(
      await fieldErrors({
        country: "Egypt",
        facebookHandle: "facebook.com/acme",
        instagramHandle: "@acme",
        websiteUrl: "https://acme.test",
        shippingCarrier: "Aramex",
      }),
    ).toEqual([]);
  });

  it("rejects a missing phone", async () => {
    expect(await fieldErrors({ phone: undefined })).toContain("phone");
  });

  it("rejects a missing monthlyOrdersRange", async () => {
    expect(await fieldErrors({ monthlyOrdersRange: undefined })).toContain("monthlyOrdersRange");
  });

  it("rejects a monthlyOrdersRange outside the allowed set", async () => {
    expect(await fieldErrors({ monthlyOrdersRange: "not_a_bucket" })).toContain(
      "monthlyOrdersRange",
    );
  });
});

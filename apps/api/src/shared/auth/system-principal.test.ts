import { describe, expect, it } from "vitest";
import type { RequestPrincipal } from "./authenticated-request";
import { STOREFRONT_SYNC_SESSION, eventActorId, isSystemPrincipal } from "./system-principal";

const person: RequestPrincipal = { userId: "u1", sessionId: "session-1", companyId: "c1" };
const sync: RequestPrincipal = { ...person, sessionId: STOREFRONT_SYNC_SESSION };

describe("system principal", () => {
  it("recognises the storefront sync, and nothing else, as the system acting", () => {
    expect(isSystemPrincipal(sync)).toBe(true);
    expect(isSystemPrincipal(person)).toBe(false);
  });

  it("gives an event no actor for a system action, and the user for a person's", () => {
    expect(eventActorId(sync)).toBeNull();
    expect(eventActorId(person)).toBe("u1");
  });
});

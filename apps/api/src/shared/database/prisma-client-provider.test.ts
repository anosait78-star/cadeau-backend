import { describe, expect, it, vi } from "vitest";

vi.mock("@cadeau/database", () => ({ getPrismaClient: vi.fn(() => "the-prisma-client") }));

describe("createPrismaClientProvider", () => {
  it("returns a unique symbol token and a matching useFactory provider", async () => {
    const { createPrismaClientProvider } = await import("./prisma-client-provider");
    const { token, provider } = createPrismaClientProvider("ORDERS_PRISMA_CLIENT");

    expect(typeof token).toBe("symbol");
    expect(token.description).toBe("ORDERS_PRISMA_CLIENT");
    expect(provider).toMatchObject({ provide: token });
    expect(typeof (provider as { useFactory: unknown }).useFactory).toBe("function");
    expect((provider as { useFactory: () => unknown }).useFactory()).toBe("the-prisma-client");
  });

  it("returns distinct tokens across calls, even with the same name", async () => {
    const { createPrismaClientProvider } = await import("./prisma-client-provider");
    const a = createPrismaClientProvider("SAME_NAME");
    const b = createPrismaClientProvider("SAME_NAME");
    expect(a.token).not.toBe(b.token);
  });
});

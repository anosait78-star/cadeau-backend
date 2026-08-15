import { randomUUID } from "node:crypto";
import { type INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getPrismaClient, setTenantContext } from "@cadeau/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../app.module";
import { validationExceptionFactory } from "../../../shared/errors/validation";
import { RequestContextMiddleware } from "../../../shared/http/request-context.middleware";
import { AppLogger } from "../../../shared/logging/app-logger";

/**
 * Vendor Accounts — Phase 7: Backward Compatibility & Regression, against the
 * REAL app + REAL Postgres (no fakes/mocks). Closes the two items of the
 * original 18-item scenario list not explicitly exercised by the Phases 1–6
 * e2e test (vendor-order-workflow.e2e.test.ts):
 *
 *  17. A multi-vendor order reserves stock from **each item's own**
 *      `order_items.warehouse_id`, never from the order's single
 *      `warehouseId` fallback.
 *  18. A normal, non-multi-vendor order (no item ever carries a
 *      `warehouseId`) behaves exactly as it did before Vendor Accounts
 *      shipped: full lifecycle, stock reserved/shipped at the order's own
 *      warehouse, zero `OrderVendorGroup` rows ever materialize, and its
 *      activity log carries no `vendor_status_changed` entries.
 */
describe("Vendor Accounts — Backward Compatibility & Regression (e2e, Phase 7)", () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      }),
    );
    const requestContext = new RequestContextMiddleware(app.get(AppLogger));
    app.use(requestContext.use.bind(requestContext));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function bootstrapCompany(run: string): Promise<{ ownerToken: string; companyId: string }> {
    const ownerEmail = `bc-owner-${run}@test.dev`;
    const ownerRegister = await request(server())
      .post("/v1/auth/register")
      .send({ email: ownerEmail, password: "correct horse battery", fullName: "Owner" });
    expect(ownerRegister.status).toBe(201);

    const company = await request(server())
      .post("/v1/companies")
      .set("Authorization", `Bearer ${ownerRegister.body.accessToken}`)
      .send({
        name: `Backward Compat E2E ${run}`,
        slug: `backward-compat-e2e-${run}`,
        phone: "+201234567891",
        monthlyOrdersRange: "100_500",
      });
    expect(company.status).toBe(201);
    return {
      ownerToken: company.body.tokens.accessToken as string,
      companyId: company.body.company.id as string,
    };
  }

  it("a normal order (no vendor routing) behaves exactly as before Vendor Accounts shipped (item 18)", async () => {
    const run = randomUUID().slice(0, 8);
    const { ownerToken } = await bootstrapCompany(run);
    const auth = (token: string) => `Bearer ${token}`;

    const warehouse = await request(server())
      .post("/v1/warehouses")
      .set("Authorization", auth(ownerToken))
      .send({ name: "Main" });
    expect(warehouse.status).toBe(201);
    const warehouseId = warehouse.body.id as string;

    const customer = await request(server())
      .post("/v1/customers")
      .set("Authorization", auth(ownerToken))
      .send({ name: "Sara Ali", phone: "+201001234568" });
    expect(customer.status).toBe(201);

    const product = await request(server())
      .post("/v1/products")
      .set("Authorization", auth(ownerToken))
      .send({ name: `Regular Product ${run}` });
    expect(product.status).toBe(201);
    const variant = await request(server())
      .post(`/v1/products/${product.body.id}/variants`)
      .set("Authorization", auth(ownerToken))
      .send({ name: "Default" });
    expect(variant.status).toBe(201);
    const variantId = variant.body.id as string;

    // Seed real on-hand stock so the reserve/ship effects are observable
    // (not just "didn't throw" thanks to allowOversell defaulting true).
    const seeded = await request(server())
      .post("/v1/inventory/adjustments")
      .set("Authorization", auth(ownerToken))
      .send({ warehouseId, variantId, quantityDelta: 10, reason: "count" });
    expect(seeded.status).toBe(201);

    async function stockAt(): Promise<{ onHand: number; committed: number }> {
      const res = await request(server())
        .get("/v1/inventory/stock")
        .query({ warehouseId, variantId })
        .set("Authorization", auth(ownerToken));
      expect(res.status).toBe(200);
      const row = (res.body.data as { onHand: number; committed: number }[])[0]!;
      return { onHand: row.onHand, committed: row.committed };
    }

    // ---- A single-warehouse order, exactly the pre-Vendor-Accounts shape --
    const orderRes = await request(server())
      .post("/v1/orders")
      .set("Authorization", auth(ownerToken))
      .send({
        customerId: customer.body.id,
        warehouseId,
        items: [{ variantId, quantity: 2, price: 1000 }],
      });
    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.id as string;
    // No item ever carries its own warehouseId on this order — the
    // create-order API doesn't expose that field, matching every order ever
    // created before storefront multi-vendor routing existed.
    expect(orderRes.body.items[0].warehouseId ?? null).toBeNull();

    // ---- Full lifecycle, unaffected by any Vendor Accounts code -----------
    async function transition(toStatus: string): Promise<void> {
      const res = await request(server())
        .post(`/v1/orders/${orderId}/status`)
        .set("Authorization", auth(ownerToken))
        .send({ toStatus });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(toStatus);
    }
    await transition("processing"); // reserves stock at the order's warehouse
    expect(await stockAt()).toEqual({ onHand: 10, committed: 2 });

    await transition("ready");
    await transition("shipped"); // decrements on-hand, releases the reservation
    expect(await stockAt()).toEqual({ onHand: 8, committed: 0 });

    await transition("delivered");
    await transition("completed");

    // ---- Vendor Accounts adds nothing to a non-multi-vendor order --------
    const groups = await request(server())
      .get(`/v1/orders/${orderId}/vendor-groups`)
      .set("Authorization", auth(ownerToken));
    expect(groups.status).toBe(200);
    expect(groups.body.data).toEqual([]);

    const activity = await request(server())
      .get(`/v1/orders/${orderId}/activity`)
      .set("Authorization", auth(ownerToken));
    expect(activity.status).toBe(200);
    const kinds = (activity.body.data as { kind: string }[]).map((a) => a.kind);
    expect(kinds).not.toContain("vendor_status_changed");
    expect(kinds).toContain("status_changed"); // the ordinary trail is untouched
  });

  it("a multi-vendor order reserves stock per item at its OWN warehouse, not the order's fallback (item 17)", async () => {
    const run = randomUUID().slice(0, 8);
    const { ownerToken, companyId } = await bootstrapCompany(run);
    const auth = (token: string) => `Bearer ${token}`;

    async function createWarehouse(name: string): Promise<string> {
      const res = await request(server())
        .post("/v1/warehouses")
        .set("Authorization", auth(ownerToken))
        .send({ name });
      expect(res.status).toBe(201);
      return res.body.id as string;
    }
    const wFallback = await createWarehouse("Fallback (order-level, unused per item)");
    const w1 = await createWarehouse("Store A");
    const w2 = await createWarehouse("Store B");

    const customer = await request(server())
      .post("/v1/customers")
      .set("Authorization", auth(ownerToken))
      .send({ name: "Sara Ali", phone: "+201001234569" });
    expect(customer.status).toBe(201);

    async function createVariant(name: string): Promise<string> {
      const product = await request(server())
        .post("/v1/products")
        .set("Authorization", auth(ownerToken))
        .send({ name });
      expect(product.status).toBe(201);
      const variant = await request(server())
        .post(`/v1/products/${product.body.id}/variants`)
        .set("Authorization", auth(ownerToken))
        .send({ name: "Default" });
      expect(variant.status).toBe(201);
      return variant.body.id as string;
    }
    const variantA = await createVariant(`Product for Store A ${run}`);
    const variantB = await createVariant(`Product for Store B ${run}`);

    async function seed(warehouseId: string, variantId: string, qty: number): Promise<void> {
      const res = await request(server())
        .post("/v1/inventory/adjustments")
        .set("Authorization", auth(ownerToken))
        .send({ warehouseId, variantId, quantityDelta: qty, reason: "count" });
      expect(res.status).toBe(201);
    }
    // Stock only exists where each item is actually routed — never at the
    // order's fallback warehouse — so a wrong resolution would surface as a
    // shortage/0-committed mismatch, not silently pass.
    await seed(w1, variantA, 5);
    await seed(w2, variantB, 5);

    const orderRes = await request(server())
      .post("/v1/orders")
      .set("Authorization", auth(ownerToken))
      .send({
        customerId: customer.body.id,
        warehouseId: wFallback, // deliberately never where either item is routed
        items: [
          { variantId: variantA, quantity: 2, price: 1000 },
          { variantId: variantB, quantity: 3, price: 2000 },
        ],
      });
    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.id as string;
    const itemIdByVariant = new Map<string, string>(
      (orderRes.body.items as { id: string; variantId: string }[]).map((i) => [i.variantId, i.id]),
    );
    const itemAId = itemIdByVariant.get(variantA) as string;
    const itemBId = itemIdByVariant.get(variantB) as string;

    // Route each line to its own warehouse, exactly as storefront ingestion
    // does in production (storefront_vendor_warehouse_routing migration) —
    // via a direct tenant-bound write, since the public create-order API does
    // not accept a per-item warehouseId on purpose.
    await getPrismaClient().$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      await Promise.all([
        tx.orderItem.updateMany({
          where: { id: itemAId, companyId },
          data: { warehouseId: w1 },
        }),
        tx.orderItem.updateMany({
          where: { id: itemBId, companyId },
          data: { warehouseId: w2 },
        }),
      ]);
    });

    const processing = await request(server())
      .post(`/v1/orders/${orderId}/status`)
      .set("Authorization", auth(ownerToken))
      .send({ toStatus: "processing" });
    expect(processing.status).toBe(200);

    async function committedAt(warehouseId: string, variantId: string): Promise<number> {
      const res = await request(server())
        .get("/v1/inventory/stock")
        .query({ warehouseId, variantId })
        .set("Authorization", auth(ownerToken));
      expect(res.status).toBe(200);
      const rows = res.body.data as { committed: number }[];
      return rows[0]?.committed ?? 0; // no row at all reads the same as zero
    }

    // Each item reserved at its OWN warehouse...
    expect(await committedAt(w1, variantA)).toBe(2);
    expect(await committedAt(w2, variantB)).toBe(3);
    // ...and NOTHING landed at the order's fallback warehouse for either
    // variant — proving the per-item warehouseId won, not Order.warehouseId.
    expect(await committedAt(wFallback, variantA)).toBe(0);
    expect(await committedAt(wFallback, variantB)).toBe(0);
  });
});

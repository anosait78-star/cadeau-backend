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
 * Full local end-to-end verification of the Vendor Order workflow (Phases
 * 1–5), against the REAL app + REAL Postgres (no fakes/mocks anywhere) — run
 * with `docker compose up -d db` and the test DB migrated/seeded first (see
 * README / CLAUDE.md). Walks the exact scenario requested for review:
 *
 *  1. A company with 3 warehouses.
 *  2. 2 vendor accounts, each joined to one warehouse via its join code.
 *  3. A multi-vendor order (3 items, one per warehouse — the 3rd warehouse
 *     deliberately has no vendor yet, to prove that's a valid state).
 *  4. The company transitions it to "processing" → vendor groups activate.
 *  5. Each vendor with a group gets exactly one `order_vendor_group.assigned`
 *     notification, carrying only their own ids (Phase 5) — the 3rd
 *     warehouse's absent vendor and the owner get none.
 *  6. Vendor A sees only their own item, not Vendor B's or the 3rd group's.
 *  7. Vendor A advances new → processing → ready → delivered.
 *  8. The company's tracking view reflects each vendor's real status.
 *  9. Vendor B (or an unrelated caller) cannot touch Vendor A's group id.
 *
 * `order_items.warehouse_id` is set directly via a tenant-bound Prisma write
 * (mirroring what the storefront-integration ingestion path already does in
 * production — see storefront_vendor_warehouse_routing migration) rather than
 * through the public `POST /v1/orders` API, which does not accept a per-item
 * warehouseId (that field is populated by storefront ingestion only, by
 * design — this test does not add it, and touches no WooCommerce/WCFM code).
 */
describe("Vendor Order workflow (e2e) — Phases 1–6", () => {
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

  it("runs the full multi-vendor order flow end to end", async () => {
    const run = randomUUID().slice(0, 8);

    // ---- 1. Owner registers + creates a company with 3 warehouses --------
    const ownerEmail = `owner-${run}@test.dev`;
    const ownerRegister = await request(server())
      .post("/v1/auth/register")
      .send({ email: ownerEmail, password: "correct horse battery", fullName: "Owner" });
    expect(ownerRegister.status).toBe(201);
    let ownerToken = ownerRegister.body.accessToken as string;

    const company = await request(server())
      .post("/v1/companies")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: `Vendor E2E ${run}`,
        slug: `vendor-e2e-${run}`,
        phone: "+201234567890",
        monthlyOrdersRange: "100_500",
      });
    expect(company.status).toBe(201);
    const companyId = company.body.company.id as string;
    ownerToken = company.body.tokens.accessToken as string;

    const auth = (token: string) => `Bearer ${token}`;

    async function createWarehouse(name: string): Promise<string> {
      const res = await request(server())
        .post("/v1/warehouses")
        .set("Authorization", auth(ownerToken))
        .send({ name });
      expect(res.status).toBe(201);
      return res.body.id as string;
    }
    const w1 = await createWarehouse("Store A");
    const w2 = await createWarehouse("Store B");
    const w3 = await createWarehouse("Store C (no vendor yet)");

    // ---- 2. Two vendor accounts, each joined to one warehouse ------------
    async function rotateJoinCode(warehouseId: string): Promise<string> {
      const res = await request(server())
        .post(`/v1/warehouses/${warehouseId}/join-code/rotate`)
        .set("Authorization", auth(ownerToken));
      expect(res.status).toBe(201); // POST issuing a fresh code — Created
      return res.body.code as string;
    }
    const w1Code = await rotateJoinCode(w1);
    const w2Code = await rotateJoinCode(w2);

    async function registerVendor(email: string, code: string): Promise<string> {
      const registered = await request(server())
        .post("/v1/auth/register")
        .send({ email, password: "correct horse battery", fullName: email });
      expect(registered.status).toBe(201);
      const joined = await request(server())
        .post("/v1/warehouse-join-codes/accept")
        .set("Authorization", auth(registered.body.accessToken))
        .send({ code });
      expect(joined.status).toBe(200);
      expect(joined.body.role).toBe("vendor");
      const switched = await request(server())
        .post(`/v1/companies/${joined.body.companyId}/switch`)
        .set("Authorization", auth(registered.body.accessToken));
      expect(switched.status).toBe(200);
      return switched.body.accessToken as string;
    }
    const vendorAToken = await registerVendor(`vendor-a-${run}@test.dev`, w1Code);
    const vendorBToken = await registerVendor(`vendor-b-${run}@test.dev`, w2Code);

    // ---- Fixtures: a customer + 3 sellable variants -----------------------
    const customer = await request(server())
      .post("/v1/customers")
      .set("Authorization", auth(ownerToken))
      .send({ name: "Sara Ali", phone: "+201001234567" });
    expect(customer.status).toBe(201);

    async function createVariant(productName: string): Promise<string> {
      const product = await request(server())
        .post("/v1/products")
        .set("Authorization", auth(ownerToken))
        .send({ name: productName });
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
    const variantC = await createVariant(`Product for Store C ${run}`);

    // ---- 3. A multi-vendor order (3 items, one per warehouse) ------------
    const orderRes = await request(server())
      .post("/v1/orders")
      .set("Authorization", auth(ownerToken))
      .send({
        customerId: customer.body.id,
        warehouseId: w1, // unused fallback: every item below carries its own
        items: [
          { variantId: variantA, quantity: 1, price: 1000 },
          { variantId: variantB, quantity: 1, price: 2000 },
          { variantId: variantC, quantity: 1, price: 3000 },
        ],
      });
    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.id as string;
    const itemIdByVariant = new Map<string, string>(
      (orderRes.body.items as { id: string; variantId: string }[]).map((i) => [i.variantId, i.id]),
    );

    // Route each line to its warehouse — exactly what storefront ingestion
    // already does for a real WCFM order (storefront_vendor_warehouse_routing
    // migration); done here via a direct tenant-bound write instead of
    // through the public create-order API, which does not expose a per-item
    // warehouseId on purpose.
    const routing: [string, string][] = [
      [itemIdByVariant.get(variantA) as string, w1],
      [itemIdByVariant.get(variantB) as string, w2],
      [itemIdByVariant.get(variantC) as string, w3],
    ];
    await getPrismaClient().$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      await Promise.all(
        routing.map(([itemId, warehouseId]) =>
          tx.orderItem.updateMany({ where: { id: itemId, companyId }, data: { warehouseId } }),
        ),
      );
    });

    // ---- 4. Company transitions the order to "processing" ----------------
    const processing = await request(server())
      .post(`/v1/orders/${orderId}/status`)
      .set("Authorization", auth(ownerToken))
      .send({ toStatus: "processing" });
    expect(processing.status).toBe(200);
    expect(processing.body.status).toBe("processing"); // Parent Order status, unaffected by vendor groups

    // ---- 6. Vendor groups exist, one per warehouse, all still "new" ------
    const groupsAfterProcessing = await request(server())
      .get(`/v1/orders/${orderId}/vendor-groups`)
      .set("Authorization", auth(ownerToken));
    expect(groupsAfterProcessing.status).toBe(200);
    const groups = groupsAfterProcessing.body.data as {
      id: string;
      warehouseId: string;
      vendorName: string | null;
      status: string;
      items: { variantId: string }[];
    }[];
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.status === "new")).toBe(true); // company's button did NOT touch vendor status
    const groupW1 = groups.find((g) => g.warehouseId === w1)!;
    const groupW2 = groups.find((g) => g.warehouseId === w2)!;
    const groupW3 = groups.find((g) => g.warehouseId === w3)!;
    expect(groupW1.vendorName).toContain(`vendor-a-${run}`);
    expect(groupW2.vendorName).toContain(`vendor-b-${run}`);
    expect(groupW3.vendorName).toBeNull(); // no vendor has joined W3 — valid state, not an error
    expect(groupW1.items.map((i) => i.variantId)).toEqual([variantA]);

    // ---- 6b. Each vendor got exactly one notification, own ids only (Phase 5) ----
    async function myAssignedNotifications(
      token: string,
    ): Promise<{ type: string; body: string; payload: { orderVendorGroupId: string } }[]> {
      const res = await request(server())
        .get("/v1/notifications")
        .set("Authorization", auth(token));
      expect(res.status).toBe(200);
      return (res.body.data as { type: string; body: string; payload: unknown }[])
        .filter((n) => n.type === "order_vendor_group.assigned")
        .map((n) => n as { type: string; body: string; payload: { orderVendorGroupId: string } });
    }
    const vendorANotifications = await myAssignedNotifications(vendorAToken);
    expect(vendorANotifications).toHaveLength(1);
    expect(vendorANotifications[0]?.payload.orderVendorGroupId).toBe(groupW1.id);
    expect(vendorANotifications[0]?.body).not.toContain(variantB);
    expect(vendorANotifications[0]?.body).not.toContain(variantC);

    const vendorBNotifications = await myAssignedNotifications(vendorBToken);
    expect(vendorBNotifications).toHaveLength(1);
    expect(vendorBNotifications[0]?.payload.orderVendorGroupId).toBe(groupW2.id);

    // The owner (not a vendor) never receives this notification type.
    const ownerNotifications = await myAssignedNotifications(ownerToken);
    expect(ownerNotifications).toHaveLength(0);

    // ---- 7. Vendor A sees only their own item, not Vendor B's or W3's ----
    const vendorAList = await request(server())
      .get("/v1/vendor/order-groups")
      .set("Authorization", auth(vendorAToken));
    expect(vendorAList.status).toBe(200);
    expect(vendorAList.body.data).toHaveLength(1);
    const vendorAGroup = vendorAList.body.data[0] as { id: string; items: { variantId: string }[] };
    expect(vendorAGroup.id).toBe(groupW1.id);
    expect(vendorAGroup.items.map((i) => i.variantId)).toEqual([variantA]);
    expect(JSON.stringify(vendorAList.body)).not.toContain(variantB);
    expect(JSON.stringify(vendorAList.body)).not.toContain(variantC);

    const vendorBList = await request(server())
      .get("/v1/vendor/order-groups")
      .set("Authorization", auth(vendorBToken));
    expect(vendorBList.body.data).toHaveLength(1);
    expect(vendorBList.body.data[0].id).toBe(groupW2.id);

    // ---- 8. Vendor A advances new → processing → ready → delivered -------
    async function advance(
      token: string,
      groupId: string,
      toStatus: string,
    ): Promise<request.Response> {
      return request(server())
        .post(`/v1/vendor/order-groups/${groupId}/status`)
        .set("Authorization", auth(token))
        .send({ toStatus });
    }

    // Illegal skip is rejected before any legal move happens.
    const skip = await advance(vendorAToken, vendorAGroup.id, "ready");
    expect(skip.status).toBe(422);

    const toProcessing = await advance(vendorAToken, vendorAGroup.id, "processing");
    expect(toProcessing.status).toBe(200);
    expect(toProcessing.body.status).toBe("processing");

    const toReady = await advance(vendorAToken, vendorAGroup.id, "ready");
    expect(toReady.status).toBe(200);
    expect(toReady.body.status).toBe("ready");

    const toDelivered = await advance(vendorAToken, vendorAGroup.id, "delivered");
    expect(toDelivered.status).toBe(200);
    expect(toDelivered.body.status).toBe("delivered");

    // Terminal: no further move is legal.
    const pastTerminal = await advance(vendorAToken, vendorAGroup.id, "ready");
    expect(pastTerminal.status).toBe(422);

    // ---- 9. Company tracking reflects each vendor's real status ----------
    const finalGroups = await request(server())
      .get(`/v1/orders/${orderId}/vendor-groups`)
      .set("Authorization", auth(ownerToken));
    const finalByWarehouse = new Map(
      (finalGroups.body.data as { warehouseId: string; status: string }[]).map((g) => [
        g.warehouseId,
        g.status,
      ]),
    );
    expect(finalByWarehouse.get(w1)).toBe("delivered"); // Vendor A finished
    expect(finalByWarehouse.get(w2)).toBe("new"); // Vendor B never touched it
    expect(finalByWarehouse.get(w3)).toBe("new"); // no vendor at all yet
    // "Last updated" is exposed per group (Phase 6) — reuses updatedAt, no new column.
    const finalGroupW1 = (
      finalGroups.body.data as { warehouseId: string; updatedAt: string }[]
    ).find((g) => g.warehouseId === w1);
    expect(Number.isNaN(new Date(finalGroupW1?.updatedAt ?? "").getTime())).toBe(false);

    // ---- 9b. Audit trail review (Phase 6): the company can see the vendor's
    // full history via the SAME activity log/endpoint it already had ------
    const activity = await request(server())
      .get(`/v1/orders/${orderId}/activity`)
      .set("Authorization", auth(ownerToken));
    expect(activity.status).toBe(200);
    const vendorActivity = (
      activity.body.data as { kind: string; fromValue: string; toValue: string; note: string }[]
    ).filter((a) => a.kind === "vendor_status_changed");
    expect(vendorActivity.map((a) => `${a.fromValue}->${a.toValue}`)).toEqual([
      "ready->delivered",
      "processing->ready",
      "new->processing",
    ]); // newest first, one row per Vendor A transition
    expect(vendorActivity.every((a) => a.note === "Store A")).toBe(true);

    // ---- 10. Tampering with another vendor's groupId is rejected ---------
    const crossVendor = await advance(vendorBToken, vendorAGroup.id, "processing");
    expect(crossVendor.status).toBe(404); // never leaks that the group exists

    const crossVendorOtherWay = await advance(vendorAToken, groupW2.id, "processing");
    expect(crossVendorOtherWay.status).toBe(404);

    // A caller with no vendor membership at all (the owner) gets an empty
    // list from the vendor surface, not an error and not everyone's data.
    const ownerAsVendor = await request(server())
      .get("/v1/vendor/order-groups")
      .set("Authorization", auth(ownerToken));
    expect(ownerAsVendor.status).toBe(200);
    expect(ownerAsVendor.body.data).toEqual([]);
  });
});

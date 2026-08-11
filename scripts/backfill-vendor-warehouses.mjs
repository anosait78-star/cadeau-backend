#!/usr/bin/env node
/**
 * One-time backfill (2026-08-11): register a product's known vendor
 * warehouse for every already-`processed` storefront product event, without
 * re-triggering any WooCommerce webhook.
 *
 * Why this exists: the storefront-ingestion idempotency key is
 * (connectionId, eventType, externalId) — a re-delivery for a product
 * that's already `processed` is a permanent no-op (D7), by design, to avoid
 * double-processing genuine webhook retries. That also means resaving a
 * product in WooCommerce can never apply new ingestion logic (like
 * `registerKnownVendorWarehouse` in storefront-ingestion.service.ts) to
 * products that were already synced before that logic existed — the event
 * never reaches `processProduct` again. This script reads each event's
 * already-stored payload directly and replays just the warehouse-
 * registration step, matching that method's logic exactly:
 *
 *   for each processed 'product' event (newest first per SKU):
 *     - parse the stored payload → SKU + `_vendor_id` meta
 *     - find the variant by SKU
 *     - if the vendor resolves to a mapped warehouse, and that
 *       (warehouse, variant) pair has no stock row yet: create one with
 *       on_hand = 0 — not a quantity claim, just enough for the product to
 *       report its warehouse (products list "warehouse" column, 2026-08-11).
 *
 * Read-only against WooCommerce; the only writes are new zero-quantity
 * `inventory_stock` rows. Safe to re-run — already-registered pairs are
 * skipped.
 *
 * Usage (on the server, from the cadeau-backend repo root):
 *   node scripts/backfill-vendor-warehouses.mjs <companyId>
 */
import { PrismaClient } from "@cadeau/database";

async function main() {
  const companyId = process.argv[2];
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!companyId || !UUID_RE.test(companyId)) {
    console.error("Usage: node backfill-vendor-warehouses.mjs <companyId>");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT set_config('app.company_id', '${companyId}', true)`);

      const events = await tx.$queryRaw`
        SELECT DISTINCT ON (external_id) external_id, connection_id, payload
        FROM storefront_webhook_events
        WHERE event_type = 'product' AND status = 'processed'
        ORDER BY external_id, received_at DESC
      `;
      console.warn(`Found ${events.length} processed product events (newest per product).`);

      let skippedNoSku = 0;
      let skippedNoVendor = 0;
      let skippedNoMapping = 0;
      let skippedNoVariant = 0;
      let skippedAlready = 0;
      let registered = 0;

      for (const event of events) {
        const payload = event.payload;
        const sku = typeof payload?.sku === "string" ? payload.sku : null;
        if (sku === null || sku.length === 0) {
          skippedNoSku++;
          continue;
        }
        const metaData = Array.isArray(payload?.meta_data) ? payload.meta_data : [];
        const vendorMeta = metaData.find((m) => m && m.key === "_vendor_id");
        const vendorExternalId =
          typeof vendorMeta?.value === "string" && vendorMeta.value.length > 0
            ? vendorMeta.value
            : null;
        if (vendorExternalId === null) {
          skippedNoVendor++;
          continue;
        }

        const mapping = await tx.storefrontConnectionVendorWarehouse.findFirst({
          where: { connectionId: event.connection_id, externalVendorId: vendorExternalId },
          select: { warehouseId: true },
        });
        if (mapping === null) {
          skippedNoMapping++;
          continue;
        }

        const variant = await tx.productVariant.findFirst({
          where: { companyId, sku },
          select: { id: true },
        });
        if (variant === null) {
          skippedNoVariant++;
          continue;
        }

        const existing = await tx.inventoryStock.findFirst({
          where: { warehouseId: mapping.warehouseId, variantId: variant.id },
          select: { id: true },
        });
        if (existing !== null) {
          skippedAlready++;
          continue;
        }

        await tx.inventoryStock.create({
          data: {
            companyId,
            warehouseId: mapping.warehouseId,
            variantId: variant.id,
            onHand: 0,
            committed: 0,
            available: 0,
            reorderPoint: 0,
          },
        });
        registered++;
      }

      console.warn({
        registered,
        skippedAlready,
        skippedNoSku,
        skippedNoVendor,
        skippedNoMapping,
        skippedNoVariant,
      });
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

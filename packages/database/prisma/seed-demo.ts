/**
 * Demo/smoke-test data seeder — NOT part of the system or dev seed registries.
 * Populates ONE realistic demo company (owner/employees/company already created
 * through the real `/v1/auth/register` + `/v1/companies` + invitation-accept
 * flow) with master data, products, inventory, customers, orders, shipments,
 * invoices, expenses and purchase orders, entirely through Prisma writes made
 * inside `withTenantTransaction` so RLS applies exactly as it would for the API.
 *
 * Idempotent: every row is upserted on a natural or deterministic
 * (`idempotencyKey`) unique key, so re-running this script against the same
 * company only ever reports zero-or-more *new* rows, never duplicates.
 *
 * Usage: tsx prisma/seed-demo.ts <companyId>
 */
import { getConfig } from "@cadeau/config";
import { encrypt, blindIndex } from "@cadeau/crypto";
import {
  getPrismaClient,
  disconnectPrisma,
  withTenantTransaction,
  type SqlExecutor,
} from "../src/index";

const COMPANY_ID = process.argv[2];
if (!COMPANY_ID) {
  console.error("Usage: tsx prisma/seed-demo.ts <companyId>");
  process.exit(1);
}

const config = getConfig();
const ENC_KEY = config.encryption.key;
const HASH_KEY = config.encryption.blindIndexKey;

// Deterministic PRNG (mulberry32) so re-runs generate the exact same demo data.
function mulberry32(seed: number) {
  let a = seed;
  return function random(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260101);
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)] as T;
}
function pickN<T>(arr: readonly T[], n: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(rand() * pool.length);
    out.push(pool.splice(idx, 1)[0] as T);
  }
  return out;
}
function intBetween(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(intBetween(8, 21), intBetween(0, 59), 0, 0);
  return d;
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const FIRST_NAMES_M = [
  "أحمد",
  "محمد",
  "محمود",
  "مصطفى",
  "عمر",
  "خالد",
  "كريم",
  "يوسف",
  "إبراهيم",
  "طارق",
  "عادل",
  "حسام",
  "وائل",
  "شريف",
  "أيمن",
  "هشام",
  "عصام",
  "فادي",
  "رامي",
  "سامح",
];
const FIRST_NAMES_F = [
  "منى",
  "سارة",
  "فاطمة",
  "مريم",
  "هبة",
  "نور",
  "ياسمين",
  "دينا",
  "رانيا",
  "إيمان",
  "نهى",
  "سلمى",
  "أميرة",
  "ريهام",
  "هدير",
  "شيماء",
  "غادة",
  "لمياء",
  "نادية",
  "وفاء",
];
const LAST_NAMES = [
  "الجندي",
  "عبد الرحمن",
  "السيد",
  "محمود",
  "إبراهيم",
  "حسن",
  "عبد الله",
  "الشريف",
  "رزق",
  "توفيق",
  "عثمان",
  "فهمي",
  "الليثي",
  "شعبان",
  "عبد العزيز",
  "زكي",
  "النجار",
  "المصري",
  "بدوي",
  "قطب",
];

const STREETS = [
  "شارع التحرير",
  "شارع الهرم",
  "شارع فيصل",
  "شارع النصر",
  "شارع الجمهورية",
  "شارع أحمد عرابي",
  "شارع مكرم عبيد",
  "شارع الثورة",
  "شارع السودان",
  "شارع الطيران",
  "شارع مصطفى النحاس",
  "شارع رمسيس",
];

const PRODUCT_CATALOG: { category: string; name: string; variants: string[] }[] = [
  { category: "هدايا", name: "صندوق هدايا فاخر", variants: ["صغير", "متوسط", "كبير"] },
  { category: "هدايا", name: "سلة هدايا مشكلة", variants: ["كلاسيك", "ديلوكس"] },
  { category: "هدايا", name: "باقة ورد صناعي", variants: ["أحمر", "وردي", "أبيض"] },
  { category: "هدايا", name: "دب تيدي بير", variants: ["30 سم", "50 سم", "80 سم"] },
  { category: "هدايا", name: "بوكيه بالونات", variants: ["ذهبي", "فضي", "ملون"] },
  { category: "هدايا", name: "علبة شوكولاتة فاخرة", variants: ["صغيرة", "كبيرة"] },
  { category: "هدايا", name: "مج مطبوع بتصميم مخصص", variants: ["أبيض", "أسود"] },
  { category: "هدايا", name: "إطار صور خشبي", variants: ["A4", "A3"] },
  { category: "هدايا", name: "شمعة معطرة", variants: ["فانيليا", "لافندر", "ورد"] },
  { category: "هدايا", name: "بطاقة تهنئة مطبوعة", variants: ["مناسبة عامة", "عيد ميلاد", "زفاف"] },
  { category: "إكسسوارات", name: "سوار نسائي", variants: ["ذهبي اللون", "فضي اللون"] },
  { category: "إكسسوارات", name: "عقد نسائي", variants: ["قصير", "طويل"] },
  { category: "إكسسوارات", name: "طقم إكسسوار (عقد + سوار)", variants: ["ذهبي", "فضي"] },
  { category: "إكسسوارات", name: "ساعة يد كلاسيك", variants: ["رجالي", "حريمي"] },
  { category: "إكسسوارات", name: "محفظة جلد", variants: ["بني", "أسود"] },
  { category: "إكسسوارات", name: "حقيبة يد نسائية", variants: ["صغيرة", "متوسطة"] },
  { category: "إكسسوارات", name: "نظارة شمس", variants: ["كلاسيك", "رياضي"] },
  { category: "منتجات منزلية", name: "طقم فناجين قهوة", variants: ["6 قطع", "12 قطعة"] },
  { category: "منتجات منزلية", name: "مفرش طاولة مطرز", variants: ["مستطيل", "مربع"] },
  { category: "منتجات منزلية", name: "شمعدان ديكور", variants: ["فضي", "ذهبي"] },
  { category: "منتجات منزلية", name: "مزهرية سيراميك", variants: ["صغيرة", "كبيرة"] },
  { category: "منتجات منزلية", name: "وسادة ديكور مطرزة", variants: ["45x45", "60x60"] },
  { category: "منتجات منزلية", name: "لوحة حائط فنية", variants: ["صغيرة", "متوسطة", "كبيرة"] },
  { category: "العناية الشخصية", name: "طقم عناية بالبشرة", variants: ["أساسي", "ديلوكس"] },
  { category: "العناية الشخصية", name: "عطر نسائي", variants: ["50 مل", "100 مل"] },
  { category: "العناية الشخصية", name: "عطر رجالي", variants: ["50 مل", "100 مل"] },
  { category: "العناية الشخصية", name: "طقم مناكير وباديكير", variants: ["كلاسيك"] },
  { category: "العناية الشخصية", name: "زيوت عطرية طبيعية", variants: ["لافندر", "نعناع", "ورد"] },
  {
    category: "ألعاب ومناسبات",
    name: "لعبة تعليمية للأطفال",
    variants: ["3-5 سنوات", "6-9 سنوات"],
  },
  { category: "ألعاب ومناسبات", name: "طقم زينة عيد ميلاد", variants: ["أزرق", "وردي", "ذهبي"] },
  { category: "ألعاب ومناسبات", name: "كيك توبر مخصص", variants: ["خشب", "أكريليك"] },
  { category: "ألعاب ومناسبات", name: "علبة تغليف هدايا", variants: ["صغيرة", "متوسطة", "كبيرة"] },
  { category: "ألعاب ومناسبات", name: "شنطة توزيعات مناسبات", variants: ["10 قطع", "20 قطعة"] },
  { category: "ألعاب ومناسبات", name: "بالونات هيليوم رقمية", variants: ["ذهبي", "فضي", "وردي"] },
  { category: "ألعاب ومناسبات", name: "تاج مناسبات", variants: ["ذهبي", "فضي"] },
];

const EXPENSE_CATEGORIES = [
  "إيجار المخزن",
  "رواتب الموظفين",
  "تغليف وتعبئة",
  "تسويق وإعلانات",
  "فواتير كهرباء وإنترنت",
  "مصاريف شحن",
  "صيانة",
];

async function main(): Promise<void> {
  const client = getPrismaClient();

  console.info(`[seed:demo] seeding company ${COMPANY_ID}`);

  // Governorates (system reference data, no tenant scope needed to read).
  const governorates = await client.governorate.findMany({ where: { countryCode: "EG" } });
  if (governorates.length === 0) {
    throw new Error(
      "No EG governorates found — run `pnpm --filter @cadeau/database db:seed` first.",
    );
  }

  // -------------------------------------------------------------------------
  // 1. Master data: units, categories, labels, reasons, shipping zones,
  //    warehouse, tax settings.
  // -------------------------------------------------------------------------
  const { unitId, categoryByName, labelIds, reasonsByKind, warehouseId } =
    await withTenantTransaction(client, COMPANY_ID, async (tx) => {
      const unit = await upsertByName(tx, "unit", {
        companyId: COMPANY_ID,
        name: "قطعة",
        code: "PC",
      });
      await upsertByName(tx, "unit", { companyId: COMPANY_ID, name: "علبة", code: "BOX" });
      await upsertByName(tx, "unit", { companyId: COMPANY_ID, name: "كيلوجرام", code: "KG" });

      const categoryNames = [...new Set(PRODUCT_CATALOG.map((p) => p.category))];
      const categoryByName = new Map<string, string>();
      for (const name of categoryNames) {
        const cat = await upsertByName(tx, "productCategory", { companyId: COMPANY_ID, name });
        categoryByName.set(name, cat.id);
      }

      const labelDefs = [
        { name: "عميل مميز", color: "#D4AF37" },
        { name: "شحن مجاني", color: "#2E86DE" },
        { name: "طلب عاجل", color: "#E74C3C" },
      ];
      const labelIds: string[] = [];
      for (const l of labelDefs) {
        const row = await upsertByName(tx, "orderLabel", { companyId: COMPANY_ID, ...l });
        labelIds.push(row.id);
      }

      const reasonDefs: { name: string; kind: string }[] = [
        { name: "العميل غير متاح", kind: "cancellation" },
        { name: "العميل غيّر رأيه", kind: "cancellation" },
        { name: "السعر غير مناسب", kind: "cancellation" },
        { name: "منتج تالف عند الاستلام", kind: "return" },
        { name: "منتج غير مطابق للوصف", kind: "return" },
        { name: "تأخر في التوصيل", kind: "general" },
      ];
      const reasonsByKind = new Map<string, string[]>();
      for (const r of reasonDefs) {
        const row = await tx.orderReason.upsert({
          where: { companyId_kind_name: { companyId: COMPANY_ID, kind: r.kind, name: r.name } },
          create: { companyId: COMPANY_ID, name: r.name, kind: r.kind },
          update: {},
        });
        const list = reasonsByKind.get(r.kind) ?? [];
        list.push(row.id);
        reasonsByKind.set(r.kind, list);
      }

      const zoneDefs = [
        { name: "القاهرة الكبرى", countryCode: "EG" },
        { name: "الدلتا", countryCode: "EG" },
        { name: "الصعيد", countryCode: "EG" },
        { name: "البحر الأحمر وسيناء", countryCode: "EG" },
      ];
      for (const z of zoneDefs) {
        await upsertByName(tx, "shippingZone", { companyId: COMPANY_ID, ...z });
      }

      const warehouse = await tx.warehouse.upsert({
        where: { companyId_name: { companyId: COMPANY_ID, name: "المخزن الرئيسي - القاهرة" } },
        create: {
          companyId: COMPANY_ID,
          name: "المخزن الرئيسي - القاهرة",
          code: "WH-CAI-01",
          address: "المنطقة الصناعية، مدينة نصر، القاهرة",
          isDefault: true,
        },
        update: {},
      });

      await tx.taxSettings.upsert({
        where: { companyId: COMPANY_ID },
        create: {
          companyId: COMPANY_ID,
          vatRateBps: 1400,
          vatRegistrationNumber: "EG-VAT-100200300",
        },
        update: {},
      });

      return {
        unitId: unit.id,
        categoryByName,
        labelIds,
        reasonsByKind,
        warehouseId: warehouse.id,
      };
    });
  console.info("[seed:demo] master data ready");

  // -------------------------------------------------------------------------
  // 2. Products + variants + inventory stock.
  // -------------------------------------------------------------------------
  type VariantRef = { id: string; price: number; cost: number };
  const variants: VariantRef[] = [];

  await withTenantTransaction(client, COMPANY_ID, async (tx) => {
    for (const [pIdx, p] of PRODUCT_CATALOG.entries()) {
      const categoryId = categoryByName.get(p.category) ?? null;
      const product = await tx.product.upsert({
        where: { companyId_name: { companyId: COMPANY_ID, name: p.name } },
        create: {
          companyId: COMPANY_ID,
          name: p.name,
          description: `${p.name} — منتج ضمن تشكيلة ${p.category} لدى شركة كادو للهدايا.`,
          categoryId,
          unitId,
        },
        update: {},
      });

      const basePrice = intBetween(80, 1200) * 100; // minor units (EGP piasters)
      for (const [vIdx, variantName] of p.variants.entries()) {
        const cost = Math.round(basePrice * (0.45 + rand() * 0.15));
        const variant = await tx.productVariant.upsert({
          where: { productId_name: { productId: product.id, name: variantName } },
          create: {
            companyId: COMPANY_ID,
            productId: product.id,
            name: variantName,
            sku: `SKU-${String(pIdx + 1).padStart(3, "0")}-${vIdx + 1}`,
            barcode: barcodeFor(product.id, variantName),
            averageCost: BigInt(cost),
          },
          update: { averageCost: BigInt(cost) },
        });
        variants.push({ id: variant.id, price: basePrice, cost });
      }
    }
  });
  console.info(
    `[seed:demo] ${PRODUCT_CATALOG.length} products / ${variants.length} variants ready`,
  );

  // Inventory stock — chunked into several transactions to keep each one small.
  for (const chunk of chunks(variants, 15)) {
    await withTenantTransaction(client, COMPANY_ID, async (tx) => {
      for (const v of chunk) {
        const onHand = intBetween(20, 400);
        await tx.inventoryStock.upsert({
          where: { warehouseId_variantId: { warehouseId, variantId: v.id } },
          create: {
            companyId: COMPANY_ID,
            warehouseId,
            variantId: v.id,
            onHand: BigInt(onHand),
            reorderPoint: BigInt(intBetween(5, 20)),
          },
          update: {},
        });
      }
    });
  }
  console.info("[seed:demo] inventory stock ready");

  // -------------------------------------------------------------------------
  // 3. Customers + addresses.
  // -------------------------------------------------------------------------
  const CUSTOMER_COUNT = 55;
  const usedPhones = new Set<string>();
  function egyptianPhone(): string {
    let phone: string;
    do {
      const prefix = pick(["10", "11", "12", "15"]);
      const rest = String(intBetween(0, 99999999)).padStart(8, "0");
      phone = `+20${prefix}${rest}`;
    } while (usedPhones.has(phone));
    usedPhones.add(phone);
    return phone;
  }

  type CustomerRef = { id: string };
  const customers: CustomerRef[] = [];

  for (const chunkIdx of range(CUSTOMER_COUNT)) {
    const isMale = rand() > 0.45;
    const first = pick(isMale ? FIRST_NAMES_M : FIRST_NAMES_F);
    const last = pick(LAST_NAMES);
    const name = `${first} ${last}`;
    const phone = egyptianPhone();
    const phoneHash = blindIndex(phone, HASH_KEY);
    const phoneEncrypted = encrypt(phone, ENC_KEY);
    const hasEmail = rand() > 0.4;
    const email = hasEmail ? `${translit(first)}.${translit(last)}${chunkIdx}@example.com` : null;

    const gov = pick(governorates);

    const result = await withTenantTransaction(client, COMPANY_ID, async (tx) => {
      const customer = await tx.customer.upsert({
        where: { companyId_phoneHash: { companyId: COMPANY_ID, phoneHash } },
        create: {
          companyId: COMPANY_ID,
          name,
          phoneEncrypted,
          phoneHash,
          email,
        },
        update: {},
      });

      const addressCount = rand() > 0.7 ? 2 : 1;
      for (let a = 0; a < addressCount; a++) {
        const line = `${pick(STREETS)}، مبنى ${intBetween(1, 90)}، شقة ${intBetween(1, 20)}، ${gov.name}`;
        const lineEncrypted = encrypt(line, ENC_KEY);
        // Draw every random value up front (unconditionally) so the PRNG stream
        // consumes the same number of calls whether or not the row already
        // exists — required for the whole script's run-to-run determinism.
        const landmark = rand() > 0.5 ? `بجوار ${pick(["مسجد", "صيدلية", "سوبر ماركت"])}` : null;
        const existing = await tx.customerAddress.findFirst({
          where: { customerId: customer.id, isDefault: a === 0 },
        });
        if (!existing) {
          await tx.customerAddress.create({
            data: {
              companyId: COMPANY_ID,
              customerId: customer.id,
              lineEncrypted,
              governorateId: gov.id,
              isDefault: a === 0,
              landmark,
            },
          });
        }
      }

      return customer.id;
    });

    customers.push({ id: result });
  }
  console.info(`[seed:demo] ${customers.length} customers ready`);

  // -------------------------------------------------------------------------
  // 4. Orders (+ items, activity, reservations, shipments, invoices, refunds).
  // -------------------------------------------------------------------------
  const STATUS_WEIGHTS: { status: string; weight: number }[] = [
    { status: "new", weight: 6 },
    { status: "confirming", weight: 5 },
    { status: "processing", weight: 6 },
    { status: "incomplete", weight: 3 },
    { status: "ready", weight: 5 },
    { status: "shipped", weight: 10 },
    { status: "delivered", weight: 14 },
    { status: "completed", weight: 26 },
    { status: "postponed", weight: 4 },
    { status: "cancelled", weight: 10 },
    { status: "returned", weight: 7 },
    { status: "exchanged", weight: 4 },
  ];
  const weightedStatuses: string[] = [];
  for (const s of STATUS_WEIGHTS)
    for (let i = 0; i < s.weight; i++) weightedStatuses.push(s.status);

  const ORDER_COUNT = 95;
  let nextOrderNumber = 1;
  let invoiceNumber = 1;
  let ordersCreated = 0;
  let shipmentsCreated = 0;
  let invoicesCreated = 0;
  let refundsCreated = 0;

  const SHIPPED_LIKE = new Set(["shipped", "delivered", "completed", "returned", "exchanged"]);
  const INVOICED_LIKE = new Set(["delivered", "completed", "exchanged"]);

  for (let i = 0; i < ORDER_COUNT; i++) {
    const idemKey = `demo-order-${i + 1}`;
    const status = pick(weightedStatuses);
    const customer = pick(customers);
    const createdAt = daysAgo(intBetween(0, 75));
    const itemCount = intBetween(1, 3);
    const items = pickN(variants, itemCount).map((v) => ({
      variant: v,
      quantity: intBetween(1, 3),
    }));
    const gov = pick(governorates);
    const label = rand() > 0.6 ? pick(labelIds) : null;
    const cancelReasons = reasonsByKind.get("cancellation") ?? [];
    const returnReasons = reasonsByKind.get("return") ?? [];
    const reasonId =
      status === "cancelled" && cancelReasons.length > 0
        ? pick(cancelReasons)
        : status === "returned" && returnReasons.length > 0
          ? pick(returnReasons)
          : null;

    const subtotal = items.reduce((sum, it) => sum + it.variant.price * it.quantity, 0);
    const shippingFee = intBetween(30, 80) * 100;
    const discount = rand() > 0.8 ? Math.round(subtotal * 0.05) : 0;
    const total = subtotal + shippingFee - discount;
    const isPaidLike = ["delivered", "completed", "exchanged"].includes(status);
    const isPartial = status === "shipped" && rand() > 0.5;
    const collectedAmount = isPaidLike ? total : isPartial ? Math.round(total * 0.5) : 0;
    const paymentStatus =
      collectedAmount <= 0 ? "unpaid" : collectedAmount >= total ? "paid" : "partial";

    const orderNumber = nextOrderNumber++;

    const created = await withTenantTransaction(client, COMPANY_ID, async (tx) => {
      const existing = await tx.order.findUnique({
        where: { companyId_idempotencyKey: { companyId: COMPANY_ID, idempotencyKey: idemKey } },
      });
      if (existing) return { order: existing, isNew: false };

      const order = await tx.order.create({
        data: {
          companyId: COMPANY_ID,
          orderNumber: BigInt(orderNumber),
          customerId: customer.id,
          status,
          labelId: label,
          reasonId,
          governorateId: gov.id,
          subtotal: BigInt(subtotal),
          shippingFee: BigInt(shippingFee),
          discount: BigInt(discount),
          total: BigInt(total),
          collectedAmount: BigInt(collectedAmount),
          paymentStatus,
          statusChangedAt: createdAt,
          idempotencyKey: idemKey,
          createdAt,
          updatedAt: createdAt,
        },
      });

      for (const it of items) {
        await tx.orderItem.create({
          data: {
            companyId: COMPANY_ID,
            orderId: order.id,
            variantId: it.variant.id,
            nameSnapshot: "منتج من كتالوج شركة كادو للهدايا",
            quantity: BigInt(it.quantity),
            price: BigInt(it.variant.price),
            costSnapshot: BigInt(it.variant.cost),
            createdAt,
            updatedAt: createdAt,
          },
        });
      }

      await tx.orderActivity.create({
        data: {
          companyId: COMPANY_ID,
          orderId: order.id,
          kind: "created",
          toValue: "new",
          note: "تم إنشاء الطلب (بيانات تجريبية).",
          createdAt,
        },
      });
      if (status !== "new") {
        await tx.orderActivity.create({
          data: {
            companyId: COMPANY_ID,
            orderId: order.id,
            kind: "status_changed",
            fromValue: "new",
            toValue: status,
            createdAt,
          },
        });
      }

      if (["processing", "incomplete", "ready", "postponed"].includes(status)) {
        for (const it of items) {
          await tx.stockReservation.create({
            data: {
              companyId: COMPANY_ID,
              warehouseId,
              variantId: it.variant.id,
              quantity: BigInt(it.quantity),
              orderId: order.id,
              reference: order.id,
              status: "active",
            },
          });
        }
      }

      return { order, isNew: true };
    });

    if (created.isNew) ordersCreated++;
    const order = created.order;

    if (SHIPPED_LIKE.has(status)) {
      const shipIdemKey = `demo-shipment-${i + 1}`;
      const shipmentStatus =
        status === "shipped"
          ? pick(["in_transit", "picked_up"])
          : status === "returned"
            ? "returned"
            : "delivered";
      // Drawn unconditionally (before the idempotency check) to keep the PRNG
      // stream identical whether or not this shipment already exists.
      const shipmentFee = intBetween(30, 80) * 100;
      const shipmentDeliveredAt = shipmentStatus === "delivered" ? daysAgo(intBetween(0, 3)) : null;
      const shipResult = await withTenantTransaction(client, COMPANY_ID, async (tx) => {
        const existing = await tx.shipment.findFirst({
          where: { companyId: COMPANY_ID, idempotencyKey: shipIdemKey },
        });
        if (existing) return false;
        await tx.shipment.create({
          data: {
            companyId: COMPANY_ID,
            orderId: order.id,
            carrier: "manual",
            trackingNumber: `CDMO${String(orderNumber).padStart(6, "0")}`,
            status: shipmentStatus,
            fee: BigInt(shipmentFee),
            waybillIssued: true,
            deliveredAt: shipmentDeliveredAt,
            idempotencyKey: shipIdemKey,
            createdAt,
            updatedAt: createdAt,
          },
        });
        return true;
      });
      if (shipResult) shipmentsCreated++;
    }

    if (INVOICED_LIKE.has(status)) {
      const invIdemKey = `demo-invoice-${i + 1}`;
      const vatRateBps = 1400;
      const invoiceSubtotalMinor = total; // pre-VAT amount actually billed (order total)
      const vatMinor = Math.round((invoiceSubtotalMinor * vatRateBps) / 10000);
      // Drawn unconditionally so the PRNG stream stays identical across reruns
      // regardless of whether this invoice/refund already exists.
      const isExchangeRefund = status === "exchanged" && rand() > 0.5;
      const invResult = await withTenantTransaction(client, COMPANY_ID, async (tx) => {
        const existing = await tx.invoice.findFirst({
          where: { companyId: COMPANY_ID, idempotencyKey: invIdemKey },
        });
        if (existing) return false;
        const invoice = await tx.invoice.create({
          data: {
            companyId: COMPANY_ID,
            orderId: order.id,
            number: BigInt(invoiceNumber++),
            subtotalMinor: BigInt(invoiceSubtotalMinor),
            vatMinor: BigInt(vatMinor),
            totalMinor: BigInt(invoiceSubtotalMinor + vatMinor),
            vatRateBpsSnapshot: vatRateBps,
            idempotencyKey: invIdemKey,
            createdAt,
            updatedAt: createdAt,
          },
        });
        for (const it of items) {
          await tx.invoiceLine.create({
            data: {
              companyId: COMPANY_ID,
              invoiceId: invoice.id,
              description: "منتج من كتالوج شركة كادو للهدايا",
              quantity: BigInt(it.quantity),
              unitPriceMinor: BigInt(it.variant.price),
              lineTotalMinor: BigInt(it.variant.price * it.quantity),
              createdAt,
            },
          });
        }
        if (status === "returned" || isExchangeRefund) {
          const refundIdemKey = `demo-refund-${i + 1}`;
          const existingRefund = await tx.refund.findFirst({
            where: { companyId: COMPANY_ID, idempotencyKey: refundIdemKey },
          });
          if (!existingRefund) {
            await tx.refund.create({
              data: {
                companyId: COMPANY_ID,
                invoiceId: invoice.id,
                orderId: order.id,
                amountMinor: BigInt(total),
                reason: status === "returned" ? "إرجاع طلب" : "استبدال منتج",
                idempotencyKey: refundIdemKey,
                createdAt,
                updatedAt: createdAt,
              },
            });
            refundsCreated++;
          }
        }
        return true;
      });
      if (invResult) invoicesCreated++;
    }
  }
  console.info(
    `[seed:demo] orders: ${ordersCreated} created, shipments: ${shipmentsCreated}, invoices: ${invoicesCreated}, refunds: ${refundsCreated}`,
  );

  await withTenantTransaction(client, COMPANY_ID, async (tx) => {
    await tx.orderSequence.upsert({
      where: { companyId: COMPANY_ID },
      create: { companyId: COMPANY_ID, nextNumber: BigInt(nextOrderNumber) },
      update: { nextNumber: BigInt(nextOrderNumber) },
    });
    await tx.invoiceSequence.upsert({
      where: { companyId: COMPANY_ID },
      create: { companyId: COMPANY_ID, nextNumber: BigInt(invoiceNumber) },
      update: { nextNumber: BigInt(invoiceNumber) },
    });
  });

  // -------------------------------------------------------------------------
  // 5. Suppliers + purchase orders + receipts.
  // -------------------------------------------------------------------------
  const supplierDefs = [
    { name: "مصنع النور للهدايا", phone: "+20222334455", taxId: "SUP-001" },
    { name: "شركة دلتا للتغليف", phone: "+20233445566", taxId: "SUP-002" },
    { name: "مؤسسة الأمل للاستيراد", phone: "+20244556677", taxId: "SUP-003" },
  ];
  let poNumber = 1;
  let poCreated = 0;
  await withTenantTransaction(client, COMPANY_ID, async (tx) => {
    for (const s of supplierDefs) {
      const existingSupplier = await tx.supplier.findFirst({
        where: { companyId: COMPANY_ID, name: s.name },
      });
      const supplier =
        existingSupplier ?? (await tx.supplier.create({ data: { companyId: COMPANY_ID, ...s } }));

      const poIdemKey = `demo-po-${s.taxId}`;
      const existingPo = await tx.purchaseOrder.findFirst({
        where: { companyId: COMPANY_ID, idempotencyKey: poIdemKey },
      });
      if (existingPo) continue;

      const lines = pickN(variants, 4);
      const po = await tx.purchaseOrder.create({
        data: {
          companyId: COMPANY_ID,
          supplierId: supplier.id,
          number: BigInt(poNumber++),
          status: "received",
          idempotencyKey: poIdemKey,
          createdAt: daysAgo(intBetween(30, 70)),
        },
      });
      const poLineRows = [];
      for (const v of lines) {
        const qty = intBetween(50, 200);
        const line = await tx.purchaseOrderLine.create({
          data: {
            companyId: COMPANY_ID,
            poId: po.id,
            variantId: v.id,
            quantityOrdered: BigInt(qty),
            quantityReceived: BigInt(qty),
            unitCost: BigInt(v.cost),
          },
        });
        poLineRows.push({ line, qty });
      }
      const receipt = await tx.purchaseOrderReceipt.create({
        data: {
          companyId: COMPANY_ID,
          poId: po.id,
          warehouseId,
          idempotencyKey: `${poIdemKey}-receipt`,
          receivedAt: daysAgo(intBetween(25, 65)),
        },
      });
      for (const { line, qty } of poLineRows) {
        await tx.purchaseOrderReceiptLine.create({
          data: {
            companyId: COMPANY_ID,
            receiptId: receipt.id,
            poLineId: line.id,
            quantity: BigInt(qty),
          },
        });
      }
      await tx.purchaseOrderPayment.create({
        data: {
          companyId: COMPANY_ID,
          poId: po.id,
          amountMinor: lines.reduce((sum, v, idx) => sum + v.cost * (poLineRows[idx]?.qty ?? 0), 0),
          method: "bank_transfer",
          idempotencyKey: `${poIdemKey}-payment`,
          paidAt: daysAgo(intBetween(24, 64)),
        },
      });
      poCreated++;
    }
  });
  console.info(`[seed:demo] ${poCreated} purchase orders (with receipts + payments) ready`);

  // -------------------------------------------------------------------------
  // 6. Expenses.
  // -------------------------------------------------------------------------
  let expensesCreated = 0;
  await withTenantTransaction(client, COMPANY_ID, async (tx) => {
    for (let i = 0; i < 24; i++) {
      const idemKey = `demo-expense-${i + 1}`;
      const existing = await tx.expense.findFirst({
        where: { companyId: COMPANY_ID, idempotencyKey: idemKey },
      });
      if (existing) continue;
      await tx.expense.create({
        data: {
          companyId: COMPANY_ID,
          category: pick(EXPENSE_CATEGORIES),
          amountMinor: BigInt(intBetween(200, 15000) * 100),
          incurredAt: daysAgo(intBetween(0, 80)),
          notes: "مصروف تشغيلي (بيانات تجريبية).",
          idempotencyKey: idemKey,
        },
      });
      expensesCreated++;
    }
  });
  console.info(`[seed:demo] ${expensesCreated} expenses ready`);

  await disconnectPrisma();
  console.info("[seed:demo] done.");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function* range(n: number): Generator<number> {
  for (let i = 0; i < n; i++) yield i;
}

function chunks<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function translit(arabicFirstName: string): string {
  const map: Record<string, string> = {
    أحمد: "ahmed",
    محمد: "mohamed",
    محمود: "mahmoud",
    مصطفى: "mostafa",
    عمر: "omar",
    خالد: "khaled",
    كريم: "karim",
    يوسف: "youssef",
    إبراهيم: "ibrahim",
    طارق: "tarek",
    عادل: "adel",
    حسام: "hossam",
    وائل: "wael",
    شريف: "sherif",
    أيمن: "ayman",
    هشام: "hesham",
    عصام: "essam",
    فادي: "fady",
    رامي: "ramy",
    سامح: "sameh",
    منى: "mona",
    سارة: "sara",
    فاطمة: "fatma",
    مريم: "mariam",
    هبة: "heba",
    نور: "nour",
    ياسمين: "yasmin",
    دينا: "dina",
    رانيا: "rania",
    إيمان: "eman",
    نهى: "noha",
    سلمى: "salma",
    أميرة: "amira",
    ريهام: "reham",
    هدير: "hadeer",
    شيماء: "shaimaa",
    غادة: "ghada",
    لمياء: "lamiaa",
    نادية: "nadia",
    وفاء: "wafaa",
  };
  return map[arabicFirstName] ?? "customer";
}

function barcodeFor(productId: string, variantName: string): string {
  const seed = `${productId}${variantName}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return `62${String(hash).padStart(11, "0")}`.slice(0, 13);
}

/** Upsert-by-(companyId,name) for the handful of master-data models that share that shape. */
async function upsertByName(
  tx: SqlExecutor,
  model: "unit" | "productCategory" | "orderLabel" | "shippingZone",
  data: Record<string, unknown> & { companyId: string; name: string },
): Promise<{ id: string; created: boolean }> {
  type NamedDelegate = {
    findFirst(args: { where: { companyId: string; name: string } }): Promise<{ id: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
  const delegate = (tx as unknown as Record<string, NamedDelegate>)[model];
  const existing = await delegate.findFirst({
    where: { companyId: data.companyId, name: data.name },
  });
  if (existing) return { id: existing.id, created: false };
  const created = await delegate.create({ data });
  return { id: created.id, created: true };
}

main().catch((error: unknown) => {
  console.error("[seed:demo] failed:", error);
  process.exitCode = 1;
});

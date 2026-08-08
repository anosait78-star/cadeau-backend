# Storefront Integration — Design (Final draft, pending owner approval to implement)

**Status:** ✅ **Implemented** (backend) on `feat/epic-15-notifications`,
2026-08-08. Not assigned an EPIC number. Scope decisions D1–D9 below are
locked per the owner's 2026-08-08 review of the initial plan and were not
re-derived during implementation. See
[docs/api/storefront.md](api/storefront.md) for the as-built contract,
implementation notes, and the one recorded deviation (product upsert keyed on
`sku` alone, not `externalId`+`sku` — no `external_id` column exists on
`products`/`product_variants`). The web Settings UI (§6.1/§M-2/M-6) was not
built in this pass — lower priority per the implementation brief.

**Depends on (existing, delivered):** `access` (EPIC-5, three-layer gating),
`products` (EPIC-8), `inventory` (EPIC-9), `customers` (EPIC-10), `orders`
(EPIC-11), the event bus (EPIC-6), `audit_log`. Closest existing precedent
this design copies the shape of: [shipping-domain.md](shipping-domain.md) §6
"the webhook inbox" (`CarrierPort`, signature-verified inbound webhooks,
append-first inbox, idempotent, retry worker).

---

## 1. Goal

كل شركة مسجّلة تقدر تربط **متجرها الإلكتروني الخاص** (أو أكتر من متجر) بحساب
الشركة في Cadeau CRM، بحيث:

1. النظام يُصدر **مفتاح API مستقل لكل اتصال متجر (Storefront Connection)** —
   مش مفتاح واحد للشركة كلها.
2. أي **طلب** يتم إنشاؤه على المتجر → يوصل تلقائيًا كـ Order في حساب الشركة.
3. أي **منتج** (بياناته + سعره + كميته بالمخزون) يتم إضافته على المتجر → يوصل
   تلقائيًا كـ Product (+ Variant + رصيد مخزون) في حساب الشركة.

اتجاه واحد في v1: **من المتجر → النظام (Inbound فقط)**. لا مزامنة عكسية.
المنصّة نفسها (Salla/Zid/Shopify/WooCommerce/مخصّصة) **غير محددة بعد** — الحل:
عقد JSON عام (generic normalized contract) الآن؛ أي منصة تتحدد لاحقًا تحتاج
فقط Adapter يترجم شكلها لنفس العقد، بدون أي تعديل في منطق الأعمال (نفس نمط
`CarrierPort` الموجود في `shipping`).

## 2. In scope (v1)

- **اتصالات متعددة لكل شركة** (`storefront_connections`) — كل اتصال له اسم
  عرض (label)، ومفتاح API خاص به، ومستقل تمامًا عن باقي اتصالات نفس الشركة.
- **المفتاح تابع للاتصال، لا للشركة**: `API Key → Storefront Connection →
Company`. إلغاء أو تدوير مفتاح اتصال واحد **لا يؤثر** على باقي اتصالات نفس
  الشركة. يُخزَّن **hash فقط** (scrypt، نفس نمط كلمات السر) — لا رجعة لقراءة
  المفتاح الأصلي بعد إصداره.
- **نقطتا استقبال عامتان (ingestion, مصادقة بمفتاح API لا JWT)**:
  - `POST /v1/integrations/storefront/orders`
  - `POST /v1/integrations/storefront/products`
- **نقاط إدارة (management, مصادقة JWT + three-layer gating)** لإنشاء/عرض/
  تعديل/إلغاء/تدوير الاتصالات ومراجعة سجل الأحداث — تفصيل كامل في §6.
- **صندوق وارد (webhook inbox)**: `storefront_webhook_events`، append-first
  قبل أي معالجة، idempotent بـ `(connection_id, event_type, external_id)`،
  قابل لإعادة المعالجة يدويًا عند الفشل.
- **إعادة استخدام الخدمات الموجودة فعليًا — بدون أي منطق أعمال مكرر:**
  - الطلب الوارد → نفس مسار إنشاء الطلب الداخلي المستخدم فعليًا (نفس
    التحقق: SKU، حجز مخزون، إلخ).
  - المنتج الوارد (بيانات + سعر) → نفس مسار إنشاء/تحديث المنتج والـ variant
    الداخلي.
  - كمية المخزون الواردة → نفس مسار تسوية المخزون (adjustment) الداخلي —
    **إضافة إضافية بسيطة**: قيمة جديدة لسبب التسوية الموجود أصلًا
    (`storefront_sync`)، بدون تكرار منطق حساب `available`/الـ trigger.
  - مطابقة العميل → نفس مسار البحث/الإنشاء بالتليفون المُطبَّع (E.164) +
    الفهرس المُعمَّى (blind index) الموجود فعليًا في `customers` — لا منطق
    مطابقة جديد.
- **عزل الشركة من المفتاح فقط**: أي `companyId` قد يصل في جسم الطلب **يُتجاهل
  تمامًا** — الشركة تُحلّ من الـ API key وحده (Guard مستقل، موازي لـ
  `JwtAuthGuard`، بلا تجاوز لـ RLS).
- **إعادة استخدام الأحداث الموجودة**: `order.created`،
  `product.created`/`.updated`، `stock.changed` — كلها موجودة بالفعل في الـ
  event catalog المغلق؛ لا إضافات جديدة.
- **بوابة وصول ثلاثية (ADR-0003)**: feature key `storefront_integration` +
  permission `integrations.manage` (لإدارة الاتصالات فقط؛ الاستقبال نفسه
  محكوم بالمفتاح لا بصلاحية مستخدم).
- **واجهة إعدادات**: قائمة الاتصالات، إنشاء اتصال جديد (يعرض المفتاح مرة
  واحدة)، تدوير/إلغاء مفتاح، حالة كل اتصال وآخر حدث، سجل آخر الأحداث
  (نجاح/فشل) + زر إعادة معالجة يدوية.

## 3. Explicitly out of scope (v1)

| ليس في هذه المرحلة                                                    | ليه                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| مزامنة عكسية (System → Store): حالة الطلب/الشحن/تحديث السعر في المتجر | لم يُطلب؛ محتاج قرار تصميم منفصل لكل منصة                                                                           |
| Adapters مخصّصة لمنصة بعينها (Salla/Zid/Shopify/WooCommerce)          | مؤجّلة — العقد العام يُبنى الآن؛ كل منصة = Adapter منفصل لاحقًا (§8)                                                |
| منتجات متعددة المتغيرات (multi-variant) بحمولة متداخلة معقدة          | v1 يدعم منتج بمتغيّر واحد افتراضي لكل `externalId`؛ حمولة `variants[]` مفتوحة للتوسعة لاحقًا بدون تغيير الشكل العام |
| حذف/أرشفة منتج بالمزامنة                                              | v1 يدعم create/update فقط                                                                                           |
| Rate cards / شحن عبر المتجر                                           | خارج هذا النطاق تمامًا                                                                                              |
| Multi-tenant OAuth flows (تسجيل دخول التاجر عبر منصة المتجر)          | v1 = مفتاح يدوي يُلصق في إعدادات المتجر، لا OAuth                                                                   |

## 4. Decisions

| #   | Decision                                   | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | API key granularity                        | مفتاح واحد **لكل** `storefront_connection`، مش للشركة. الشركة اللي عندها أكتر من متجر بتاخد مفتاح مستقل لكل متجر. إلغاء/تدوير مفتاح اتصال معيّن لا يمسّ اتصالات الشركة التانية — التحقق يتم عبر `api_key_hash` الموجود على صف `storefront_connections` نفسه، مش على صف الشركة.                                                                                                                                                                                                                                                                |
| D2  | تعدد الاتصالات لكل شركة                    | `storefront_connections.company_id` **بدون** unique constraint — شركة واحدة ممكن يكون عندها N اتصال، كل واحد بـ `label` مميّز واختياريًا `platform` مختلف.                                                                                                                                                                                                                                                                                                                                                                                    |
| D3  | عزل المستأجر على مسار الاستقبال            | Guard جديد (`StorefrontApiKeyGuard`) يحلّ المفتاح → صف `storefront_connections` (status=`active`) → `companyId` + `connectionId`. **لا يُقرأ أي `companyId` من الحمولة إطلاقًا** — نفس مبدأ "التينانت من التوكن لا من الحمولة" المطبّق على JWT، لكن هنا التوكن هو مفتاح الاتصال.                                                                                                                                                                                                                                                              |
| D4  | إعادة استخدام خدمات المجال — لا تكرار منطق | طبقة الـ Integration (application layer جديدة فقط) تنادي `OrdersService`/`ProductsService`/`InventoryService`/`CustomersService` الموجودين فعليًا، بنفس الطريقة اللي تنادي بيها أي إنشاء يدوي عادي. الوحدة الجديدة لا تُعيد تنفيذ أي تحقق (SKU uniqueness، حجز مخزون، E.164 normalization، إلخ) — هي طبقة ترجمة (mapping) فقط من العقد العام لأوامر الخدمات الموجودة.                                                                                                                                                                         |
| D5  | كمية المخزون الواردة                       | تُطبَّق عبر مسار تسوية المخزون (`adjustments`) الموجود فعليًا في `inventory` — **إضافة قيمة واحدة جديدة لسبب التسوية** (`storefront_sync`) في الـ enum الموجود، بدون أي منطق حساب جديد (الـ trigger الموجود يحسب `available` زي أي تسوية تانية). المستودع المستهدف: `storefront_connections.default_warehouse_id` (اختياري لكل اتصال)؛ لو فاضي، يقع لنفس منطق حل المستودع الافتراضي للشركة المستخدم فعليًا في `orders.warehouseId` (fallback موثّق في `docs/api/orders.md`).                                                                  |
| D6  | مطابقة العميل                              | التليفون يتطبّع لـ E.164 (نفس دالة التطبيع الموجودة في `customers`)، بعدين بحث/إنشاء عبر الفهرس المُعمَّى (`phone_hash`) الموجود فعليًا — **لا منطق مطابقة جديد**، ولا حقل تليفون خام يتخزن في وحدة التكامل.                                                                                                                                                                                                                                                                                                                                  |
| D7  | صندوق الوارد + Idempotency + Retry         | `storefront_webhook_events` append-first (يُكتب السطر قبل أي معالجة)، `UNIQUE(connection_id, event_type, external_id)` يمنع التكرار عند إعادة إرسال نفس الحدث من المتجر. عند الفشل (مثلاً SKU غير موجود بعد) السطر يفضل `status=failed` + `error` قابل لإعادة المعالجة يدويًا من واجهة الإعدادات — **بدون** worker تلقائي في v1 (يُترك كخطوة تالية اختيارية، مثل نمط `WebhookRetryWorker` في shipping/notifications، لو الحاجة ظهرت).                                                                                                         |
| D8  | العقد العام أولًا، الـ Adapters لاحقًا     | يُبنى `StorefrontAdapterPort` (واجهة داخلية: `parseOrder(raw): NormalizedOrder`, `parseProduct(raw): NormalizedProduct`) + Adapter افتراضي وحيد `GenericJsonAdapter` (identity mapping — العقد العام _هو_ شكل المدخل المتوقع في v1). لما تتحدد منصة، الـ Adapter بتاعها يترجم شكلها الأصلي لنفس `NormalizedOrder`/`NormalizedProduct` وينادي **نفس** المعالج الداخلي — صفر تغيير في `OrdersService`/`ProductsService`/`InventoryService`/`CustomersService`. `storefront_connections.platform` (enum، افتراضي `generic`) محجوز لهذا مستقبلًا. |
| D9  | لا أحداث جديدة                             | إعادة استخدام `order.created`, `product.created`/`.updated`, `stock.changed` من الـ catalog المغلق الحالي — الوحدة الجديدة **ناشر إضافي** عبر نفس الخدمات، مش ناشر مباشر جديد على الـ bus.                                                                                                                                                                                                                                                                                                                                                    |

## 5. Data model

جدولان جدد، بنفس اتفاقيات `docs/core-data.md` §16.2 (id/company_id/
created_by/updated_by/timestamps + RLS FORCE بـ `company_id`):

### `storefront_connections`

| Column                                                 | Type                                                      | Notes                                                                |
| ------------------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `id`                                                   | uuid, PK                                                  |                                                                      |
| `company_id`                                           | uuid, FK → companies                                      | RLS-scoped                                                           |
| `label`                                                | text                                                      | اسم عرض يختاره المستخدم، مثال: "متجر سلة الرئيسي"                    |
| `platform`                                             | enum(`generic`, `salla`, `zid`, `shopify`, `woocommerce`) | افتراضي `generic`؛ باقي القيم محجوزة لأدابترز مستقبلية (D8)          |
| `api_key_hash`                                         | text                                                      | scrypt hash — نفس دالة `hashPassword` من `@cadeau/crypto`            |
| `api_key_prefix`                                       | varchar(8)                                                | أول أحرف من المفتاح الخام (غير سرّية) — للعرض/التمييز في الواجهة فقط |
| `default_warehouse_id`                                 | uuid, FK → warehouses, nullable                           | يُستخدم لتسوية المخزون الواردة (D5)                                  |
| `status`                                               | enum(`active`, `paused`, `revoked`)                       | افتراضي `active`                                                     |
| `last_event_at`                                        | timestamptz, nullable                                     | آخر حدث استُقبل بنجاح أو فشل                                         |
| `revoked_at`                                           | timestamptz, nullable                                     |                                                                      |
| `created_at`, `created_by`, `updated_at`, `updated_by` |                                                           | قياسي                                                                |

`UNIQUE(company_id, label)` — لمنع تكرار الاسم داخل نفس الشركة (تجربة
مستخدم، مش قيد أمني).

### `storefront_webhook_events`

| Column               | Type                                   | Notes                                                                       |
| -------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `id`                 | uuid, PK                               |                                                                             |
| `company_id`         | uuid                                   | منسوخ من `connection.company_id` وقت الكتابة — لـ RLS/فهرسة مباشرة بلا join |
| `connection_id`      | uuid, FK → storefront_connections      |                                                                             |
| `event_type`         | enum(`order`, `product`)               | أي endpoint استُقبل عنده الحدث                                              |
| `external_id`        | text                                   | معرّف الطلب/المنتج في المتجر — إلزامي، أساس idempotency                     |
| `payload`            | jsonb                                  | الحمولة الخام كما وصلت (بعد إزالة أي `companyId` مُرسَل خطأً — D3)          |
| `status`             | enum(`pending`, `processed`, `failed`) | افتراضي `pending`                                                           |
| `error`              | text, nullable                         | رسالة الفشل، لو حصل                                                         |
| `internal_entity_id` | uuid, nullable                         | `Order.id` أو `Product.id` الناتج، بعد النجاح                               |
| `attempt_count`      | int                                    | افتراضي 1، يزيد عند إعادة المعالجة اليدوية                                  |
| `received_at`        | timestamptz                            | وقت الوصول (append-first)                                                   |
| `processed_at`       | timestamptz, nullable                  |                                                                             |

`UNIQUE(connection_id, event_type, external_id)`. فهرس keyset:
`(company_id, received_at DESC, id DESC)`. FORCE RLS بـ `company_id`، نفس
نمط `shipping_webhook_events`/`audit_log`.

## 6. API endpoints (proposed)

### 6.1 Management (JWT + `RequireCapability({feature:"storefront_integration", permission:"integrations.manage"})`)

| Method | Path                                                                                | Purpose                                                                                                          |
| ------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/integrations/storefront/connections`                                           | List company's connections (keyset).                                                                             |
| POST   | `/v1/integrations/storefront/connections`                                           | Create a connection. **Response includes the plaintext API key once** — never retrievable again.                 |
| GET    | `/v1/integrations/storefront/connections/{connectionId}`                            | Detail (masked `apiKeyPrefix`, status, `defaultWarehouseId`, `lastEventAt`).                                     |
| PATCH  | `/v1/integrations/storefront/connections/{connectionId}`                            | Update `label` / `defaultWarehouseId` / `status` (`active`⇄`paused`).                                            |
| POST   | `/v1/integrations/storefront/connections/{connectionId}/rotate-key`                 | Issue a new key for this connection only; old key stops working immediately. Returns the new plaintext key once. |
| POST   | `/v1/integrations/storefront/connections/{connectionId}/revoke`                     | `status = revoked` (terminal — a new connection must be created to reconnect that store).                        |
| GET    | `/v1/integrations/storefront/connections/{connectionId}/events`                     | Recent `storefront_webhook_events` (keyset), filter `status`/`eventType`, for diagnostics.                       |
| POST   | `/v1/integrations/storefront/connections/{connectionId}/events/{eventId}/reprocess` | Manually re-run the handler for one `failed` event (D7).                                                         |

### 6.2 Ingestion (Storefront API key — `Authorization: Bearer <key>`, no JWT)

| Method | Path                                   | Purpose                                                                   |
| ------ | -------------------------------------- | ------------------------------------------------------------------------- |
| POST   | `/v1/integrations/storefront/orders`   | Create an order from the generic contract (§7).                           |
| POST   | `/v1/integrations/storefront/products` | Create/update a product + variant + stock from the generic contract (§7). |

كلاهما بيدعم `Idempotency-Key` header اختياري إضافي فوق idempotency الـ
`externalId` الأساسي (اتفاقية `api-conventions.md`)، ومحكومان بـ
`RateLimit-*` لكل مفتاح.

## 7. Generic storefront contract (draft, for review)

### Order — `POST /v1/integrations/storefront/orders`

```jsonc
{
  "externalId": "store-order-1234", // required — idempotency key
  "placedAt": "2026-08-08T10:00:00Z", // required, ISO-8601 UTC
  "customer": {
    "name": "أحمد محمد",
    "phone": "01001234567", // any common form — normalized to E.164 server-side
    "email": "optional@example.com",
  },
  "shippingAddress": {
    // optional
    "governorate": "Cairo",
    "addressLine": "...",
    "notes": "...",
  },
  "items": [{ "sku": "SKU-001", "quantity": 2, "unitPriceMinor": 15000 }],
  "currency": "EGP", // must match company currency config
  "notes": "optional",
}
```

- `items[].sku` لازم يطابق `product_variants.sku` موجود بالفعل عند الشركة —
  لو مش موجود، الحدث يتسجّل `status=failed` (`error: "unknown sku"`) وقابل
  لإعادة المعالجة بعد ما المنتج يتزامن (نفس ترتيب: المنتج الأول، الطلب
  بعده).
- الاستجابة: `201` + `{ orderId, status: "created" }` عند النجاح، أو `200` +
  `{ orderId, status: "duplicate" }` لو `externalId` اتعالج قبل كده.

### Product — `POST /v1/integrations/storefront/products`

```jsonc
{
  "externalId": "store-product-987", // required — idempotency key
  "name": "قميص قطن",
  "description": "optional",
  "sku": "SKU-001", // maps to product_variants.sku
  "barcode": "optional",
  "priceMinor": 15000,
  "stockQuantity": 42, // absolute on-hand, applied via inventory adjustment (D5)
  "active": true,
}
```

- Upsert بـ `externalId` **و** `sku` معًا (أيهما وُجد أولًا لنفس الشركة).
- `priceMinor` — لو الحقل ده مش موجود فعليًا في نموذج `ProductVariant`
  الحالي (سعر البيع)، ده قرار تصميم مفتوح لازم يتراجع مع `products-domain`
  قبل التنفيذ (هل السعر يتخزن على مستوى الـ variant ولا نموذج تسعير منفصل؟)
  — **علّمتها في §8 كسؤال مفتوح**.
- الاستجابة: `201` (منتج جديد) أو `200` (تحديث منتج موجود) + `{ productId,
variantId, status: "created" | "updated" | "duplicate" }`.

## 8. Open question still outstanding

السعر الوارد من المتجر (`priceMinor`) — محتاج تأكيد إزاي يتخزن في نموذج
المنتج الحالي (`ProductVariant` عندها `averageCost` بس مشتق من الشراء، مفيش
حقل "سعر بيع" صريح حسب `docs/api/products.md` الحالي). هل:

- (أ) نضيف حقل `sellingPrice` جديد لـ `product_variants` كجزء من هذا العمل، أو
- (ب) السعر الوارد من المتجر بيتجاهل في v1 (بيانات المنتج + المخزون فقط
  بيتزامنوا، السعر يُدار يدويًا في CRM)، أو
- (ج) حقل تسعير منفصل موجود بالفعل وفاتني في المراجعة.

باقي التصميم (الجداول، الـ endpoints، الـ Guard، إعادة استخدام الخدمات)
**نهائي وجاهز للتنفيذ** بمجرد الرد على السؤال ده.

## 9. Milestones (unchanged sequencing, decisions locked)

| #   | Milestone                                                                                                            | Output                                             |
| --- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| M-1 | Migration: `storefront_connections` + `storefront_webhook_events` + RLS FORCE                                        | جداول + سياسات                                     |
| M-2 | إدارة الاتصالات (create/list/detail/patch/rotate-key/revoke) + `integrations.manage` في EPIC-5 catalog + Settings UI | §6.1 كامل                                          |
| M-3 | `StorefrontApiKeyGuard` + كتابة الصندوق الوارد (بدون معالجة بعد)                                                     | استقبال آمن مسجَّل                                 |
| M-4 | `StorefrontAdapterPort` + `GenericJsonAdapter` + معالجة الطلبات → `OrdersService`/`CustomersService`                 | طلبات المتجر تظهر في `/orders`                     |
| M-5 | معالجة المنتجات → `ProductsService` + تسوية مخزون → `InventoryService` (سبب `storefront_sync`)                       | منتجات المتجر تظهر في `/products` برصيد مخزون صحيح |
| M-6 | واجهة سجل الأحداث + إعادة معالجة يدوية                                                                               | تشخيص ذاتي بلا دعم فني                             |
| M-7 | بوابة الجودة الكاملة (أمان/معمارية/كود/اختبار/أداء) — نفس نمط كل Epic سابق                                           | موافقة صريحة قبل الإغلاق                           |

---

**لا كود اتكتب بعد.** بانتظار ردّك على السؤال المفتوح في §8، وبعدها
موافقتك الصريحة على هذه الوثيقة كاملة قبل بدء أي تنفيذ.

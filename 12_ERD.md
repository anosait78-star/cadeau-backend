# 12 — ERD (Entity-Relationship Diagram)
## نموذج العلاقات الكامل لنظام OrdersFlow

> **حالة الوثيقة:** مرجع رسمي معتمد (Authoritative Reference)
> **نطاق هذا الملف:** التمثيل المرئي والوصفي الكامل للعلاقات بين كل كيانات النظام — العلاقات، الكثافة (Cardinality)، اتجاه المفاتيح، قواعد الحذف، والعلاقات الخاصة.
> **قاعدة البيانات:** PostgreSQL عبر Supabase.
> **تصنيف الثقة:** ✅ مؤكد · 🟡 مرجّح · ⚪ تخمين
> **هذا الملف مستقل بذاته** — يُقرأ دون الرجوع لأي ملف آخر.
> **مرجع مكمّل:** تفاصيل الحقول في `11_Database.md`.

---

# Overview

هذا الملف يوثّق **نموذج العلاقات (Entity-Relationship Model)** لنظام OrdersFlow — كيف ترتبط الكيانات ببعضها. النظام يتبع بنية **نجمية حول كيانين محوريين**:

1. **`companies`** — الجذر المطلق لكل شيء (عزل المستأجرين). كل كيان أعمال يتفرّع منه.
2. **`orders`** — المحور التشغيلي الذي يربط العملاء + المنتجات + الفريق + الشحن + التصنيفات.

الرموز المستخدمة:
- `(1)` = طرف واحد · `(M)` = طرف متعدد.
- `──<` = علاقة واحد-لمتعدد (1:M) في اتجاه الفتحة.
- `>──` = الطرف المتعدد يشير للطرف الواحد (FK).
- `[field]` = المفتاح الأجنبي الحامل للعلاقة.

---

# المخطط الشامل (Master ERD — نصّي)

```
                          ┌──────────────┐
                          │   companies  │  (المستأجر الجذر)
                          └──────┬───────┘
        ┌────────────┬──────────┼───────────┬────────────┬─────────────┐
        │            │          │           │            │             │
   company_       company_   customers    orders     products    inventories
   members ●     features       │           │           │             │
   (M:N users)                  │           │           │             │
        │                       │           │      parent_product_id   │
     profiles                   └──────┐    │        (self ref)        │
        │                              │    │           │              │
   notifications              ┌────────┴────┴───┐  inventory_stock ────┘
                              │     ORDERS       │       │
                              │  (المحور)         │   stock_transfers
                              └────────┬─────────┘   (from/to inventories)
         ┌──────────┬─────────┬───────┼────────┬──────────┬───────────┐
    order_items  order_    order_   whatsapp_ order_    shipments   order_
       │        labels ●  reasons  confirm.  comments  (مرجّح)     activities
    products   (M:N via              (سبب                          (سجل نشاط)
               assignments)          الإلغاء)

   suppliers ──< purchase_orders ──< po_items >── products
                     │      │
                po_payments  po_receiving_logs → (يزيد) inventory_stock

   companies ──< expenses / month_closes / capital_log
   companies ──< shipping_offices / shipping_zones● / carrier_connections●
   companies ──< subscriptions● >── plans●
```
(● = جدول/علاقة مرجّحة 🟡)

---

# العلاقات حول `companies` (عزل المستأجرين) ✅

كل الجداول التالية ترتبط بـ `companies` عبر `company_id (FK)` بعلاقة **(1:M)** — الشركة الواحدة لها العديد من كلٍّ:

```
companies (1) ──< company_members     [company_id]   ✅
companies (1) ──< company_features    [company_id]   ✅
companies (1) ──< customers           [company_id]   ✅
companies (1) ──< orders              [company_id]   ✅
companies (1) ──< products            [company_id]   ✅
companies (1) ──< inventories         [company_id]   ✅
companies (1) ──< stock_transfers     [company_id]   ✅
companies (1) ──< suppliers           [company_id]   ✅
companies (1) ──< purchase_orders     [company_id]   ✅
companies (1) ──< po_payments         [company_id]   ✅
companies (1) ──< expenses            [company_id]   ✅
companies (1) ──< month_closes        [company_id]   ✅
companies (1) ──< capital_log         [company_id]   ✅
companies (1) ──< order_labels        [company_id]   ✅
companies (1) ──< order_reasons       [company_id]   ✅
companies (1) ──< shipping_offices    [company_id]   ✅
companies (1) ──< shipping_zones      [company_id]   🟡
companies (1) ──< carrier_connections [company_id]   🟡
companies (1) ──< whatsapp_templates  [company_id]   🟡
companies (1) ──< subscriptions       [company_id]   🟡
```

**قاعدة جوهرية (✅):** `company_id` حاضر في كل كيان أعمال. لا كيان أعمال بلا شركة. هذا أساس RLS.

---

# علاقة العضوية (M:N) — المستخدمون والشركات ✅

```
auth.users (1) ──< profiles (1:1)                    ✅
profiles/auth.users (M) ──< company_members >── (M) companies    ✅
```

- **`company_members`** جدول وصل (Junction) يحقّق علاقة **M:N** بين المستخدمين والشركات.
- مستخدم واحد → عدة عضويات → عدة شركات (تعدد الشركات). ✅
- شركة واحدة → عدة أعضاء بأدوار مختلفة. ✅
- يحمل: `role`, `status` (+ `invite_code` مرجّح).

```
profiles (1) ──< notifications        [user_id]      ✅
```

---

# العلاقات حول `orders` (المحور التشغيلي) ✅

```
orders (M) >── (1) customers          [customer_id]        🟡
orders (M) >── (1) company_members    [assigned_to]        ✅
orders (M) >── (1) company_members    [created_by]         ⚪
orders (M) >── (1) order_reasons      [cancel_reason_id]   🟡
orders (M) >── (1) inventories        [inventory_id]       🟡
orders (1) ──< order_items >── (1) products                ✅
orders (M) ──< order_label_assignments >── (M) order_labels  ✅ (M:N)
orders (1) ──< whatsapp_confirmations                       ✅
orders (1) ──< order_comments                               🟡
orders (1) ──< order_activities / activity_log              🟡
orders (1) ──< shipments >── (1) carrier                    🟡
```

**شرح العلاقات المحورية:**

| العلاقة | الكثافة | الحامل | الدلالة | الثقة |
|--------|---------|--------|---------|------|
| orders → customers | M:1 | `customer_id` | كل طلب لعميل؛ العميل له طلبات كثيرة | 🟡 |
| orders → company_members | M:1 | `assigned_to` | إسناد الطلب لعضو مسؤول | ✅ |
| orders → order_items | 1:M | `order_id` في items | بنود الطلب | ✅ |
| order_items → products | M:1 | `product_id` | كل بند يشير لمنتج | ✅ |
| orders ↔ order_labels | M:N | عبر assignments | تصنيفات متعددة لطلبات متعددة | ✅ |
| orders → order_reasons | M:1 | `cancel_reason_id` | سبب الإلغاء | 🟡 |
| orders → whatsapp_confirmations | 1:M | `order_id` | تأكيدات واتساب | ✅ |

> **ملاحظة النمذجة الهجينة (✅):** الطلب يحمل بيانات العميل **نصيًا** (`customer_name`, `customer_phone`) **إضافةً** إلى `customer_id` المرجّح. هذا denormalization متعمّد يحمي سجل الطلب من تغيّر بيانات العميل ويسمح بطلبات يدوية بلا سجل عميل رسمي.

---

# علاقة التصنيفات M:N ✅

```
orders (M) ──< order_label_assignments >── (M) order_labels
```

- **`order_label_assignments`** جدول وصل بـ `(order_id, label_id)`.
- طلب واحد → عدة تصنيفات (مستعجل + مكرر). ✅
- تصنيف واحد → عدة طلبات. ✅
- **PK مرجّح:** `(order_id, label_id)` (يمنع تكرار نفس التصنيف على نفس الطلب).

---

# العلاقات حول المنتجات والمخزون ✅

```
products (M) >── (1) companies              [company_id]           ✅
products (1) ──< products [المتغيرات]        [parent_product_id]    ✅ (self-reference)
products (1) ──< inventory_stock >── (M) inventories               ✅ (M:N via stock)
products (1) ──< order_items                                       ✅
products (1) ──< po_items                                          ✅
```

## العلاقة الذاتية (Self-Reference) — المتغيرات ✅
```
products.parent_product_id → products.id
```
- المنتج الأب: `parent_product_id = NULL`.
- المتغير: `parent_product_id = <id الأب>`.
- منتج أب واحد → عدة متغيرات (أبناء). **1:M ذاتية.** ✅

## المخزون كعلاقة M:N ✅
```
products (M) ──< inventory_stock >── (M) inventories
```
- **`inventory_stock`** جدول وصل بـ `(product_id, inventory_id)` + كميات (`on_hand`, `committed`).
- منتج واحد → مخزون في عدة مستودعات. ✅
- مستودع واحد → مخزون لعدة منتجات. ✅
- **PK مرجّح:** `(inventory_id, product_id)`.

## تحويلات المخزون — الربط المزدوج ✅
```
stock_transfers (M) >── (1) inventories   [from_inventory_id]   ✅
stock_transfers (M) >── (1) inventories   [to_inventory_id]     ✅
stock_transfers (1) ──< stock_transfer_items >── (1) products   🟡
```

**ملاحظة خاصة (✅):** `stock_transfers` يرتبط بجدول `inventories` **مرتين** (مصدر وهدف) — مفتاحان أجنبيان لنفس الجدول. مؤكد من استعلام الشبكة `from_inventory:inventories!from_inventory_id` و`to_inventory:inventories!to_inventory_id`.

---

# العلاقات حول الموردين والشراء ✅

```
suppliers (M) >── (1) companies             [company_id]              ✅
suppliers (1) ──< purchase_orders           [supplier_id]             ✅
purchase_orders (1) ──< po_items >── (1) products                     ✅
purchase_orders (1) ──< po_payments                                   ✅
purchase_orders (1) ──< po_receiving_logs                             ✅
po_receiving_logs (M) >── (1) inventories   [inventory_id]  → يزيد inventory_stock   🟡
```

**شرح:**
| العلاقة | الكثافة | الدلالة | الثقة |
|--------|---------|---------|------|
| suppliers → purchase_orders | 1:M | مورد له عدة أوامر | ✅ |
| purchase_orders → po_items | 1:M | أمر له عدة بنود | ✅ |
| po_items → products | M:1 | كل بند لمنتج | ✅ |
| purchase_orders → po_payments | 1:M | أمر له عدة دفعات (جزئية) | ✅ |
| purchase_orders → po_receiving_logs | 1:M | أمر له عدة استلامات (جزئية) | ✅ |
| po_receiving_logs → inventory_stock | (أثر) | الاستلام يزيد `on_hand` | 🟡 |

---

# العلاقات المالية ✅

```
companies (1) ──< expenses          [company_id]       ✅
companies (1) ──< month_closes      [company_id]       ✅
companies (1) ──< capital_log       [company_id]       ✅
```

**العلاقات المحسوبة (لا مفاتيح مباشرة، بل تجميعات):**
```
orders.collected_amount  ┐
po_payments.amount       ├──→ المركز النقدي (محسوب عبر RPC)
expenses.amount          ┘
suppliers.balance        ───→ المستحق للموردين (مجموع)
```

> **ملاحظة (✅):** المركز النقدي وP&L ليسا جداول بل **نتائج تجميع** عبر `get_analytics_summary`؛ العلاقة منطقية لا مرجعية.

---

# العلاقات حول الشحن 🟡

```
orders (1) ──< shipments >── (1) carrier                🟡
companies (1) ──< shipping_offices    [company_id]      ✅
companies (1) ──< shipping_zones      [company_id]      🟡
companies (1) ──< carrier_connections [company_id]      🟡
shipments (M) >── carrier_connections (مرجّح)            ⚪
shipping_settlements (M) >── carrier (مرجّح)             🟡
```

- `shipments` (مرجّح) يربط الطلب بشركة الشحن ورقم التتبع والبوليصة.
- `shipping_zones` تحدّد سعر الشحن حسب المحافظة (تغذّي `orders.shipping_cost`).
- `carrier_connections` تخزّن ربط شركات الشحن (مفاتيح).

---

# العلاقات حول الاشتراكات 🟡

```
companies (1) ──< subscriptions >── (1) plans           🟡
subscriptions ↔ company_features (تفعيل الميزات)         🟡
```

- الاشتراك يربط الشركة بخطة، والخطة تحدّد الميزات المفعّلة في `company_features`.

---

# جدول ملخّص الكثافة (Cardinality Summary)

| الكيان الأب | الكيان الابن | الكثافة | الحامل | الثقة |
|------------|-------------|---------|--------|------|
| companies | (كل كيانات الأعمال) | 1:M | company_id | ✅ |
| companies ↔ users | company_members | M:N | (company_id, user_id) | ✅ |
| customers | orders | 1:M | customer_id | 🟡 |
| orders | order_items | 1:M | order_id | ✅ |
| products | order_items | 1:M | product_id | ✅ |
| orders ↔ labels | order_label_assignments | M:N | (order_id, label_id) | ✅ |
| products | products (متغيرات) | 1:M ذاتية | parent_product_id | ✅ |
| products ↔ inventories | inventory_stock | M:N | (product_id, inventory_id) | ✅ |
| inventories | stock_transfers | 1:M ×2 | from/to_inventory_id | ✅ |
| suppliers | purchase_orders | 1:M | supplier_id | ✅ |
| purchase_orders | po_items | 1:M | purchase_order_id | ✅ |
| purchase_orders | po_payments | 1:M | purchase_order_id | ✅ |
| purchase_orders | po_receiving_logs | 1:M | purchase_order_id | ✅ |
| company_members | orders | 1:M | assigned_to | ✅ |
| orders | whatsapp_confirmations | 1:M | order_id | ✅ |
| orders | shipments | 1:M | order_id | 🟡 |
| profiles | notifications | 1:M | user_id | ✅ |

---

# قواعد الحذف والسلامة المرجعية (Referential Integrity) 🟡

> **مرجّحة 🟡** — مستنتجة من الضرورة المعمارية، لم تُرصد DDL.

| العلاقة | قاعدة الحذف المتوقّعة | المبرّر |
|--------|----------------------|---------|
| orders → order_items | **CASCADE** | البنود لا معنى لها بلا طلب |
| orders → order_label_assignments | **CASCADE** | الربط يتبع الطلب |
| orders → whatsapp_confirmations | **CASCADE** | التأكيدات تتبع الطلب |
| purchase_orders → po_items/payments/receiving | **CASCADE** | البنود تتبع الأمر |
| products → order_items | **RESTRICT/أرشفة** | حفظ التاريخ (product_name denormalized يحمي) |
| customers → orders | **RESTRICT/أرشفة** | لا يُحذف عميل له طلبات |
| inventories → inventory_stock | **RESTRICT/أرشفة** | لا يُحذف مستودع بمخزون |
| companies → (الكل) | **CASCADE أو منع** | حذف الشركة عملية خطيرة جدًا |

**مبدأ عام (✅):** النظام يميل لـ **الأرشفة (`is_archived`) لا الحذف الصلب** للكيانات المرجعية (موردون/مستودعات)، وحفظ الأسماء نصيًا (denormalization) لحماية السجلات التاريخية.

---

# أنماط النمذجة المميّزة (Notable Modeling Patterns)

| النمط | أين | الدلالة | الثقة |
|------|-----|---------|------|
| **Self-Reference** | products.parent_product_id | المتغيرات كأبناء | ✅ |
| **Double FK لنفس الجدول** | stock_transfers (from/to inventories) | تحويل بين موقعين | ✅ |
| **Junction M:N** | company_members, order_label_assignments, inventory_stock | علاقات متعدد-لمتعدد | ✅ |
| **Denormalization متعمّد** | orders (customer_name/phone), order_items (product_name) | حماية تاريخية + طلبات يدوية | ✅ |
| **بُعدان للحالة** | orders (status + follow_up_status) | فصل الحالة عن المتابعة | ✅ |
| **بيانات محسوبة/مشتقّة** | المركز النقدي، حالات PO، total_orders | تجميعات لا جداول | 🟡 |
| **Feature Flags** | company_features ↔ subscriptions | ربط الخطط بالميزات | 🟡 |

---

# Reverse Engineering Notes

- العلاقات المؤكدة (✅) مستنتجة من **استعلامات PostgREST المضمّنة** (`select=*,order_items(*),order_label_assignments(order_labels(*))`) التي تكشف المفاتيح الأجنبية صراحةً.
- **الربط المزدوج لـ stock_transfers** مؤكد من صيغة `!from_inventory_id`/`!to_inventory_id` في الاستعلام.
- **العلاقة الذاتية للمتغيرات** مؤكدة من `parent_product_id=not.is.null`.
- العلاقات المرجّحة (🟡) — خاصة الشحن والاشتراكات — مستنتجة من الوظائف دون رصد الاستعلام المضمّن.
- **قواعد الحذف والكثافة الدقيقة** مرجّحة/تخمين — لم نرَ قيود DDL، بل استنتجناها من السلوك والمنطق.
- **`created_by` و`customer_id`** كمفاتيح صريحة مرجّحة — الطلب يحمل بيانات نصية قد تغني عنها جزئيًا.

---

# Confidence Level

| الجانب | الثقة |
|-------|------|
| تفرّع كل الكيانات من companies | ✅ مؤكد |
| علاقة العضوية M:N (company_members) | ✅ مؤكد |
| علاقات orders المحورية (items/labels/whatsapp/assigned) | ✅ مؤكد |
| العلاقة الذاتية للمتغيرات | ✅ مؤكد |
| المخزون M:N (inventory_stock) | ✅ مؤكد |
| الربط المزدوج (stock_transfers) | ✅ مؤكد |
| علاقات الشراء (PO/items/payments/receiving) | ✅ مؤكد |
| ربط orders → customers (customer_id) | 🟡 مرجّح |
| علاقات الشحن (shipments/zones/carriers) | 🟡 مرجّح |
| علاقات الاشتراكات | 🟡 مرجّح |
| قواعد الحذف (CASCADE/RESTRICT) | 🟡/⚪ |

---

READY FOR NEXT FILE

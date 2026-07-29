# 11 — DATABASE
## مخطط قاعدة البيانات الكامل لنظام OrdersFlow (Data Model Reference)

> **حالة الوثيقة:** مرجع رسمي معتمد (Authoritative Reference)
> **نطاق هذا الملف:** التوثيق الشامل لكل جدول، كل حقل، أنواع البيانات، المفاتيح، الفهارس، القيود، سياسات RLS، القيم الثابتة (Enums)، ودوال RPC — بأقصى تفصيل ممكن.
> **قاعدة البيانات:** PostgreSQL عبر Supabase (مشروع `gvvzqqcukynhapdgvcmj`) — الوصول عبر PostgREST.
> **تصنيف الثقة:** ✅ مؤكد · 🟡 مرجّح · ⚪ تخمين
> **هذا الملف مستقل بذاته** — يُقرأ دون الرجوع لأي ملف آخر.
> **مرجع مكمّل:** نموذج العلاقات المرئي في `12_ERD.md`؛ الـ APIs في `13_APIs.md`.

---

# Overview

قاعدة بيانات OrdersFlow هي **PostgreSQL** مُدارة عبر Supabase، مكشوفة للعميل مباشرة عبر **PostgREST** (`/rest/v1/<table>`). كل الوصول يمرّ بطبقة **Row Level Security (RLS)** التي تفرض عزل المستأجرين حسب `company_id` 🟡.

**المبادئ المعمارية للمخطط:**

1. **العزل بـ `company_id`:** كل جدول أعمال يحمل `company_id (uuid)` كمفتاح مستأجر. ✅
2. **المفاتيح UUID:** كل الجداول تستخدم `id (uuid)` كمفتاح أساسي 🟡 (نمط Supabase الافتراضي).
3. **الطوابع الزمنية:** `created_at`/`updated_at (timestamptz)` مرجّحة في معظم الجداول 🟡.
4. **المنطق المعقّد في RPC:** التجميعات والعمليات متعددة الجداول عبر Postgres Functions.
5. **البيانات المشتقّة:** بعض القيم (`total_orders`, حالة دفع/استلام PO) مخزّنة أو محسوبة — يُحسم لاحقًا.

**جرد المخطط:** **26 جدولًا مؤكدًا ✅** + **~8 جداول مرجّحة 🟡** + **4 دوال RPC مؤكدة ✅**.

---

# اصطلاحات التوثيق

| الرمز | المعنى |
|------|--------|
| **PK** | مفتاح أساسي (Primary Key) |
| **FK** | مفتاح أجنبي (Foreign Key) |
| **UQ** | قيد فريد (Unique) |
| **IX** | فهرس (Index) |
| ✅/🟡/⚪ | ثقة الحقل/الجدول: مؤكد/مرجّح/تخمين |

> **ملاحظة الأنواع:** الأنواع (uuid/text/numeric/int/bool/timestamptz/enum) **مرجّحة 🟡 ما لم يُذكر تأكيد** — لأننا نرى القيم لا تعريف الأعمدة. الأسماء المؤكدة ظهرت في `select`/الواجهة/الشبكة.

---

# مجموعة 1: النواة والمستأجرون (Core & Tenancy)

## `companies` — الشركات (المستأجر الجذر) ✅
**الغرض:** كيان الشركة/المتجر — جذر عزل كل البيانات.

| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | معرّف الشركة | ✅ |
| `name` | text | | اسم الشركة (Cadeau Egypt) | ✅ |
| `country` | text | | الدولة | 🟡 |
| `currency` | text | | العملة (EGP) | 🟡 |
| `country_prefix` | text/int | | بادئة الدولة (20) | 🟡 |
| `app_language` | text | | اللغة الافتراضية | ⚪ |
| `created_at` | timestamptz | | | 🟡 |

## `company_members` — عضوية الفريق ✅
**الغرض:** ربط المستخدمين بالشركات وأدوارهم (جدول العضوية M:N).

| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | (أو PK مركّب company_id+user_id) | 🟡 |
| `company_id` | uuid | FK→companies | | ✅ |
| `user_id` | uuid | FK→auth.users/profiles | | ✅ |
| `role` | text/enum | | أحد الأدوار التسعة | ✅ |
| `status` | text | | نشط/معلّق | ✅ |
| `invite_code` | text | | رمز الدعوة (أو على مستوى الشركة) | 🟡 |
| `created_at` | timestamptz | | | 🟡 |

**IX مرجّح:** `(company_id)`, `(user_id)`. **UQ مرجّح:** `(company_id, user_id)`.

## `company_features` — مفاتيح تفعيل الميزات ✅
**الغرض:** تفعيل/تعطيل الميزات لكل شركة (Feature Flags مرتبطة بالاشتراك).

| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `company_id` | uuid | FK→companies | | ✅ |
| (أعلام الميزات) | bool | | عمود/صف لكل ميزة | ⚪ |

> **ملاحظة (⚪):** النموذج الدقيق (أعمدة boolean متعددة أم صفوف key/value) غير محسوم.

## `profiles` — ملفات المستخدمين ✅
**الغرض:** بيانات عرض المستخدم (يمتد `auth.users`).

| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK = auth.users.id | | ✅ |
| `full_name` | text | | | ✅ |
| `avatar` | text | | رابط الصورة | 🟡 |

## `auth.users` — مستخدمو Supabase Auth ✅
**الغرض:** المصادقة (مُدار من Supabase/GoTrue). الحقول القياسية: `id`, `email`, `encrypted_password`, إلخ. لا يُدار من التطبيق مباشرة.

---

# مجموعة 2: العملاء (Customers)

## `customers` — العملاء ✅
**الغرض:** قاعدة بيانات العملاء النهائيين (CRM).

| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | ✅ |
| `company_id` | uuid | FK→companies | عزل المستأجر | ✅ |
| `name` | text | | | ✅ |
| `phone` | text | | (مرجّح مفتاح تجميع) | ✅ |
| `phone2` | text | | هاتف ثانٍ | 🟡 |
| `type` | text | | Regular/… | ✅ |
| `status` | text | | active/… | ✅ |
| `address` | text | | | 🟡 |
| `city` | text | | | 🟡 |
| `neighborhood` | text | | الحي | 🟡 |
| `governorate` | text | | المحافظة | 🟡 |
| `social_platform` | text | | المنصة | 🟡 |
| `social_username` | text | | اسم الحساب | 🟡 |
| `notes` | text | | | 🟡 |
| `total_orders` | int | | مشتق/مخزّن | 🟡 |
| `total_revenue` | numeric | | مشتق/مخزّن | 🟡 |
| `created_at` | timestamptz | | | 🟡 |

**IX مرجّح:** `(company_id, phone)` — لمنع تكرار العميل وتجميع طلباته.

---

# مجموعة 3: الطلبات (Orders) — النواة

## `orders` — الطلبات ✅ (الجدول المركزي)
**الغرض:** الكيان المحوري — كل طلب من عميل بدورة حياته الكاملة.

| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | ✅ |
| `company_id` | uuid | FK→companies | | ✅ |
| `customer_id` | uuid | FK→customers | ربط العميل | 🟡 |
| `order_number` | text | | قد يحمل بادئة (WC-) | ✅ |
| `customer_name` | text | | مخزّن نصيًا (denormalized) | ✅ |
| `customer_phone` | text | | | ✅ |
| `customer_phone2` | text | | | 🟡 |
| `governorate` | text | | المحافظة | ✅ |
| `city` | text | | | ✅ |
| `street_address` | text | | (مبنى/طابق/شقة) | ✅ |
| `neighborhood` | text | | | 🟡 |
| `social_platform` | text | | | ✅ |
| `social_username` | text | | | ✅ |
| `status` | enum | IX | 12 قيمة (انظر Enums) | ✅ |
| `follow_up_status` | text/enum | | حالة المتابعة (منفصلة) | ✅ |
| `assigned_to` | uuid | FK→company_members | الإسناد | ✅ |
| `inventory_id` | uuid | FK→inventories | مستودع الطلب | 🟡 |
| `subtotal` | numeric | | المجموع الفرعي | ✅ |
| `shipping_cost` | numeric | | تكلفة الشحن | ✅ |
| `discount` | numeric | | الخصم | ✅ |
| `total` | numeric | | الإجمالي | ✅ |
| `payment_status` | text/enum | | حالة الدفع | ✅ |
| `collected_amount` | numeric | | **المستلم فعليًا بعد رسوم الشحن** | ✅ |
| `notes` | text | | | ✅ |
| `cancel_reason_id` | uuid | FK→order_reasons | سبب الإلغاء | 🟡 |
| `created_at` | timestamptz | IX | | ✅ |
| `updated_at` | timestamptz | | | 🟡 |
| `status_changed_at` | timestamptz | | لفلتر تاريخ تغيير الحالة | 🟡 |
| `created_by` | uuid | FK→company_members | من أنشأ (للأداء) | ⚪ |

**IX مرجّح:** `(company_id, status)`, `(company_id, created_at)`, `(assigned_to)`, `(customer_id)`.

## `order_items` — بنود الطلب ✅
| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | ✅ |
| `order_id` | uuid | FK→orders | | ✅ |
| `product_id` | uuid | FK→products | | ✅ |
| `product_name` | text | | مخزّن نصيًا (حفظ تاريخي) | ✅ |
| `quantity` | int | | | ✅ |
| `price` | numeric | | سعر البند وقت الطلب | ✅ |

**ملاحظة (✅):** حفظ `product_name` نصيًا يحمي سجل الطلب من تغيّر/حذف المنتج لاحقًا.

## `order_labels` — التصنيفات/الوسوم ✅
| الحقل | النوع | مفتاح | الثقة |
|------|------|-------|------|
| `id` | uuid | PK | ✅ |
| `company_id` | uuid | FK→companies | ✅ |
| `name` | text | | ✅ |
| `color` | text | | ✅ |

## `order_label_assignments` — ربط الطلب بالتصنيفات (M:N) ✅
| الحقل | النوع | مفتاح | الثقة |
|------|------|-------|------|
| `order_id` | uuid | FK→orders | ✅ |
| `label_id` | uuid | FK→order_labels | ✅ |

**PK مرجّح:** `(order_id, label_id)`.

## `order_reasons` — أسباب الإلغاء/الإرجاع ✅
| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | ✅ |
| `company_id` | uuid | FK→companies | | ✅ |
| `type` | text | | cancel / return | ✅ |
| `label` | text | | نص السبب | ✅ |
| `created_at` | timestamptz | | | 🟡 |

## `whatsapp_confirmations` — تأكيدات واتساب ✅
| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | 🟡 |
| `order_id` | uuid | FK→orders | | ✅ |
| `status` | text | | حالة التأكيد | ✅ |
| `sent_at` | timestamptz | | | ✅ |

## `order_comments` — تعليقات الطلب الداخلية 🟡
| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | 🟡 |
| `order_id` | uuid | FK→orders | | 🟡 |
| `user_id` | uuid | FK→profiles | كاتب التعليق | 🟡 |
| `body` | text | | نص التعليق | 🟡 |
| `created_at` | timestamptz | | | 🟡 |

## `activity_log` / `order_activities` — سجل نشاط الطلب 🟡
| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | 🟡 |
| `order_id` | uuid | FK→orders | | 🟡 |
| `user_id` | uuid | FK→profiles | الفاعل | 🟡 |
| `action` | text | | نوع الإجراء | 🟡 |
| `from_status`/`to_status` | text | | لتغييرات الحالة | 🟡 |
| `created_at` | timestamptz | | | 🟡 |

---

# مجموعة 4: المنتجات والمخزون (Products & Inventory)

## `products` — المنتجات والمتغيرات ✅
**الغرض:** الكتالوج؛ المتغيرات أبناء عبر self-reference.

| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | ✅ |
| `company_id` | uuid | FK→companies | | ✅ |
| `name` | text | | | ✅ |
| `sku` | text | | رمز المنتج (اختياري) | ✅ |
| `price` | numeric | | سعر البيع | ✅ |
| `cost` | numeric | | التكلفة (لـ COGS) | ✅ |
| `low_stock_threshold` | int | | عتبة تنبيه النفاد | ✅ |
| `parent_product_id` | uuid | FK→products (self) | المتغير يشير لأبيه | ✅ |
| `variant_name` | text | | اسم المتغير (لون/مقاس/عطر) | ✅ |
| `allow_oversell` | bool | | السماح بالبيع عند النفاد | 🟡 |
| `image_url` | text | | صورة (مضغوطة) | 🟡 |
| `created_at` | timestamptz | | | 🟡 |

**IX:** `(company_id)`, `(parent_product_id)`. **UQ مرجّح:** `(company_id, sku)`.

## `inventories` — المستودعات ✅
**الغرض:** مواقع التخزين (تسمية داخلية: `inventories` لا `warehouses`).

| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | ✅ |
| `company_id` | uuid | FK→companies | | ✅ |
| `name` | text | | | ✅ |
| `address` | text | | | 🟡 |
| `is_default` | bool | | مستودع افتراضي واحد | ✅ |
| `is_archived` | bool | | مؤرشف | 🟡 |
| `created_at` | timestamptz | | | 🟡 |

## `inventory_stock` — المخزون لكل مستودع ✅
**الغرض:** الكمية لكل زوج (منتج × مستودع).

| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `product_id` | uuid | FK→products | | ✅ |
| `inventory_id` | uuid | FK→inventories | | ✅ |
| `on_hand` | int | | المتوفر فعليًا | ✅ |
| `committed` | int | | المحجوز لطلبات قيد المعالجة | ✅ |
| `quantity` | int | | (مرجّح = on_hand أو متاح) | ✅ |

**PK مرجّح:** `(inventory_id, product_id)`. **المتاح** = `on_hand − committed` 🟡.

## `stock_transfers` — تحويلات المخزون ✅
| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | ✅ |
| `company_id` | uuid | FK→companies | | ✅ |
| `from_inventory_id` | uuid | FK→inventories | المصدر | ✅ |
| `to_inventory_id` | uuid | FK→inventories | الهدف | ✅ |
| `created_at` | timestamptz | | | ✅ |
| `created_by` | uuid | FK→company_members | المنفّذ | ⚪ |

**ملاحظة (✅):** مفتاحان أجنبيان لنفس الجدول `inventories` (from/to).

## `stock_transfer_items` — بنود التحويل 🟡
| الحقل | النوع | مفتاح | الثقة |
|------|------|-------|------|
| `id` | uuid | PK | 🟡 |
| `stock_transfer_id` | uuid | FK→stock_transfers | 🟡 |
| `product_id` | uuid | FK→products | 🟡 |
| `quantity` | int | | 🟡 |

---

# مجموعة 5: الموردون والشراء (Procurement)

## `suppliers` — الموردون ✅
| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | ✅ |
| `company_id` | uuid | FK→companies | | ✅ |
| `name` | text | | | ✅ |
| `type` | text | | local / import | 🟡 |
| `phone` | text | | | ✅ |
| `balance` / `remaining` | numeric | | الرصيد المستحق | 🟡 |
| `is_archived` | bool | | | ✅ |

## `purchase_orders` — أوامر الشراء ✅
| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | ✅ |
| `company_id` | uuid | FK→companies | | ✅ |
| `supplier_id` | uuid | FK→suppliers | | ✅ |
| `po_number` | text | | PO-YYYY-NNN | ✅ |
| `total_amount` | numeric | | | ✅ |
| `paid_amount` | numeric | | | ✅ |
| `payment_status` | text | | غير مدفوع/مدفوع بالكامل (مشتق؟) | 🟡 |
| `receiving_status` | text | | لم يُستلم/جزئي/مستلم (مشتق؟) | ✅ |
| `created_at` | timestamptz | | | 🟡 |

## `po_items` — بنود أمر الشراء ✅
| الحقل | النوع | مفتاح | الثقة |
|------|------|-------|------|
| `id` | uuid | PK | ✅ |
| `purchase_order_id` | uuid | FK→purchase_orders | ✅ |
| `product_id` | uuid | FK→products | ✅ |
| `quantity` | int | | 🟡 |
| `cost` | numeric | | 🟡 |

## `po_payments` — مدفوعات أوامر الشراء ✅
| الحقل | النوع | مفتاح | الثقة |
|------|------|-------|------|
| `id` | uuid | PK | ✅ |
| `purchase_order_id` | uuid | FK→purchase_orders | ✅ |
| `company_id` | uuid | FK→companies | ✅ |
| `amount` | numeric | | ✅ |
| `payment_date` | date | | ✅ |

## `po_receiving_logs` — سجلات استلام أوامر الشراء ✅
| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | ✅ |
| `purchase_order_id` | uuid | FK→purchase_orders | | ✅ |
| `inventory_id` | uuid | FK→inventories | المستودع المستهدف | ⚪ |
| `quantity` | int | | الكمية المستلمة | 🟡 |
| `received_at` | timestamptz | | | 🟡 |

**أثر (🟡):** الاستلام يزيد `inventory_stock.on_hand`.

---

# مجموعة 6: الماليات والمحاسبة (Finance)

## `expenses` — المصروفات ✅
| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | ✅ |
| `company_id` | uuid | FK→companies | | ✅ |
| `amount` | numeric | | | ✅ |
| `category` | text | | الرواتب/الصيانة/المواد/الأصول/إعلانات/أخرى | ✅ |
| `notes` | text | | | ✅ |
| `expense_date` | date | | | ✅ |

## `month_closes` — الإقفالات الشهرية ✅
| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | 🟡 |
| `company_id` | uuid | FK→companies | | ✅ |
| `month` | date | | الشهر المقفل | ✅ |
| `status` | text | | closed | ✅ |
| `closing_capital` | numeric | | رأس المال الختامي | ✅ |

**UQ مرجّح:** `(company_id, month)`.

## `capital_log` — سجل رأس المال ✅
| الحقل | النوع | مفتاح | الثقة |
|------|------|-------|------|
| `id` | uuid | PK | 🟡 |
| `company_id` | uuid | FK→companies | ✅ |
| `amount` | numeric | | ✅ |
| `log_date` | date | | ✅ |

---

# مجموعة 7: الشحن (Shipping)

## `shipping_offices` — مكاتب الشحن ✅
| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | ✅ |
| `company_id` | uuid | FK→companies | | ✅ |
| `name` | text | | | ✅ |
| `printed_name` | text | | يظهر على البوليصة | ✅ |

## `shipping_zones` — مناطق الشحن 🟡
| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | 🟡 |
| `company_id` | uuid | FK→companies | | 🟡 |
| `governorate` / `region` | text | | المحافظة/المنطقة | 🟡 |
| `price` | numeric | | سعر الشحن | 🟡 |

## `carrier_connections` / `shipping_integrations` — ربط شركات الشحن 🟡
| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | 🟡 |
| `company_id` | uuid | FK→companies | | 🟡 |
| `carrier` | text | | Bosta/QPExpress/… | 🟡 |
| `credentials` | jsonb/text | | مفاتيح API (مشفّرة) | ⚪ |
| `is_connected` | bool | | | 🟡 |

## `shipments` — الشحنات 🟡
| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | 🟡 |
| `order_id` | uuid | FK→orders | | 🟡 |
| `carrier` | text | | شركة الشحن | 🟡 |
| `tracking_number` | text | | رقم التتبع | 🟡 |
| `status` | text | | حالة الشحنة | 🟡 |
| `cod_amount` | numeric | | مبلغ التحصيل | 🟡 |
| `label_url` | text | | رابط البوليصة | 🟡 |

## `shipping_settlements` — تسويات الشحن 🟡
**الغرض:** تسوية COD المحصّل عبر شركات الشحن مقابل المستلم فعليًا (مقابل الشاشة المعطوبة).
| الحقل | النوع | مفتاح | الثقة |
|------|------|-------|------|
| `id` | uuid | PK | 🟡 |
| `company_id` | uuid | FK→companies | 🟡 |
| `carrier` | text | | 🟡 |
| `expected_amount` / `received_amount` | numeric | | 🟡 |
| `fees` | numeric | | 🟡 |
| `settled_at` | timestamptz | | 🟡 |

---

# مجموعة 8: الإشعارات والاشتراكات (System)

## `notifications` — الإشعارات ✅
| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `id` | uuid | PK | | ✅ |
| `user_id` | uuid | FK→profiles | المستلم | ✅ |
| `type` | text | | نوع الإشعار | 🟡 |
| `payload` | jsonb | | بيانات الإشعار | 🟡 |
| `read` | bool | | مقروء | 🟡 |
| `created_at` | timestamptz | IX | يُرتّب تنازليًا (limit=50) | ✅ |

## `whatsapp_templates` — قوالب واتساب 🟡
| الحقل | النوع | مفتاح | الثقة |
|------|------|-------|------|
| `id` | uuid | PK | 🟡 |
| `company_id` | uuid | FK→companies | 🟡 |
| `name` | text | | 🟡 |
| `body` | text | | 🟡 |

## `subscriptions` / `plans` — الاشتراكات والخطط 🟡
| الحقل | النوع | مفتاح | ملاحظات | الثقة |
|------|------|-------|---------|------|
| `subscriptions.id` | uuid | PK | | 🟡 |
| `subscriptions.company_id` | uuid | FK→companies | | 🟡 |
| `subscriptions.plan_id` | uuid | FK→plans | | 🟡 |
| `subscriptions.expires_at` | timestamptz | | تاريخ الانتهاء | 🟡 |
| `plans.name` | text | | الاحترافي/… | 🟡 |
| `plans.features` | jsonb | | الميزات (↔ company_features) | ⚪ |

---

# القيم الثابتة (Enumerations)

> مرجع موحّد؛ الدلالات الكاملة في `18_Business_Logic.md`.

## `order_status` — حالات الطلب (12) ✅
`جديد` · `جاري التأكيد` · `قيد المعالجة` · `ناقص` · `جاهز` · `تم الشحن` · `تم التسليم` · `مكتمل` · `مؤجل` · `ملغي` · `مرتجع` · `مستبدل`.

## `payment_status` — حالة الدفع ✅
`غير مدفوع` · `مدفوع جزئياً` · `مدفوع مسبقاً` · `مدفوع بالكامل`.

## `follow_up_status` — حالة المتابعة 🟡
`قيد الانتظار` (+ قيم أخرى غير مرصودة).

## `expense_category` — فئات المصروفات ✅
`الرواتب` · `الصيانة` · `المواد` · `الأصول` · `إعلانات` · `أخرى`.

## `po_receiving_status` — حالة استلام أمر الشراء ✅
`لم يُستلم` · `جزئي` · `مستلم بالكامل`.

## `po_payment_status` — حالة دفع أمر الشراء ✅
`غير مدفوع` · `مدفوع بالكامل` (+ جزئي مرجّح 🟡).

## `supplier_type` — نوع المورد 🟡
`محلي` (+ `مستورد` مرجّح).

## `customer_type` — نوع العميل 🟡
`Regular` (+ أنواع أخرى مرجّحة).

## `reason_type` — نوع السبب ✅
`cancel` · `return`.

## `member_role` — أدوار الأعضاء (9) ✅
`مسؤول` · `مدير` · `موظف` · `موديريتور` · `كول سنتر` · `تجهيز` · `شحن` · `توصيل` · `مدير المستودع` (+ `محاسب` مرجّح 🟡).

> **ملاحظة تنفيذ (🟡):** غير محسوم إن كانت هذه enums حقيقية في Postgres أم حقول `text` بقيم محدّدة تطبيقيًا. الأرجح مزيج (بعضها enum، بعضها text).

---

# دوال قاعدة البيانات (RPC Functions)

## المؤكدة ✅
| الدالة | الغرض | الاستدعاء |
|-------|------|-----------|
| `get_company_members_with_profiles` | جلب الأعضاء مع بيانات ملفاتهم | `POST /rest/v1/rpc/...` |
| `get_order_status_counts` | عدّادات الطلبات لكل حالة | `POST /rest/v1/rpc/...` |
| `get_inventory_products` | المنتجات + المخزون + المباع للمستودع | `POST /rest/v1/rpc/...` |
| `get_analytics_summary` | كل مؤشرات التحليلات المجمّعة | `POST /rest/v1/rpc/...` |

## المرجّحة 🟡
| الدالة | الغرض | الثقة |
|-------|------|------|
| `close_month` | تنفيذ الإقفال الشهري (تحقق + كتابة + قفل) | 🟡 |
| `create_shipment` | إنشاء شحنة عبر شركة التوصيل (Edge Function غالبًا) | 🟡 |
| `smart_paste_parse` | تحليل نص اللصق الذكي لحقول طلب | 🟡 |
| `transfer_stock` | تنفيذ تحويل مخزون ذري | ⚪ |
| `receive_purchase_order` | تسجيل استلام + زيادة مخزون ذري | ⚪ |

---

# سياسات أمان الصفوف (RLS Policies) 🟡

> **مرجّحة 🟡** — لم تُرصد السياسات مباشرة، لكنها ضرورة معمارية (PostgREST مكشوف للعميل).

**النمط المتوقّع لكل جدول أعمال:**
1. **SELECT/INSERT/UPDATE/DELETE** مسموحة فقط إذا كان `company_id` ضمن شركات عضوية المستخدم (`company_members.user_id = auth.uid()`).
2. **الجداول الفرعية** (order_items, po_items…) تُؤمّن عبر الانضمام لجدولها الأب (`order_id → orders.company_id`).
3. **`profiles`/`notifications`** مؤمّنة بـ `user_id = auth.uid()`.
4. **قيود إضافية بالدور:** فلترة حالات الطلبات حسب دور العضو — مرجّح تُطبّق في RPC/العميل أكثر من RLS الخام ⚪.

**نقطة حرجة (⚪):** سلامة كل النظام الأمني تعتمد على اكتمال سياسات RLS؛ أي جدول بلا سياسة = تسريب بيانات المستأجرين.

---

# القيود والسلامة المرجعية (Constraints)

| القيد | الوصف | الثقة |
|------|-------|------|
| **FK cascade** | حذف طلب → حذف بنوده/تصنيفاته (مرجّح ON DELETE CASCADE للأبناء) | 🟡 |
| **منع حذف مرجعي** | حذف منتج/عميل مرتبط بطلبات → أرشفة لا حذف (denormalized names تحمي التاريخ) | 🟡 |
| **UQ** | `(company_id, phone)` للعملاء، `(company_id, sku)` للمنتجات، `(company_id, month)` للإقفال | 🟡 |
| **CHECK** | كميات/مبالغ ≥ 0، `on_hand ≥ 0` (إلا allow_oversell) | ⚪ |
| **افتراضي واحد** | `inventories.is_default` واحد لكل شركة (partial unique index) | ⚪ |

---

# البيانات المشتقّة مقابل المخزّنة (Derived vs Stored)

قرار تصميمي مهم لإعادة البناء — الحقول التالية **غير محسوم** إن كانت مخزّنة (للأداء) أم محسوبة (للدقة):

| الحقل | مرجّح | الثقة |
|------|-------|------|
| `customers.total_orders` / `total_revenue` | مخزّن (محدّث بـ Trigger) | 🟡 |
| `purchase_orders.payment_status` / `receiving_status` | محسوب من التجميعات | 🟡 |
| `orders.total` | مخزّن (subtotal + shipping − discount) | 🟡 |
| `inventory_stock.committed` | مخزّن (يُحدّث مع حالة الطلب) | 🟡 |
| مؤشرات التحليلات | محسوبة لحظيًا عبر RPC | ✅ |

---

# Performance Considerations (على مستوى البيانات)

- **الفهارس الحرجة:** `orders(company_id, status)`, `orders(company_id, created_at)`, `customers(company_id, phone)`, `products(company_id)`, `inventory_stock(inventory_id, product_id)`.
- **حدود الاستعلام:** `orders limit=1000`, `products limit=10000` — تشير لغياب ترقيم خادمي حقيقي (نقطة تحسين).
- **التجميعات عبر RPC** — تتطلب فهارس جيدة على `created_at`/`status` لأداء التحليلات.
- **jsonb** (notifications.payload، credentials) — يحتاج فهارس GIN إن استُعلم عن محتواه ⚪.

---

# Security Considerations (على مستوى البيانات)

- **RLS إلزامي على كل جدول** يحمل `company_id`.
- **بيانات حساسة:** PII للعملاء (هواتف/عناوين)، مفاتيح شركات الشحن (credentials)، بيانات مالية → تشفير/تقييد.
- **`created_by` مفقود** في عدة جداول (مالية/مخزون) → فجوة تدقيق ⚪.
- **حذف صلب خطير** على الجداول المرجعية → تفضيل الأرشفة (`is_archived`).

---

# Reverse Engineering Notes

- **26 جدولًا مؤكدة ✅** ظهرت أسماؤها في مسارات `/rest/v1/<table>` أو استعلامات `select`.
- **الأعمدة المؤكدة** ظهرت في `select`/الواجهة؛ الأنواع **مرجّحة 🟡** (نرى القيم لا DDL).
- **الجداول المرجّحة 🟡** (shipments/shipping_zones/carrier_connections/shipping_settlements/order_comments/activity_log/subscriptions/stock_transfer_items/whatsapp_templates) مستنتجة من الوظائف المرصودة دون رصد الجدول مباشرة.
- **RLS والقيود والفهارس** كلها **مرجّحة/تخمين** — لم نرَ DDL؛ مستنتجة من السلوك والضرورة المعمارية.
- **الحقول المشتقّة** (total_orders، حالات PO) قرار تصميمي غير مرصود آليًا.

---

# Confidence Level

| الجانب | الثقة |
|-------|------|
| أسماء الجداول الـ26 المؤكدة | ✅ مؤكد |
| الأعمدة المرصودة في select/الواجهة | ✅ مؤكد |
| أنواع البيانات الدقيقة | 🟡 مرجّح |
| المفاتيح الأجنبية الأساسية | ✅/🟡 حسب الحقل |
| الجداول المرجّحة الثمانية | 🟡 مرجّح |
| الفهارس والقيود | 🟡/⚪ |
| سياسات RLS | 🟡 مرجّح (ضرورة معمارية) |
| الحقول المشتقّة مقابل المخزّنة | 🟡 مرجّح |
| Enums (قيمها) | ✅ / (كونها enum حقيقي) 🟡 |
| دوال RPC المؤكدة الأربع | ✅ مؤكد |

---

READY FOR NEXT FILE

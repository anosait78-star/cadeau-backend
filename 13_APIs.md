# 13 — APIs
## توثيق واجهات برمجة التطبيقات الكامل لنظام OrdersFlow (API Reference)

> **حالة الوثيقة:** مرجع رسمي معتمد (Authoritative Reference)
> **نطاق هذا الملف:** التوثيق الشامل لكل واجهات النظام — PostgREST (CRUD)، دوال RPC، Edge Functions، Auth، Webhooks، بروتوكول الفلاتر، المصادقة، ومعالجة الأخطاء.
> **الطبقة:** Supabase (PostgREST + GoTrue + Edge Functions) — مكشوفة للعميل مباشرة.
> **تصنيف الثقة:** ✅ مؤكد · 🟡 مرجّح · ⚪ تخمين
> **هذا الملف مستقل بذاته** — يُقرأ دون الرجوع لأي ملف آخر.
> **مرجع مكمّل:** الجداول في `11_Database.md`، العلاقات في `12_ERD.md`.

---

# Overview

OrdersFlow **لا يملك طبقة API مخصّصة (Custom REST API)** بالمعنى التقليدي. بدلًا من ذلك، يعتمد على **PostgREST** الذي يحوّل جداول PostgreSQL تلقائيًا إلى REST API، مع **دوال RPC** لمنطق الأعمال المعقّد و**Edge Functions** للتكاملات الخارجية.

**أنماط الواجهات الأربعة:**

| النمط | المسار | الاستخدام | الثقة |
|------|--------|-----------|------|
| **PostgREST CRUD** | `/rest/v1/<table>` | قراءة/كتابة الجداول مباشرة | ✅ |
| **RPC** | `/rest/v1/rpc/<function>` | تجميعات + منطق معقّد | ✅ |
| **Auth (GoTrue)** | `/auth/v1/<action>` | المصادقة | ✅ |
| **Edge Functions** | `/functions/v1/<name>` | تكاملات (شحن) + Webhooks | 🟡 |

**الأساس (URL):** `https://<project>.supabase.co` حيث `<project> = gvvzqqcukynhapdgvcmj` ✅.

---

# المصادقة والتفويض (Authentication)

## آلية المصادقة ✅
- **Supabase Auth (GoTrue)** بتوكن **JWT**.
- التوكن مخزّن في localStorage بمفتاح `sb-gvvzqqcukynhapdgvcmj-auth-token` ✅.
- يُرفق في كل طلب: `Authorization: Bearer <access_token>`.
- مفتاح عام (`apikey: <anon_key>`) يُرفق أيضًا (نمط Supabase).

## نقاط Auth ✅/🟡
| الغرض | الطلب | الثقة |
|------|-------|------|
| تسجيل الدخول | `POST /auth/v1/token?grant_type=password` | ✅ |
| تحديث التوكن | `POST /auth/v1/token?grant_type=refresh_token` | 🟡 |
| تسجيل الخروج | `POST /auth/v1/logout` | 🟡 |
| تغيير كلمة المرور | `PUT /auth/v1/user` | 🟡 |
| حذف الحساب | عبر GoTrue/RPC (طلب حذف) | 🟡 |

## التفويض (Authorization) 🟡
- **RLS في Postgres** هو خط الدفاع — لا طبقة تفويض في التطبيق.
- كل طلب PostgREST يخضع لسياسات RLS حسب `auth.uid()` وعضوية `company_members`.
- **نقطة حرجة (⚪):** لا توجد بوابة API وسيطة؛ الأمان كله على القاعدة.

---

# بروتوكول PostgREST (نمط الاستعلام)

## العمليات القياسية ✅
| العملية | HTTP | المسار | الدلالة |
|--------|------|--------|---------|
| قراءة | GET | `/rest/v1/<table>?<filters>` | جلب صفوف |
| إنشاء | POST | `/rest/v1/<table>` | إدراج صف/صفوف |
| تحديث | PATCH | `/rest/v1/<table>?<filter>` | تعديل صفوف مطابقة |
| حذف | DELETE | `/rest/v1/<table>?<filter>` | حذف صفوف مطابقة |

## معاملات الفلترة (Filter Operators) ✅
| العامل | الدلالة | مثال |
|-------|---------|------|
| `eq` | يساوي | `company_id=eq.<uuid>` |
| `neq` | لا يساوي | `status=neq.ملغي` |
| `gt/gte` | أكبر/أكبر أو يساوي | `created_at=gte.2026-07-01` |
| `lt/lte` | أصغر/أصغر أو يساوي | `total=lte.1000` |
| `in` | ضمن قائمة | `status=in.(جديد,جاهز)` |
| `not.in` | ليس ضمن | `status=not.in.(ملغي)` |
| `is` | يساوي NULL/bool | `parent_product_id=is.null` |
| `not.is` | لا يساوي | `parent_product_id=not.is.null` |
| `ilike` | بحث نصّي (غير حساس) | `name=ilike.*عطر*` |
| `or` | شرط بديل | `or=(name.ilike.*x*,phone.ilike.*x*)` |

## معاملات التحكم ✅
| المعامل | الدلالة | مثال |
|--------|---------|------|
| `select` | الأعمدة + الربط المضمّن | `select=*,order_items(*)` |
| `order` | الترتيب | `order=created_at.desc` |
| `limit` | الحد الأقصى | `limit=1000` |
| `offset` | الإزاحة (ترقيم) | `offset=20` |

## الربط المضمّن (Embedded Resources) ✅
PostgREST يجلب الجداول المرتبطة في استجابة واحدة:
```
select=*,order_items(*),order_label_assignments(order_labels(*)),whatsapp_confirmations(*)
```
- ربط باسم مخصّص + مفتاح صريح: `from_inventory:inventories!from_inventory_id(name)`.

---

# واجهات وحدة الطلبات (Orders) ✅

## جلب قائمة الطلبات ✅ (مؤكد من الشبكة)
```
GET /rest/v1/orders
  ?select=*,order_items(*),order_label_assignments(order_labels(*)),whatsapp_confirmations(*)
  &company_id=eq.<uuid>
  &status=eq.<status>
  &created_at=gte.<date>&created_at=lte.<date>
  &assigned_to=eq.<member_id>       (اختياري)
  &order=created_at.desc
  &limit=1000&offset=<n>
```

## عدّادات الحالة ✅
```
POST /rest/v1/rpc/get_order_status_counts
Body: { company_id, date_from, date_to, ... }
→ { "جديد": N, "جاهز": M, ... }
```

## عمليات الطلب ✅/🟡
| الغرض | الطلب | الثقة |
|------|-------|------|
| إنشاء طلب | `POST /rest/v1/orders` | ✅ |
| إنشاء بنود | `POST /rest/v1/order_items` (دفعة) | ✅ |
| تعديل طلب | `PATCH /rest/v1/orders?id=eq.<uuid>` | ✅ |
| تغيير حالة | `PATCH /rest/v1/orders?id=eq.<uuid>` Body: `{ status }` | ✅ |
| إسناد | `PATCH /rest/v1/orders?id=eq.<uuid>` Body: `{ assigned_to }` | ✅ |
| حذف طلب | `DELETE /rest/v1/orders?id=eq.<uuid>` | 🟡 |
| ربط تصنيف | `POST /rest/v1/order_label_assignments` | ✅ |
| إزالة تصنيف | `DELETE /rest/v1/order_label_assignments?order_id=eq.&label_id=eq.` | ✅ |
| إضافة تعليق | `POST /rest/v1/order_comments` | 🟡 |
| اللصق الذكي | `POST /rest/v1/rpc/smart_paste_parse` Body: `{ text }` | 🟡 |

## الجداول المساندة ✅
```
GET /rest/v1/order_labels?company_id=eq.<uuid>
GET /rest/v1/order_reasons?company_id=eq.<uuid>&type=eq.cancel
GET /rest/v1/whatsapp_confirmations?order_id=eq.<uuid>
```

---

# واجهات وحدة العملاء (Customers) ✅

```
GET /rest/v1/customers
  ?company_id=eq.<uuid>
  &type=eq.<type>&status=eq.<status>
  &total_revenue=gte.<min>&total_revenue=lte.<max>
  &order=<field>&limit=10&offset=<n>

GET /rest/v1/customers?id=eq.<uuid>                    (تفاصيل)
GET /rest/v1/orders?customer_id=eq.<uuid>              (سجل طلبات العميل) 🟡
PATCH /rest/v1/customers?id=eq.<uuid>                  (تعديل)
DELETE /rest/v1/customers?id=eq.<uuid>                 (حذف) 🟡
```
**البحث:** `or=(name.ilike.*q*,phone.ilike.*q*,social_username.ilike.*q*)` 🟡.

---

# واجهات المنتجات والمخزون (Inventory) ✅

```
POST /rest/v1/rpc/get_inventory_products
  Body: { company_id, inventory_id }
  → منتجات + on_hand + committed + مباع + حالة

GET /rest/v1/products?company_id=eq.<uuid>&parent_product_id=not.is.null   (المتغيرات) ✅
GET /rest/v1/products?company_id=eq.<uuid>&limit=10000                     (تحميل ضخم) ✅
GET /rest/v1/inventory_stock?select=*,on_hand,committed,products(...)      ✅
POST /rest/v1/products                                                     (إضافة) 🟡
PATCH /rest/v1/products?id=eq.<uuid>                                       (تعديل) 🟡
DELETE /rest/v1/products?id=eq.<uuid>                                      (حذف) 🟡
```
**رفع الصور:** Supabase Storage (`/storage/v1/object/...`) 🟡.

---

# واجهات المستودعات (Warehouses) ✅

```
GET /rest/v1/inventories?select=*,inventory_stock(id)&company_id=eq.<uuid>   ✅

GET /rest/v1/stock_transfers
  ?select=*,from_inventory:inventories!from_inventory_id(name),
           to_inventory:inventories!to_inventory_id(name)
  &company_id=eq.<uuid>&order=created_at.desc                                 ✅

POST /rest/v1/inventories                        (إضافة مستودع) 🟡
PATCH /rest/v1/inventories?id=eq.<uuid>          (تعديل/أرشفة/افتراضي) 🟡
POST /rest/v1/rpc/transfer_stock                 (تحويل ذري) ⚪
```

---

# واجهات الماليات (Finance) ✅

```
GET /rest/v1/suppliers?company_id=eq.<uuid>&is_archived=eq.false             ✅

GET /rest/v1/purchase_orders
  ?select=*,suppliers(name),po_items(*,products(name)),po_payments(*),po_receiving_logs(*)
  &company_id=eq.<uuid>                                                        ✅

GET /rest/v1/expenses?company_id=eq.<uuid>&expense_date=gte.&category=eq.      ✅
GET /rest/v1/month_closes?company_id=eq.<uuid>&order=month.desc                ✅
GET /rest/v1/capital_log?company_id=eq.<uuid>                                  ✅

POST /rest/v1/expenses                           (إضافة مصروف) ✅
POST /rest/v1/po_payments                        (تسجيل دفعة) ✅
POST /rest/v1/po_receiving_logs                  (تسجيل استلام → يزيد المخزون) ✅
POST /rest/v1/rpc/close_month                    (إقفال الشهر) 🟡
```

---

# واجهات الفريق والشركة ✅

```
GET /rest/v1/company_members?select=company_id,role,status&company_id=eq.<uuid>   ✅
POST /rest/v1/rpc/get_company_members_with_profiles   Body: { company_id }         ✅
GET /rest/v1/companies?id=eq.<uuid>                                                ✅
GET /rest/v1/company_features?company_id=eq.<uuid>                                 ✅
GET /rest/v1/profiles?id=eq.<uuid>                                                 ✅
PATCH /rest/v1/company_members?id=eq.<uuid>    (تغيير دور/إزالة) 🟡
POST /rest/v1/companies                        (إنشاء شركة) 🟡
```

---

# واجهات الإشعارات والإعدادات ✅/🟡

```
GET /rest/v1/notifications?user_id=eq.<uuid>&order=created_at.desc&limit=50        ✅
GET /rest/v1/shipping_offices?company_id=eq.<uuid>                                 ✅
GET /rest/v1/shipping_zones?company_id=eq.<uuid>                                   🟡
GET /rest/v1/carrier_connections?company_id=eq.<uuid>                              🟡
POST /rest/v1/order_reasons                    (إضافة سبب) ✅
PATCH /rest/v1/companies?id=eq.<uuid>          (تغيير لغة/إعدادات) 🟡
```

---

# دوال RPC (تفصيل)

## المؤكدة ✅

### `get_order_status_counts`
- **الغرض:** عدّ الطلبات لكل حالة (لتبويبات الطلبات ولوحة التحكم).
- **الإدخال:** `company_id` + فلاتر (تاريخ/مُسنَد) 🟡.
- **الإخراج:** خريطة (حالة → عدد).
- **لماذا RPC:** تجنّب سحب كل الطلبات للعدّ على العميل.

### `get_inventory_products`
- **الغرض:** منتجات مستودع + مخزونها + المباع.
- **الإدخال:** `company_id`, `inventory_id`.
- **الإخراج:** قائمة مجمّعة (منتج + on_hand + committed + مباع + حالة).

### `get_company_members_with_profiles`
- **الغرض:** أعضاء الشركة مع بيانات ملفاتهم (اسم/أفاتار).
- **الإدخال:** `company_id`.
- **الإخراج:** قائمة أعضاء + أدوار + بيانات profile.

### `get_analytics_summary`
- **الغرض:** كل مؤشرات التحليلات (إيراد/محصّل/COGS/صافي/عملاء/مخزون/موظفين/P&L).
- **الإدخال:** `company_id`, `date_from`, `date_to`.
- **الإخراج:** بنية غنية بكل المؤشرات وبيانات الرسوم.

## المرجّحة 🟡
| الدالة | الغرض | الإدخال المتوقّع | الثقة |
|-------|------|------------------|------|
| `close_month` | إقفال شهري (تحقق + كتابة + قفل) | company_id, month | 🟡 |
| `smart_paste_parse` | تحليل نص اللصق الذكي | text | 🟡 |
| `create_shipment` | إنشاء شحنة (Edge Function غالبًا) | order_id, carrier | 🟡 |
| `transfer_stock` | تحويل مخزون ذري | from, to, items | ⚪ |
| `receive_purchase_order` | استلام + زيادة مخزون ذري | po_id, items, inventory | ⚪ |

---

# Edge Functions والتكاملات 🟡

## إنشاء الشحنة ✅ (الوجود) / 🟡 (التفاصيل)
```
POST /functions/v1/create_shipment   (مرجّح)
  → يتصل بـ API شركة الشحن (Bosta...) بمفاتيح الشركة
  → يعيد tracking_number + label_url
```

## Webhooks الواردة (من شركات الشحن) ✅ (الوجود)
```
POST /functions/v1/shipping_webhook   (مرجّح)
  ← شركة الشحن ترسل تحديث حالة الشحنة
  → يحدّث shipments/orders.status
```
> مرصود من سجل نشاط الشحن ("Webhook"/"Create Shipment") في تبويب الشحن ✅.

## التتبّع الخارجي ✅
```
POST https://mpc-prod-*.run.app/events
  → أحداث الاستخدام (Google Cloud Run)
```

## واتساب 🟡
- مرجّح روابط `wa.me` (لا API رسمي) مع تعبئة القالب — لا نقطة API خادمية مؤكدة 🟡.

---

# نمط جلب البيانات عند فتح صفحة ✅

عند فتح أي شاشة، تُطلق **6–10 طلبات متوازية** تشمل:

```
[سياق مشترك — كل الصفحات]
  GET companies?id=eq.<current>
  GET company_members?company_id=eq.<current>
  GET company_features?company_id=eq.<current>
  GET notifications?user_id=eq.&limit=50
[بيانات الصفحة — حسب الشاشة]
  RPC/GET خاص بالشاشة (مثل get_order_status_counts + orders للطلبات)
  GET قوائم مساعدة (labels/reasons/inventories)
```

**نقطة تحسين (🟡):** السياق المشترك شبه ثابت → مرشّح للـ cache بدل إعادة الجلب كل تنقّل.

---

# Request Flow (نمط عام)

```
1. العميل يبني الطلب عبر Supabase JS Client
2. يُرفق: apikey + Authorization: Bearer <jwt>
3. PostgREST يستقبل → يطبّق RLS (auth.uid() + company_members)
4. Postgres ينفّذ (مع Triggers محتملة)
5. النتيجة JSON تعود مباشرة للعميل
```

# Response Flow (نمط عام)

```
- نجاح CRUD: 200/201 + الصف/الصفوف (أو 204 بلا محتوى)
- RPC: 200 + النتيجة المجمّعة
- الربط المضمّن: كائن متداخل (nested JSON) في استجابة واحدة
- Prefer header: return=representation لإعادة الصف المُنشأ
```

---

# رموز الحالة ومعالجة الأخطاء (Status & Errors) 🟡

| الرمز | الدلالة | الحالة |
|------|---------|-------|
| 200/201/204 | نجاح | ✅ |
| 400 | طلب خاطئ (فلتر/بيانات) | 🟡 |
| 401 | توكن غير صالح/منتهٍ → إعادة تسجيل دخول | ✅ |
| 403 | RLS منع العملية (خارج company_id) | 🟡 |
| 404 | مسار/صف غير موجود | 🟡 |
| 409 | تعارض (UQ مثل phone/sku مكرر) | 🟡 |
| 500 | خطأ خادمي (RPC/Trigger فشل) | 🟡 |

**بنية خطأ PostgREST:** `{ code, message, details, hint }` 🟡.

---

# Performance Considerations (على مستوى API)

- **حدود عالية بلا ترقيم:** `orders limit=1000`, `products limit=10000` — تحميل ثقيل.
- **الربط المضمّن العميق** (orders + 3 جداول) — قوي لكنه أثقل من استعلام مسطّح.
- **6–10 طلبات متوازية/صفحة** — بعضها متكرر (السياق) → cache.
- **RPC للتجميعات** — النمط الصحيح (يقلّل نقل البيانات).
- **بيانات شبه ثابتة** (features/reasons/labels/zones) تُجلب كل مرة → cache.

---

# Security Considerations (على مستوى API)

- **PostgREST مكشوف مباشرة للعميل** → RLS خط الدفاع الوحيد؛ أي جدول بلا سياسة = تسريب.
- **التوكن في localStorage** → عرضة لـ XSS نظريًا ⚪.
- **مفاتيح شركات الشحن** يجب ألا تُكشف للعميل → Edge Functions فقط.
- **Webhooks الواردة** يجب التحقق من توقيعها (signature) لمنع التزوير ⚪.
- **حدود الاستعلام العالية** قابلة للاستغلال (استنزاف موارد) → يجب حدود صارمة خادميًا 🟡.
- **الفلترة بالدور** (حالات الطلبات) يجب فرضها في RLS/RPC لا العميل 🟡.

---

# Edge Cases (على مستوى API)

| الحالة | السلوك | الثقة |
|-------|--------|------|
| توكن منتهٍ أثناء العمل | 401 → تحديث توكن/إعادة دخول | ✅ |
| طلب خارج company_id | RLS يرفض (403/صفوف فارغة) | 🟡 |
| إدراج ينتهك UQ | 409 | 🟡 |
| RPC بطيء على فترة ضخمة | timeout محتمل | 🟡 |
| كتابة نصف-مكتملة (order بلا items) | حاجة لمعاملة ذرية | 🟡 |

---

# Failure Scenarios (على مستوى API)

- **فشل RLS policy:** كشف بيانات عبر المستأجرين (كارثي) ⚪.
- **فشل Trigger مخزون:** كتابة بلا أثر جانبي (مخزون غير متسق) 🟡.
- **انقطاع Webhook الشحن:** حالات شحنات لا تُحدّث 🟡.
- **timeout على RPC ثقيل:** تحليلات لا تُحمّل 🟡.

---

# Logging & Audit (على مستوى API)

- **التتبّع الخارجي** (`/events`) يسجّل أحداث الاستخدام ✅.
- **PostgREST logs** على مستوى Supabase (غير مرصودة) ⚪.
- **غياب سجل تدقيق موحّد** على مستوى الـ API 🟡.

---

# Technical Notes

- **غياب طبقة API مخصّصة** قرار معماري محوري: سرعة تطوير مقابل نقل كل الأمان لـ RLS. أي إعادة بناء يجب أن تقرر: البقاء على PostgREST أم إضافة BFF (Backend-for-Frontend).
- **الربط المضمّن** ميزة PostgREST قوية تقلّل عدد الطلبات لكنها تكشف بنية العلاقات.
- **RPC هو المكان الصحيح لمنطق الأعمال الذري** (إقفال/تحويل/استلام) — يجب توسيعه في إعادة البناء.
- **حدود الاستعلام العالية** أكبر دين تقني في طبقة الـ API — يحتاج ترقيمًا حقيقيًا (keyset pagination).

---

# Reverse Engineering Notes

- **الاستعلامات المؤكدة ✅** (orders المُركّب، inventory_stock، stock_transfers بالربط المزدوج، purchase_orders المُركّب، suppliers، notifications) مرصودة مباشرة من طلبات الشبكة.
- **دوال RPC الأربع مؤكدة ✅** من مسارات `/rpc/`.
- **Edge Functions للشحن** مؤكدة الوجود (سجل النشاط) 🟡، مساراتها الدقيقة مرجّحة.
- **نقاط Auth** مؤكد بعضها (`/auth/v1/token`) 🟡 الباقي.
- **رموز الأخطاء وبنيتها** مرجّحة 🟡 (نمط PostgREST القياسي، لم تُرصد كلها).
- **مسارات الكتابة (POST/PATCH/DELETE)** مرجّحة 🟡 لبعض الجداول (رُصدت القراءة أكثر من الكتابة).

---

# Confidence Level

| الجانب | الثقة |
|-------|------|
| PostgREST كطبقة API + بروتوكول الفلاتر | ✅ مؤكد |
| استعلامات القراءة المُركّبة الرئيسية | ✅ مؤكد |
| دوال RPC الأربع المؤكدة | ✅ مؤكد |
| Auth عبر GoTrue (JWT) | ✅ مؤكد |
| Edge Functions للشحن + Webhooks (الوجود) | ✅ مؤكد |
| مسارات Edge/Webhook الدقيقة | 🟡 مرجّح |
| مسارات الكتابة لكل جدول | 🟡 مرجّح |
| RPC المرجّحة (close_month/smart_paste/create_shipment) | 🟡 مرجّح |
| رموز الأخطاء وبنيتها | 🟡 مرجّح |
| تفاصيل واتساب API | 🟡 مرجّح |

---

READY FOR NEXT FILE

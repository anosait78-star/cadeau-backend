<div dir="rtl">

# Cadeau CRM — خطة التنفيذ (Implementation Roadmap)

> **حالة الوثيقة:** خطة تنفيذ حيّة معتمدة (Living Execution Plan) — ليست ADR ولا من ملفات المعرفة المجمّدة (00–22).
> **الإصدار:** 1.2 · **التاريخ:** 28 يوليو 2026
> **تغييرات 1.2:** تقسيم M1.5 القديم إلى **M1.5 Backend Foundation** + **M1.6 Frontend Foundation** (ونقل ميزانية الأداء/الاختبار إلى **M1.7**) · اعتماد **Docker + Docker Volumes** لبيئة تطوير PostgreSQL · تثبيت كل GitHub Actions بـ **Commit SHA** والحاويات بـ **digest** (تصلّب سلسلة توريد — ADR‑001).
> **المصدر:** مشتقّة حصراً من `Cadeau_CRM_Master_Product_Plan.md` + `Cadeau_CRM_Engineering_Standards.md` + قاعدة المعرفة (00–22). لا تُضيف/تحذف أي ميزة، ولا تغيّر أي قرار معماري.
> **يحكمها:** ADR‑001 (Security First) · ADR‑002 (Dual UX) · ADR‑003 (Three‑Layer Access) · ADR‑004 (AI‑Out / Extensible).

---

## 1. المكدّس التقني المعتمد (Locked Stack Decisions)

قرارات نهائية معتمدة من مالك المنتج (تحسم ما تركته الوثائق مفتوحاً في §15.2/§17):

| الطبقة | القرار المعتمد | ملاحظة الأمان/المعمارية |
|---|---|---|
| **Frontend** | React + Vite + shadcn/Radix + Tailwind + TypeScript `strict` | ADR‑002: تجربتان مستقلتان فوق API موحّد |
| **BFF/API** | **NestJS (Node LTS)** + **REST + OpenAPI** (`/v1`) | Modular/DI/Event‑Driven أصيلة (ADR‑004)؛ API‑First لتطبيق Native لاحقاً |
| **ORM** | **Prisma ORM** | Parameterized حصراً (ADR‑001 — لا SQL نصي)؛ Migrations مُدارة |
| **قاعدة البيانات** | **PostgreSQL** (مُدار ذاتياً — **بلا Supabase/بلا خدمة خارجية**) · بيئة التطوير: **Docker + Docker Volumes** | عزل المستأجر في BFF أولاً + سياسات RLS ثانية عبر `SET LOCAL app.company_id` |
| **المصادقة والصلاحيات** | **JWT مبني ذاتياً بالكامل** — **بلا أي خدمة خارجية لإدارة المستخدمين/الصلاحيات** | Auth + 2FA + جلسات + الوصول الثلاثي كلها داخل النظام |
| **أدوات ثانوية** | pnpm · Turborepo · Vitest · Playwright | افتراضات آمنة/بسيطة قابلة للمراجعة |

**أثر إلغاء Supabase على العزل (ADR‑001):**
- الطبقة 1 (الأساسية): كل استعلام Prisma يمرّ عبر طبقة Repository تفرض `company_id` إجبارياً — لا استعلام بلا نطاق مستأجر.
- الطبقة 2 (الدفاع الثاني): سياسات Postgres RLS مفعّلة، والسياق يُضبط لكل معاملة بـ `SET LOCAL app.company_id = $tenant` عبر Prisma middleware/transaction.
- امتياز Super Admin (المنصّة) منفصل تماماً في التوكن والكود عن أدوار المستأجر.

---

## 2. الاستراتيجيات المستعرضة الإلزامية (Cross‑Cutting — من EPIC‑1)

### 2.1 استراتيجية الهجرة (Migration Strategy)
- **Prisma Migrate** مصدر وحيد لتغييرات المخطط؛ ملفات SQL مُصدَّرة ومراجَعة في الريبو.
- **Prod = forward‑only** عبر `prisma migrate deploy` (لا `migrate dev` في الإنتاج).
- **نمط Expand → Migrate → Contract** لتغييرات بلا توقّف (إضافة عمود → ترحيل → إزالة القديم في migration لاحق).
- كل migration مرفق بوصف الأثر + خطة تراجع، ويمرّ ببوابة مراجعة أمنية إن مسّ بيانات حساسة.

### 2.2 استراتيجية البذر (Seed Strategy)
- **بذرة نظام (System Seed) — إنتاجية:** بيانات مرجعية إلزامية فقط: Feature Catalog keys · plans/plan_features · permission_templates · currencies · country_configs · governorates/zones · order_labels/reasons الافتراضية · Flag `AI=OFF`. **حتمية، idempotent، جزء من النظام (ليست Fake Data).**
- **بذرة تطوير (Dev Seed) — معزولة:** بيانات تجريبية للتطوير/الاختبار **فقط في Dev/Staging**، ممنوعة منعاً باتاً في الإنتاج، ومفصولة في ملفات مستقلة (تلتزم بقاعدة "لا Fake Data في الكود النهائي").

### 2.3 استراتيجية التراجع (Rollback Strategy)
- **قاعدة البيانات:** نسخ احتياطي آلي + PITR؛ لكل migration إجراء تراجع موثّق؛ الاعتماد على Expand/Contract يجعل الرجوع آمناً.
- **التطبيق:** نشر بصور محتوّاة (Docker) — الرجوع = إعادة النشر للإصدار السابق.
- **الميزات:** Feature Flags تسمح بإيقاف ميزة فوراً دون نشر (Rollback ناعم) + Canary قبل التعميم.
- **Runbook تراجع** موثّق لكل إصدار قبل النشر (جزء من Pre‑Deployment Checklist).

### 2.4 ميزانية الأداء الحقيقية (Performance Budget — لا Placeholder)
مفروضة في CI منذ EPIC‑1 بأرقام فعلية (مشتقّة من §26):

| المقياس | الميزانية |
|---|---|
| تحميل الشاشة (P95) | **< 2000ms** |
| حزمة JS الأولية لكل مسار (gzip) | **≤ 200KB** (Code‑splitting إلزامي) |
| LCP | **< 2.5s** · CLS < 0.1 · TBT < 200ms |
| Lighthouse Performance | **≥ 90** (Lighthouse CI بوابة) |
| زمن استجابة API خادمي (P95) — قراءة | **< 300ms** |
| زمن استجابة API خادمي (P95) — كتابة | **< 500ms** |
| اختبار حِمل المسارات الحرجة | عتبات k6 تمنع الدمج عند التجاوز |

> الأرقام قابلة للتشديد لاحقاً لا التخفيف؛ أي تجاوز يحجب الدمج.

### 2.5 بوابة الجودة الإلزامية بعد كل Epic (Quality Gate)
لا يبدأ Epic جديد قبل نجاح **كل** البنود للـEpic الحالي:

1. **Security Review** — Checklist الأمان (§6 معايير الهندسة) + اختبار تجاوز صلاحيات عبر API مباشر.
2. **Architecture Review** — التزام Clean/SOLID/Modular/Event‑Driven + حدود Bounded Context + الوصول الثلاثي.
3. **Code Review** — موافقة مراجع + مطابقة معايير الكود (§3) + لا TODO/Placeholder/Mock/دوال فارغة.
4. **Testing** — وحدة/تكامل/E2E؛ تغطية المسارات الحرجة ≥ 80%؛ اختبار فشل الذرية (Rollback).
5. **Performance** — كل ميزانيات §2.4 خضراء.
6. **Approval** — موافقة صريحة من مالك المنتج للانتقال.

### 2.6 سير العمل داخل كل Epic (Intra‑Epic Workflow) — لا تطوير متوازٍ
```
Backend  →  Testing  →  API Review  →  Frontend  →  UI Testing
```
- الواجهة لا تبدأ قبل استقرار الـBackend ومراجعة عقد الـAPI (OpenAPI).
- UI Testing يشمل مسار **Desktop** ومسار **Mobile** مستقلين (ADR‑002).

---

## 3. نظرة عامة على الـ Epics وترتيب التنفيذ

**الموجة A — الأساس الآمن القابل للتمديد (Phase 1 / M0–M1):**

| Epic | العنوان | يعتمد على | يطبّق |
|---|---|---|---|
| **EPIC‑1** | تأسيس المشروع + بوابات CI الأمنية + استراتيجيات (Migration/Seed/Rollback) + ميزانية أداء حقيقية | — | ADR‑001 |
| **EPIC‑2** | نظام التصميم + الثيم المزدوج + القشرة المزدوجة (Dual Shell) | E1 | ADR‑002 |
| **EPIC‑3** | نموذج البيانات الأساسي (Prisma) + طبقة الأمان المعماري (RLS ثانية/Audit/الذرية/keyset) | E1 | ADR‑001 |
| **EPIC‑4** | المصادقة JWT + 2FA + تعدد المستأجرين (بلا خدمة خارجية) | E3 | ADR‑001 |
| **EPIC‑5** | محرّك الوصول الثلاثي + Feature Catalog + لوحة Super Admin | E4 | ADR‑003 |
| **EPIC‑6** | النواة المعمارية (Event Bus + Plugin + Extension Points + Flag AI=OFF) | E3 | ADR‑004 |

**الموجة B — النواة الوظيفية (Phase 2أ / M2) — بالترتيب المعتمد:**

| Epic | العنوان | يعتمد على |
|---|---|---|
| **EPIC‑7** | **Master Data** (عملات/دول/محافظات/مناطق/تصنيفات/أسباب/وحدات — بيانات مرجعية) | E5, E6 |
| **EPIC‑8** | **Products** (كتالوج + متغيرات `parent_product_id` + COGS/تكلفة متوسّطة) | E7 |
| **EPIC‑9** | **Inventory & Warehouses** (مخزون لكل مستودع + حجز/تحرير/تحويل ذري) | E8 |
| **EPIC‑10** | **Customers** (منع تكرار E.164 + ملف تفصيلي + KPIs) | E7 |
| **EPIC‑11** | **Orders** (12 حالة + لصق ذكي حتمي + عرض مزدوج + سجل نشاط) | E8, E9, E10 |
| **EPIC‑12** | **Shipping** (طبقة تجريد النواقل + شحن جملة + Webhooks موثوقة) | E11 |

**الموجة C — الماليات والامتثال والتحليلات (Phase 2ب / M3):**

| Epic | العنوان | يعتمد على |
|---|---|---|
| **EPIC‑13** | الماليات (موردون/PO + مصروفات + فواتير + ضرائب + استرداد + تسوية شحن + إقفال شهري + P&L) | E11, E9, E12 |
| **EPIC‑14** | التحليلات والتقارير (5 محاور + نسب محسوبة فعلياً + تصدير مقيّد) | E7–E13 |
| **EPIC‑15** | الإشعارات (مركز + Web Push + إشعار العميل + تفضيلات) | E6 + الوحدات |

**الموجة D — بوابة الإطلاق (M4):**

| Epic | العنوان | يعتمد على |
|---|---|---|
| **EPIC‑16** | صقل v1.0 (Empty/Loading/Error + توطين كامل + أداء P95<2ث + WCAG AA + اختبار اختراق + Security Checklist + بوابات الإطلاق §31) | E1–E15 |

**مخطط الاعتماديات:**
```
E1 ─┬─ E2 ───────────────────────────────────────────────┐
    ├─ E3 ─┬─ E4 ─ E5 ─┬──────────────────────────────────┤
    │      └─ E6 ───────┤                                  │
    │                   ├─ E7 ─┬─ E8 ─ E9 ─┐               │
    │                   │      └─ E10 ──────┼─ E11 ─ E12 ─ E13 ─ E14 ─ E15 ─ E16
```

> الإصدارات v1.1 (تمكين) / v1.2 (تمايز) / v2.0 (ريادة) موثّقة في §31.2 من الخطة الرئيسية، وتبقى **خارج نطاق v1.0**. كل ميزات `[AI — خلف Flag AI]` مؤجّلة (ADR‑004). تُحوّل إلى Epics عند الوصول إليها.

---

## 4. تفصيل EPIC‑1 — تأسيس المشروع وبوابات الأمان

> **الهدف:** بنية Production‑Ready (Monorepo، TS strict، Feature‑based + Modular) مع بوابات CI الأمنية (ADR‑001) + استراتيجيات Migration/Seed/Rollback + ميزانية أداء حقيقية — عاملة قبل أي ميزة.
> **معيار القبول:** التطبيق يقلع فارغاً · كل بوابات CI خضراء · migration+seed أساسي يعمل · rollback موثّق · ميزانية أداء مفروضة.

| Milestone | المهام (Tasks) | مخرج قابل للاختبار |
|---|---|---|
| **M1.1 — هيكل المستودع** | Git + `main` محمي؛ Monorepo (`apps/web`, `apps/bff`, `packages/shared`, `packages/config`, `prisma/`)؛ TS `strict`؛ ESLint/Prettier؛ Conventional Commits + commitlint/Husky. | بناء فارغ ناجح + lint أخضر |
| **M1.2 — بوابات CI الأمنية (ADR‑001)** | Pipeline: Lint→Type‑check→Unit→SCA→SAST→Secret‑Scanning→Dependency‑Audit؛ سياسة Stable‑only + استبعاد Critical/High؛ Lockfiles مثبّتة. | PR تجريبي يُحجب عند سرّ/ثغرة |
| **M1.3 — بيئات وأسرار** | Dev/Staging/Prod معزولة؛ أسرار عبر Env/Secrets Manager فقط؛ `.env.example` بلا أسرار + تحقّق Schema صارم عند الإقلاع. | Secret Scanning يمنع دمج سرّ · الإقلاع بلا env مطلوب يفشل بوضوح |
| **M1.4 — قاعدة البيانات والاستراتيجيات** | **PostgreSQL عبر Docker Compose + Docker Volumes** (بيئة تطوير)؛ Prisma؛ **Migration** (`migrate deploy`, Expand/Contract)؛ **System Seed** idempotent + **Dev Seed** معزول؛ **Rollback Runbook**. | حاوية Postgres تعمل بـ Volume · migrate+seed يعمل · rollback مُختبَر |
| **M1.5 — Backend Foundation (NestJS)** | NestJS Modular (Bounded Contexts) + **Config** (بـ Schema) + **Logging** منظّم + **Validation** (global pipe) + **Exception Handling** (صيغة خطأ موحّدة) + **Health Check** + **OpenAPI** (`/v1`). | `GET /v1/health` سليم · OpenAPI يُولَّد · خطأ موحّد |
| **M1.6 — Frontend Foundation (React + Vite)** | React + Vite + **Design System** (رموز/مكوّنات أساسية) + **Routing** + **Theme** (فاتح/داكن) + **RTL/LTR** (`start/end`) + **Layout** أساسي + حالات **Empty/Loading/Error** قياسية + i18n scaffolding. | SPA تقلع · تبديل ثيم/اتجاه يعمل · الحالات القياسية معروضة |
| **M1.7 — ميزانية الأداء والاختبار** | Vitest/Playwright؛ **Performance Budget حقيقي** (§2.4) في CI: bundle‑size + Lighthouse CI + k6؛ README لكل حزمة + قالب ADR. | ميزانيات §2.4 خضراء + اختبار "smoke" يمرّ |

> **حدّ EPIC‑1 مقابل EPIC‑2 (ADR‑002):** M1.6 يبني **الأساس المشترك** (رموز التصميم/الثيم/RTL/تخطيط أساسي واحد/حالات قياسية). أما **EPIC‑2** فيبني فوقه **القشرتين المستقلتين** كتجربتين منفصلتين: Desktop (Sidebar+Topbar+Cmd‑K) وMobile (Bottom Nav+FAB+Bottom Sheets) — لا تكرار.

**DoD لـ EPIC‑1:** بوابات CI الأمنية خضراء · Stable‑only مفروضة · صفر أسرار · هيكل Modular + `/v1` + خطأ موحّد · Backend Foundation + Frontend Foundation يعملان · Migration/Seed/Rollback عاملة وموثّقة · ميزانية أداء حقيقية مفروضة · بيئات معزولة · التطبيق يقلع.
**بعده: بوابة الجودة (§2.5) كاملة قبل EPIC‑2.**

---

## 5. تفصيل Milestones لبقية الـ Epics (مستوى المراجعة — يُفصَّل عند الوصول)

- **EPIC‑2 (Dual Shell — يبني فوق أساس M1.6):** توسيع نظام التصميم لمجموعة مكوّنات كاملة، ثم بناء **القشرتين المستقلتين** كتجربتين منفصلتين (ADR‑002): **قشرة Desktop** (Sidebar+Topbar+Command Palette `Cmd‑K`+Multi‑column) و**قشرة Mobile** (Bottom Nav+FAB+Bottom Sheets+Swipe). (الأساس المشترك — الرموز/الثيم/RTL/التخطيط الأساسي/الحالات القياسية — مُنجز في M1.6.)
- **EPIC‑3 (Core Data + Security Layer):** مخطط Prisma للنواة (26 جدولاً) + إضافات Cadeau (§16.2) بـ`company_id/created_by/updated_by/timestamps` → طبقة Repository تفرض `company_id` → سياسات RLS ثانية (`SET LOCAL app.company_id`) → `audit_log` + Triggers الاتساق → Transaction helper ذري → keyset pagination + الفهارس (§16.3).
- **EPIC‑4 (Auth + Multi‑Tenancy):** تسجيل/دخول JWT (Access/Refresh) + 2FA + إدارة جلسات/انتهاء → `companies/company_members/profiles` + تعدد شركات للمستخدم → رمز دعوة قابل للإبطال → تشفير PII. **بلا أي خدمة خارجية.**
- **EPIC‑5 (Three‑Layer Access — ADR‑003):** `features/plans/plan_features/subscriptions/company_feature_flags/add_ons/permissions/role_permissions/feature_permissions/permission_templates` → **Access Resolver** (Subscription∧Feature∧Permission) في BFF → `<FeatureGate>/<PermissionGate>` + API Middleware → Effective Capabilities + إبطال كاش → **لوحة Super Admin** (فصل امتياز المنصّة) + القوالب الستة → تدقيق كل تغيير.
- **EPIC‑6 (Extensible Core — ADR‑004):** Event Bus (`order.created`, `order.status_changed`, `stock.changed`, `payment.collected`, …) → سجل Plugin + Extension Points موثّقة (وصف فقط، §15.7) → `Flag AI=OFF` في الكتالوج → **فحص CI آلي يمنع أي استيراد SDK/خدمة ذكاء اصطناعي**.
- **EPIC‑7 (Master Data):** `currencies` · `country_configs` · محافظات/مناطق شحن · `order_labels`/`order_reasons` · تصنيفات المنتجات · وحدات القياس → CRUD محكوم بالوصول الثلاثي → مصدر مرجعي مُكاش لبقية الوحدات.
- **EPIC‑8 (Products):** كتالوج + متغيرات (`parent_product_id`) بقوائم متتالية → SKU/باركود (حقل) → تكلفة متوسّطة/COGS لكل متغيّر → عرض مزدوج (جدول/بطاقات).
- **EPIC‑9 (Inventory & Warehouses):** `inventories` (مستودعات) + `inventory_stock` (on_hand/committed/available) → **حجز/تحرير ذري** مع الحالة → **تحويلات ذرية** + سجل → تنبيهات نفاد مرقّمة + السماح بالبيع عند النفاد.
- **EPIC‑10 (Customers):** قاعدة عملاء + ملف تفصيلي + KPIs + سجل طلبات → **منع تكرار E.164** (فهرس فريد لكل `company_id`) → دمج يدوي → تصدير مقيّد ومسجّل → عملة متسقة.
- **EPIC‑11 (Orders):** دورة 12 حالة + حالة متابعة منفصلة → **لصق ذكي حتمي (Regex/Heuristics)** → عرض مزدوج (جدول/بطاقات) + فلاتر محفوظة → تغيير حالة/إسناد inline + جماعي → لوحة تفاصيل جانبية → `collected_amount` محوري → تصنيفات/أسباب → **keyset + Deep‑linking** → استيراد Excel/CSV بربط أعمدة → سجل نشاط كامل → آلة حالة قابلة للتكوين (P1).
- **EPIC‑12 (Shipping):** **طبقة تجريد النواقل** (Carrier Abstraction) + تكامل مصري (Bosta وغيره) → شحن جملة + طباعة بوالص → مناطق قابلة للتكوين → **Webhooks موثوقة** (طابور + إعادة محاولة) → تتبّع داخل الطلب → خصم رسوم الشحن من المحصّل.
- **EPIC‑13 (Finance & Compliance):** موردون + PO (دفع/استلام جزئي + **استلام ذري** يزيد المخزون) → مصروفات موحّدة → **فواتير رسمية PDF** → **ضرائب/VAT قابلة للتكوين** → **استرداد** → **تسوية شحن تعمل** (مطابقة كشوف النواقل) → مركز نقدي + **إقفال شهري ذري متسلسل** → **P&L + مقارنة فترات**.
- **EPIC‑14 (Analytics):** 5 محاور (أعمال/منتجات/مخزون/موظفين/ربحية) → صافي دخل على المحصّل + COGS → **نسب تغيّر محسوبة فعلياً** → تصدير Excel/PDF مقيّد ومسجّل → فلتر زمني + Sparklines → RPC مفكّك لكل تبويب + كاش.
- **EPIC‑15 (Notifications):** مركز إشعارات + Web Push → أنواع (تشغيلية/استباقية بقواعد/حوكمية/مالية) → إشعار العميل النهائي (واتساب/SMS عند تغيّر الحالة) → تفضيلات دقيقة لكل مستخدم → طابور تسليم موثوق.
- **EPIC‑16 (Launch Gate):** كل Empty/Loading/Error · توطين كامل + RTL أصيل · أداء P95<2ث + keyset في كل القوائم · WCAG AA · **اختبار اختراق** (تجاوز صلاحيات عبر API) · **Pre‑Deployment Security Checklist** · تحقّق كل بوابات الإطلاق (§31، بما فيها بنود ADR‑001/002/003/004).

---

## 6. حالة التنفيذ (Build Status)

| البند | الحالة |
|---|---|
| Roadmap | ✅ معتمد (v1.2 بعد تعديلات المالك) |
| EPIC‑1 · M1.1 (هيكل المستودع) | ✅ مكتمل ومُختبَر |
| EPIC‑1 · M1.2 (بوابات CI الأمنية) | ✅ مكتمل ومُختبَر (Actions مثبّتة بـ SHA) |
| EPIC‑1 · M1.3 (البيئات والأسرار + `@cadeau/config`) | ✅ مكتمل ومُختبَر (36 اختبارًا · تغطية ≥90%) |
| EPIC‑1 · M1.4 (Docker Postgres + Prisma + استراتيجيات + `@cadeau/database`) | 🔨 مُنفَّذ (32 اختبارًا · تغطية 100% · بوابات CI خضراء + وظيفة CI للترحيل/البذر على Postgres) — بانتظار تحقّق Docker المحلي من المالك |
| EPIC‑1 · M1.5 → M1.7 | ⏳ قيد الانتظار (M1.5 Backend Foundation هو التالي بعد تحقّق M1.4) |
| EPIC‑2 → EPIC‑16 | ⏳ قيد الانتظار (بوابة جودة إلزامية بين كل Epic) |

</div>

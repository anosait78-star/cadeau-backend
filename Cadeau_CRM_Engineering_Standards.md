<div dir="rtl">

# Cadeau CRM — معايير الهندسة والتطوير (Engineering & Development Standards)

> **حالة الوثيقة:** مرجع رسمي معتمد وإلزامي للفريق الهندسي والتصميمي.
> **الإصدار:** 1.0 · **التاريخ:** 26 يوليو 2026
> **العلاقة:** وثيقة مرافقة لـ [Cadeau_CRM_Master_Product_Plan.md](Cadeau_CRM_Master_Product_Plan.md). تُنفّذ عمليًا القرارات المعمارية الإلزامية **ADR‑001 (Security First)** و**ADR‑002 (Mobile‑First Dual UX)** و**ADR‑003 (Enterprise Permission & Feature Management)**.
> **الطبيعة:** قواعد تنفيذية وقوائم فحص (Checklists) وسياسات — لا كود.

هذه الوثيقة هي **الموطن الرسمي** لـ: Development Standards · Coding Standards · UI Guidelines · UX Guidelines · Security Baseline · Dependency Policy · Definition of Done. كل قاعدة هنا **ملزمة** وتُفحص في مراجعة الكود ومراجعة التصميم وبوابات الـ CI/CD.

---

# 1. المبادئ الحاكمة (Governing Principles)

مشتقّة من Product Principles في الخطة الرئيسية، مرتّبة بالأولوية (الأعلى يفوز عند التعارض):

1. **الأمان أولًا (Security First)** — الأمان قبل سرعة التطوير (**ADR‑001**).
2. **الاستقرار أولًا** — لا ميزة على قاعدة هشّة.
3. **الموبايل أولًا بتجربة مستقلة** — تصميمان مستقلان (**ADR‑002**).
4. **الوصول بثلاث طبقات** — Subscription → Feature Flag → Permission (**ADR‑003**).
5. **بلا AI في v1.0، معمارية جاهزة له** — Modular/Event‑Driven/Plugin + Flag `AI`=OFF (**ADR‑004**).
6. الأمان بالتصميم · العربية أولًا · الأتمتة (قواعد) · الذرية · التوسّع · الشفافية.

---

# 2. معايير التطوير (Development Standards)

## 2.1 التحكم بالإصدارات (Version Control & Git)

- **فرع رئيسي محمي (Protected `main`):** لا دفع مباشر؛ كل تغيير عبر Pull Request.
- **فروع قصيرة العمر:** `feature/*`, `fix/*`, `chore/*` مربوطة بمهمة/تذكرة.
- **Conventional Commits:** `feat: … / fix: … / chore: … / docs: …` لتوليد سجل تغييرات آلي.
- **PR صغير ومركّز** + وصف واضح + لقطات Desktop **و** Mobile للتغييرات الواجهية.
- **مراجعة إلزامية:** موافقة مراجع واحد على الأقل + مراجعة أمنية لأي تغيير يمسّ Auth/Secrets/Dependencies.
- **يُمنع** دمج PR والبوابات (CI/Security/Perf) حمراء.

## 2.2 بوابات التكامل المستمر (CI Gates) — إلزامية

| البوابة | الأداة (فئة) | يمنع الدمج عند |
|--------|--------------|----------------|
| Lint + Format | ESLint/Prettier (أو ما يعادلها) | مخالفات النمط |
| Type Check | فحص أنواع صارم | أخطاء الأنواع |
| Unit + Integration Tests | إطار اختبار | فشل/تغطية < الحد |
| E2E (المسارات الحرجة) | إطار E2E | فشل مسار حرج |
| **SCA — Software Composition Analysis** | فاحص اعتماديات | أي **Critical/High** غير مُصلَح (**ADR‑001**) |
| **SAST** | فاحص كود ساكن | ثغرة أمنية |
| **Secret Scanning** | فاحص أسرار | أي سرّ مكتشف في الديف |
| **Dependency Audit** | Audit | ثغرة/إصدار غير Stable |
| Performance Budget | قياس الحزمة/الأداء | تجاوز الميزانية |
| A11y checks | فاحص إمكانية وصول | مخالفة WCAG AA حرجة |

## 2.3 الاختبار (Testing Standards)

- **هرم الاختبار:** وحدة (الأكثر) → تكامل → E2E (المسارات الحرجة).
- **تغطية المسارات الحرجة ≥ 80%:** إنشاء طلب، حجز/تحرير مخزون، تحويل، استلام PO، إقفال، تسوية، فوترة، صلاحيات.
- **اختبارات فشل الذرية:** التحقق أن الفشل الجزئي لا يفسد المخزون/المال (Rollback).
- **اختبار الصلاحيات خادميًا:** محاولات تجاوز عبر API مباشر يجب أن تُرفض.
- **اختبار مزدوج للواجهة:** كل شاشة تُختبر على مسار Desktop **و** مسار Mobile (**ADR‑002**).
- **اختبار توطين:** RTL/LTR + العربية/الإنجليزية.

## 2.4 البيئات والإصدار (Environments & Releases)

- **Dev → Staging → Production** ببيانات معزولة.
- **Release Gate (ADR‑001):** لا إصدار بلا **Dependency Audit نظيف** + **Security Checklist مكتملة** (§6).
- **Feature Flags** (`company_features`) للإطلاق التدريجي + Canary + Rollback سريع.
- **مراقبة:** Logs مركزية + تتبّع أخطاء + تنبيهات + SLO (توفّر ≥ 99.9%).

## 2.5 التوثيق (Documentation)

- كل وحدة/خدمة لها README + عقود API موثّقة (OpenAPI).
- أي قرار معماري مؤثّر يُوثّق كـ **ADR** جديد (Status/Context/Decision/Consequences).
- تحديث الوثائق شرط قبول لأي تغيير يمسّ السلوك.

---

# 3. معايير كتابة الكود (Coding Standards)

## 3.1 عام

- **لغة موحّدة + فحص أنواع صارم** (TypeScript `strict`) عبر الواجهة والـ BFF.
- **أسماء واضحة، دوال صغيرة، مسؤولية واحدة**، لا تكرار (DRY) دون تجريد سابق لأوانه.
- **لا Magic Numbers/Strings** — ثوابت مسمّاة/Enums (خاصة حالات الطلب والأدوار).
- **معالجة أخطاء صريحة** بصيغة خطأ موحّدة (كود + رسالة مترجمة + تفاصيل).
- **لا `console.log` في الإنتاج** — Logger منظّم بمستويات.

## 3.2 الأمان في الكود (Secure Coding — ADR‑001)

- **الأسرار من Environment/Secrets Manager فقط** — يُمنع أي سرّ في الكود/الإعدادات/Git.
- **Input Validation** على كل حد بـ Schema صارم (رفض ما لا يطابق).
- **Output Encoding + XSS Protection** عند عرض أي محتوى من المستخدم.
- **Parameterized Queries/ORM حصريًا** — لا استعلامات SQL نصية مركّبة (SQL Injection Protection).
- **لا منطق أعمال حرج على العميل** — كله في BFF/RPC؛ العميل طبقة عرض.
- **مفاتيح التكاملات خادمية** — لا تصل للمتصفح أبدًا.
- **تدقيق:** كل عملية حساسة تكتب `audit_log` + `created_by/updated_by`.

## 3.3 معايير الواجهة (Frontend Code)

- **مكوّنات نظام التصميم أولًا** (shadcn/Radix + Tailwind) — لا إعادة اختراع.
- **الرموز الدلالية (Design Tokens) فقط** — لا ألوان/مسافات ثابتة خارج النظام (§10 في الخطة).
- **i18n إلزامي:** لا نص ثابت (Hardcoded)؛ كل نص عبر ملفات موارد (عربي/إنجليزي).
- **منطق `start/end` لا `left/right`** لدعم RTL الأصيل.
- **فصل منطق العرض عن منطق الأعمال** عبر طبقة خدمات/API (تمهيدًا لـ Native — ADR‑002).

## 3.4 معايير الـ Backend/BFF

- **عقود API مُصدَّرة (Versioned `/v1`)** + توثيق OpenAPI.
- **كل عملية متعددة الخطوات داخل معاملة (Transaction)** — ذرية إلزامية.
- **فرض التفويض خادميًا** في BFF + RLS كطبقة ثانية.
- **Rate Limiting + Idempotency** للعمليات الحساسة/المتكررة.
- **ترقيم keyset** في كل القوائم — لا حدود ثابتة.

---

# 4. إرشادات الواجهة والتجربة (UI & UX Guidelines)

> تُفصّل §9–§10 من الخطة الرئيسية، وتُلزم بـ **ADR‑002**.

## 4.1 الهوية البصرية المشتركة (المشترك الوحيد بين التجربتين)

- **أحادية اللون:** الأحمر (`#E11931`) + الأبيض + الحياد الرمادي؛ Accent وردي من نفس الأحمر (`#F26177`). لا لون دخيل.
- الطباعة (`IBM Plex Sans Arabic`)، الحواف، الأيقونات (Lucide)، الثيم المزدوج — موحّدة عبر Desktop/Mobile.

## 4.2 قاعدة التصميم المزدوج (Dual Design Rule) — إلزامية

> لكل شاشة يُنتَج **Desktop UX أولًا ثم Mobile UX** كتصميمين مستقلين. أحدهما ليس نسخة من الآخر. هذا **شرط قبول (Definition of Done)**.

| البُعد | Desktop | Mobile |
|-------|---------|--------|
| التنقّل | Sidebar ثابت + Topbar | Bottom Navigation + رأس مبسّط |
| الإجراء الرئيسي | زر Primary/شريط أدوات | FAB + Sticky Bottom Actions |
| البيانات | جداول + Multi‑column | Mobile Cards/قوائم |
| الحوارات | Dialog/Side Sheet | Bottom Sheets + Full‑Screen |
| النماذج | متعدد الأعمدة | Progressive/Wizard خطوة‑بخطوة |
| التفاعل | Hover/Right‑Click/Keyboard (إثراء) | Swipe/Long‑press/Touch |

## 4.3 إرشادات Desktop (Power User)

- Sidebar ثابت قابل للطي + Breadcrumbs + Multi‑column.
- Keyboard Shortcuts موثّقة + Command Palette (Cmd/Ctrl+K).
- Hover و Context Menus **إثراءً فقط** — لكل وظيفة بديل ظاهر بنقرة.
- جداول غنية (فرز/فلترة/تحديد جماعي/تصدير) + Side Sheets دون مغادرة السياق.

## 4.4 إرشادات Mobile (Native‑Feeling)

- يُصمّم كتطبيق Native لا موقع مصغّر.
- Bottom Nav · FAB · Bottom Sheets · Full‑Screen · Swipe · Sticky Bottom Actions.
- **Touch Targets ≥ 44px** · One‑Hand Usage (الحرِج أسفل) · Minimal Inputs · Quick Actions.
- Progressive Forms/Wizards + حفظ تلقائي للمسودّة + لوحات مفاتيح مناسبة للنوع.
- Device‑Ready: Camera/Image Capture · QR/Barcode · Location · File Upload · Push · Offline.

## 4.5 قيود جاهزية Native (Native‑Ready Constraints) — تُفحص لكل شاشة

1. لا وظيفة أساسية تعتمد على **Hover**.
2. لا وظيفة أساسية تعتمد على **Right‑Click**.
3. لا قائمة بيانات بلا تمثيل **بطاقات/قوائم** بديل للجدول.
4. كل **Workflow** له نسخة Mobile محسّنة.
5. كل شاشة لها **Mobile Layout مستقل** مصمّم عمدًا.
6. منطق العرض منفصل عن منطق الأعمال عبر API موحّد.

## 4.6 الحالات وإمكانية الوصول

- **Empty/Loading/Error** مصمّمة لكل شاشة (لا شاشات صامتة).
- **WCAG 2.1 AA:** تباين، لوحة مفاتيح، تركيز، ARIA، أهداف لمس، اختبار قارئ شاشة فعلي.

---

# 5. سياسة الأمان الأساسية (Security Baseline) — تطبيق ADR‑001

## 5.1 سياسة الاعتماديات (Dependency Policy)

| القاعدة | التفصيل |
|--------|---------|
| **Stable فقط** | يُمنع Beta/Alpha/RC في الإنتاج. |
| **لا Critical/High** | أي مكوّن بثغرة Critical/High غير مُصلَحة **يُستبعد** ولو كان مشهورًا. |
| **فحص قبل التبنّي** | CVEs · GitHub Security Advisories · NPM Advisories · OWASP. |
| **Lockfiles + تثبيت** | تثبيت الإصدارات؛ ترقيات مُراجعة أمنيًا. |
| **مراجعة دورية** | فحص مستمر للـ Dependencies طوال التطوير. |
| **بوابة الإصدار** | Dependency Audit إلزامي قبل كل Release. |
| **تقليل السطح** | تقليل عدد الاعتماديات؛ تفضيل المُصان والموثوق. |

## 5.2 ضوابط التطبيق (Application Controls)

CSP · Security Headers (HSTS, X‑Frame‑Options, X‑Content‑Type‑Options, Referrer‑Policy, Permissions‑Policy) · Rate Limiting · Input Validation · Output Encoding · CSRF Protection · XSS Protection · SQL Injection Protection · 2FA · إدارة جلسات + انتهاء · تشفير PII · تدقيق شامل.

## 5.3 إدارة الأسرار (Secrets Management)

- Environment Variables / Secrets Manager **فقط**.
- **يُمنع** أي سرّ في الـ Repository (كود/إعدادات/سجل Git). Secret Scanning يمنع الدمج.
- تدوير دوري للمفاتيح + صلاحيات أقل ما يلزم (Least Privilege).

---

# 6. قائمة الفحص الأمني قبل النشر (Pre‑Deployment Security Checklist) — إلزامية

> لا نشر إلى الإنتاج قبل استيفاء كل بند (بوابة نشر — ADR‑001):

- [ ] كل الاعتماديات **Stable** (لا Beta/Alpha/RC).
- [ ] **Dependency Audit** نظيف: صفر ثغرات Critical/High غير مُصلَحة.
- [ ] **SCA + SAST + Secret Scanning** خضراء في CI.
- [ ] لا أي سرّ في الـ Repository؛ كل الأسرار في Environment/Secrets Manager.
- [ ] CSP + Security Headers مفعّلة على كل الحدود.
- [ ] Rate Limiting مفعّل لكل مستأجر.
- [ ] Input Validation + Output Encoding + XSS + CSRF مطبّقة حيث تنطبق.
- [ ] كل استعلامات القاعدة Parameterized (لا حقن SQL).
- [ ] التفويض مفروض خادميًا (اختبار تجاوز صلاحيات عبر API مباشر مرّ بنجاح).
- [ ] العمليات متعددة الخطوات ذرية (اختبار فشل مرّ).
- [ ] PII مشفّرة + التدقيق يسجّل العمليات الحساسة.
- [ ] 2FA + إدارة الجلسات تعملان.
- [ ] مراجعة أمنية للتغييرات الحساسة (Auth/Secrets/Dependencies) موثّقة.

---

# 7. تعريف الإنجاز (Definition of Done) — لكل شاشة/ميزة

- [ ] المتطلب منفّذ ومختبر (وحدة/تكامل/E2E للمسار الحرج).
- [ ] **Desktop UX + Mobile UX** مصمّمان ومنفّذان **كتصميمين مستقلين** (ADR‑002).
- [ ] قيود جاهزية Native مستوفاة (§4.5): لا Hover/Right‑Click أساسي · بديل بطاقات لكل جدول.
- [ ] رموز التصميم فقط (لا قيم ثابتة) + i18n كامل (عربي/إنجليزي) + RTL/LTR سليم.
- [ ] حالات Empty/Loading/Error مصمّمة + WCAG AA.
- [ ] التفويض مفروض خادميًا + تدقيق العمليات الحساسة.
- [ ] **(ADR‑003)** الميزة محكومة بالطبقات الثلاث: مربوطة بـ Feature Key + بوابة على القائمة/الصفحة/الأزرار/التقارير/API + الفحص خادمي (لا إخفاء عميل فقط).
- [ ] **(ADR‑004)** الميزة تعمل **بمنطق حتمي بلا AI** في v1.0 · لا خدمة/شاشة/تكامل AI · أي امتداد مستقبلي عبر Event/Extension Point موثّق (لا في النواة) · Flag `AI` يبقى OFF.
- [ ] بوابات CI الأمنية والأدائية خضراء (§2.2).
- [ ] لقطات Desktop وMobile مرفقة في الـ PR + توثيق محدّث.

---

# 8. نموذج الوصول الثلاثي (Three‑Layer Access Model) — تطبيق ADR‑003

> لا الصلاحيات وحدها تحكم الظهور. كل وصول = `Subscription AND Feature Flag AND Permission` عبر **محرّك الوصول الثلاثي** الموحّد.

## 8.1 القاعدة الإلزامية

```
Access Resolver (BFF):
  1) Subscription : خطة الشركة تتضمّن Feature Key؟
  2) Feature Flag : الـ Flag مُفعّل لهذه الشركة (يشمل Add‑ons)؟
  3) Permission   : دور/صلاحية الموظف تسمح؟
  ⇒ ALLOW فقط إذا (1 AND 2 AND 3). غير ذلك DENY + إخفاء عرضي.
```

## 8.2 قواعد الكود الإلزامية

- **لا شاشة/مسار/زر/تقرير/Endpoint خارج البوابة:** استخدم `<FeatureGate>` / `<PermissionGate>` في الواجهة + Access Middleware على كل API.
- **الفرض خادمي حصريًا:** إخفاء عنصر الواجهة **ليس** حماية؛ القرار الحاسم في الـ BFF لكل طلب (يمنع تجاوز API مباشر).
- **Feature Catalog كبيانات:** كل قدرة = Feature Key في القاعدة؛ **إضافة Module جديد = Feature Key + صلاحياته + ربطه بالخطط، بلا تعديل نواة (Zero Core Change)**.
- **خريطة القدرات الفعّالة (Effective Capabilities):** تُحسب مرة لكل جلسة، تُخزّن مؤقتًا، وتُبطَل فور تغيّر خطة/Flag/دور.
- **فصل الامتيازات:** صلاحية **Super Admin (منصّة)** منفصلة تمامًا عن أدوار المستأجر — لا خلط في الكود أو التوكن.
- **التدقيق:** كل تغيير خطة/Flag/Add‑on/قالب/دور يُكتب في `audit_log`.

## 8.3 قوالب الصلاحيات (Permission Templates)

قوالب جاهزة قابلة للاستنساخ والتعديل: **Owner · Store Manager · Call Center · Warehouse Manager · Finance Manager · Marketing Manager**. الأدوار المخصّصة تُبنى بالتعديل على قالب لا من الصفر.

---

# 9. المعمارية القابلة للتمديد وقاعدة No‑AI‑in‑v1.0 (Extensible / AI‑Ready) — تطبيق ADR‑004

> **v1.0 يعمل بكفاءة 100% دون أي ذكاء اصطناعي.** المعمارية Modular + Event‑Driven + Plugin بحيث يُضاف AI لاحقًا كموديول مستقل **دون تعديل الـ Core**.

## 9.1 قواعد ممنوعة في v1.0 (No‑AI)

- **لا** خدمات AI · **لا** شاشات AI · **لا** تكاملات (Claude/OpenAI/غيرها) · **لا** Workflow يعتمد على AI.
- كل بديل حتمي (Deterministic): اللصق الذكي = Regex/Heuristics؛ كشف التكرار = تطبيع هاتف؛ التنبيهات/إعادة الطلب = قواعد وعتبات.

## 9.2 قواعد المعمارية الإلزامية

- **Modular:** كل Module Bounded Context بواجهة عقود؛ لا تعتمد الوحدات على تفاصيل بعضها.
- **Event‑Driven:** التواصل عبر أحداث نطاق على Event Bus (`order.created`, `stock.changed`, …)؛ اقتران منخفض.
- **Plugin + Extension Points:** قدرات إضافية تُسجّل على نقاط تمديد مُعرّفة دون لمس النواة.
- **Feature Flag `AI` = OFF افتراضيًا** لكل الشركات (يمرّ بالطبقات الثلاث عند التفعيل — ADR‑003).

## 9.3 توثيق نقاط دمج AI المستقبلية (وصف فقط — لا تنفيذ)

`SmartPaste.parse` · `Address.normalize` · حدث `order.created` · حدث `stock.changed` · `analytics.query` · `message.compose` · `customer.enrich`. **يُوثَّق مكان الدمج فقط؛ يُمنع تنفيذ أي منها في v1.0.**

## 9.4 قاعدة الكود

- يُمنع استيراد/استدعاء أي SDK أو خدمة AI في كود v1.0 (يُفحص في مراجعة الكود + إمكان فحص آلي).
- أي مقترح ميزة "ذكية" يجب أن يُقدَّم **ببديل حتمي** يعمل بلا AI ليُقبل في v1.0.

---

# 10. الحوكمة (Governance of these Standards)

- هذه المعايير **إلزامية**؛ الاستثناء يتطلب **ADR جديدًا معتمدًا** يوثّق المبرّر والمخاطرة.
- **ADR‑001** و**ADR‑002** و**ADR‑003** و**ADR‑004** لا يجوز تجاوزها إلا بقرار مالك المنتج + مسؤول الهندسة صراحةً.
- تُراجَع هذه الوثيقة مع كل إصدار رئيسي (v1.0 / v1.1 / v1.2 / v2.0).

</div>

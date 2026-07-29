/**
 * Translation dictionaries. Arabic is the primary locale (the product is
 * Arabic-first, RTL); English is the secondary. Both dictionaries MUST expose
 * the same keys — `TranslationKey` is derived from `en` and the `ar` entry is
 * type-checked against it below.
 */
export const en = {
  "app.name": "Cadeau CRM",
  "app.tagline": "Secure, multi-tenant CRM for social commerce",
  "nav.primary": "Primary navigation",
  "nav.bottom": "Bottom navigation",
  "nav.more": "More",
  "nav.dashboard": "Dashboard",
  "nav.orders": "Orders",
  "nav.customers": "Customers",
  "nav.products": "Products",
  "nav.inventory": "Inventory",
  "nav.settings": "Settings",
  "user.account": "Account",
  "user.profile": "Profile",
  "user.settings": "Settings",
  "user.signOut": "Sign out",
  "placeholder.description": "This section is part of a later epic and is not built yet.",
  "command.trigger": "Search…",
  "command.placeholder": "Type a command or search…",
  "command.empty": "No results found.",
  "command.navigation": "Navigation",
  "command.actions": "Actions",
  "command.switchLanguage": "Switch language",
  "actions.toggleTheme": "Toggle theme",
  "actions.toggleLanguage": "العربية",
  "states.loading": "Loading…",
  "states.empty.title": "Nothing here yet",
  "states.empty.description": "When there is data to show, it will appear here.",
  "states.error.title": "Something went wrong",
  "states.error.description": "We could not complete the request. Please try again.",
  "states.error.retry": "Try again",
  "home.title": "Frontend Foundation",
  "home.description":
    "The shared foundation: design tokens, theme, direction, i18n, and standard states.",
  "home.statesHeading": "Standard states",
  "home.tokensHeading": "Design tokens",
  "home.demoEmptyTitle": "No orders yet",
  "home.demoEmptyDescription": "New orders will show up here as they arrive.",
  "home.demoErrorDescription": "Could not load the dashboard. This is a demo error state.",
  "notFound.title": "Page not found",
  "notFound.description": "The page you are looking for does not exist.",
  "notFound.back": "Back to home",
} as const;

export type TranslationKey = keyof typeof en;

export const ar: Record<TranslationKey, string> = {
  "app.name": "كادو CRM",
  "app.tagline": "نظام CRM آمن ومتعدد المستأجرين للتجارة الاجتماعية",
  "nav.primary": "التنقّل الرئيسي",
  "nav.bottom": "التنقّل السفلي",
  "nav.more": "المزيد",
  "nav.dashboard": "لوحة التحكم",
  "nav.orders": "الطلبات",
  "nav.customers": "العملاء",
  "nav.products": "المنتجات",
  "nav.inventory": "المخزون",
  "nav.settings": "الإعدادات",
  "user.account": "الحساب",
  "user.profile": "الملف الشخصي",
  "user.settings": "الإعدادات",
  "user.signOut": "تسجيل الخروج",
  "placeholder.description": "هذا القسم جزء من Epic لاحق ولم يُبنَ بعد.",
  "command.trigger": "بحث…",
  "command.placeholder": "اكتب أمرًا أو ابحث…",
  "command.empty": "لا توجد نتائج.",
  "command.navigation": "التنقّل",
  "command.actions": "الإجراءات",
  "command.switchLanguage": "تبديل اللغة",
  "actions.toggleTheme": "تبديل السمة",
  "actions.toggleLanguage": "English",
  "states.loading": "جارٍ التحميل…",
  "states.empty.title": "لا يوجد شيء بعد",
  "states.empty.description": "عند توفّر بيانات لعرضها ستظهر هنا.",
  "states.error.title": "حدث خطأ ما",
  "states.error.description": "تعذّر إكمال الطلب. يُرجى المحاولة مرة أخرى.",
  "states.error.retry": "إعادة المحاولة",
  "home.title": "أساس الواجهة الأمامية",
  "home.description": "الأساس المشترك: رموز التصميم، السمة، الاتجاه، التوطين، والحالات القياسية.",
  "home.statesHeading": "الحالات القياسية",
  "home.tokensHeading": "رموز التصميم",
  "home.demoEmptyTitle": "لا توجد طلبات بعد",
  "home.demoEmptyDescription": "ستظهر الطلبات الجديدة هنا عند ورودها.",
  "home.demoErrorDescription": "تعذّر تحميل لوحة التحكم. هذه حالة خطأ تجريبية.",
  "notFound.title": "الصفحة غير موجودة",
  "notFound.description": "الصفحة التي تبحث عنها غير موجودة.",
  "notFound.back": "العودة إلى الرئيسية",
};

export const dictionaries = { ar, en } as const;

export type Locale = keyof typeof dictionaries;

/** Text direction for a locale. Arabic is RTL; English is LTR. */
export function directionForLocale(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

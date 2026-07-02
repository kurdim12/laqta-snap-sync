import { useEffect, useState } from "react";
import type { Bilingual, Locale } from "./types";

export type Lang = "ar" | "en";

export function pick(b: Bilingual | undefined, lang: Lang): string {
  if (!b) return "";
  return b[lang] || b.ar || b.en || "";
}

const STORAGE_KEY = "laqta:lang";

export function useLang(eventLocale: Locale = "both"): [Lang, (l: Lang) => void, boolean] {
  const initial: Lang = eventLocale === "ar" ? "ar" : eventLocale === "en" ? "en" : "ar";
  const [lang, setLangState] = useState<Lang>(initial);
  const toggleable = eventLocale === "both";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (toggleable) {
      const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
      if (stored === "ar" || stored === "en") setLangState(stored);
    } else {
      setLangState(eventLocale === "en" ? "en" : "ar");
    }
  }, [toggleable, eventLocale]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, l);
  };

  return [lang, setLang, toggleable];
}

export const T = {
  next: { ar: "ضيف جديد", en: "Next guest" },
  submit: { ar: "تسجيل", en: "Register" },
  required: { ar: "هذا الحقل مطلوب", en: "Required" },
  invalidEmail: { ar: "إيميل غير صالح", en: "Invalid email" },
  invalidPhone: { ar: "رقم غير صالح", en: "Invalid phone" },
  screenshot: { ar: "صوّر سكرين شوت 📸", en: "Screenshot this! 📸" },
  yourCode: { ar: "كودك", en: "Your code" },
  galleryHint: { ar: "صورك رح تظهر بهالرابط", en: "Your photos will appear at this link" },
  eventUnavailable: { ar: "هذه الفعالية غير متاحة", en: "This event is not available" },
  photosOnTheWay: { ar: "صورك بالطريق", en: "Your photos are on the way" },
  comeBackSoon: { ar: "ارجع بعد شوي", en: "Check back soon" },
  wrongCode: { ar: "تأكد من الكود", en: "Double-check your code" },
  enterCode: { ar: "أدخل الكود", en: "Enter code" },
  downloadAll: { ar: "تحميل الكل", en: "Download all" },
  download: { ar: "تحميل", en: "Download" },
  consent: { ar: "الموافقة", en: "Consent" },
  synced: { ar: "متزامن", en: "Synced" },
  saving: { ar: "محفوظ ومتزامن…", en: "Saved, syncing…" },
  lastSync: { ar: "آخر مزامنة منذ", en: "Last sync" },
  minutes: { ar: "دقيقة", en: "m ago" },
  dataSafe: { ar: "البيانات محفوظة ✓", en: "data is safe ✓" },
  // staff
  staffPin: { ar: "أدخل رمز الموظف (٦ أرقام)", en: "Enter staff PIN (6 digits)" },
  uploadingFor: { ar: "يتم الرفع لـ", en: "Uploading for" },
  unpaired: { ar: "غير مرتبط", en: "Unpaired" },
  dropFiles: { ar: "اسحب الملفات هنا أو انقر للاختيار", en: "Drop files or tap to select" },
  queue: { ar: "قائمة الرفع", en: "Upload queue" },
  done: { ar: "تم", en: "done" },
  uploading: { ar: "جاري الرفع", en: "uploading" },
  retrying: { ar: "إعادة المحاولة", en: "retrying" },
  retry: { ar: "إعادة", en: "Retry" },
  active: { ar: "نشط الآن", en: "Active now" },
  guests: { ar: "الضيوف", en: "Guests" },
  // admin
  signIn: { ar: "تسجيل الدخول", en: "Sign in" },
  signUp: { ar: "إنشاء حساب", en: "Sign up" },
  signOut: { ar: "تسجيل الخروج", en: "Sign out" },
  email: { ar: "البريد الإلكتروني", en: "Email" },
  password: { ar: "كلمة المرور", en: "Password" },
  events: { ar: "الفعاليات", en: "Events" },
  newEvent: { ar: "فعالية جديدة", en: "New event" },
};

export type Locale = "ar" | "en" | "both";
export type Bilingual = { ar: string; en: string };

export interface EventField {
  key: string;
  type: "text" | "tel" | "email" | "number";
  required: boolean;
  label: Bilingual;
}

export interface EventConfig {
  locale: Locale;
  theme: { primary: string; background: string; text: string; logoUrl: string };
  fields: EventField[];
  consentText: Bilingual;
  successMessage: Bilingual;
  gallery: { allowDownloadAll: boolean; showVideos: boolean };
  limits: { maxVideoMB: number; maxPhotoMB: number };
}

export const DEFAULT_CONFIG: EventConfig = {
  locale: "both",
  theme: { primary: "#C9A227", background: "#0E0E10", text: "#FAFAF7", logoUrl: "" },
  fields: [
    { key: "name", type: "text", required: true, label: { ar: "الاسم", en: "Name" } },
    { key: "phone", type: "tel", required: true, label: { ar: "رقم الهاتف", en: "Phone" } },
    { key: "email", type: "email", required: false, label: { ar: "الإيميل", en: "Email" } },
  ],
  consentText: { ar: "أوافق على استخدام صوري لأغراض الفعالية", en: "I agree to my photos being used for this event" },
  successMessage: { ar: "تم! صورك رح توصلك هون", en: "Done! Your photos will appear here" },
  gallery: { allowDownloadAll: true, showVideos: true },
  limits: { maxVideoMB: 50, maxPhotoMB: 25 },
};

export interface EventRow {
  id: string;
  slug: string;
  name: string;
  status: "draft" | "dryrun" | "live" | "archived";
  config: EventConfig;
  staff_pin: string;
  created_at: string;
}

export interface GuestRow {
  id: string;
  event_id: string;
  code: string;
  form_data: Record<string, string>;
  consent: boolean;
  source: string;
  created_at: string;
}

export interface AssetRow {
  id: string;
  event_id: string;
  guest_id: string | null;
  parent_asset_id: string | null;
  kind: "photo" | "video";
  variant: "original" | "web" | "thumb" | "poster";
  storage_path: string;
  content_type: string;
  bytes: number;
  status: "pending" | "ready" | "failed" | "hidden";
  meta: Record<string, unknown>;
  created_at: string;
}

export type Locale = "ar" | "en" | "both";
export type Bilingual = { ar: string; en: string };

export interface EventField {
  key: string;
  type: "text" | "tel" | "email" | "number";
  required: boolean;
  label: Bilingual;
}

export interface BackdropSettingsConfig {
  palette: { from: string; to: string }[];
  halftone: boolean;
  halftoneOpacity: number;
  aspect: "1:1" | "4:5";
}

export interface WallTile {
  text: string;
  /** hex background; omit for a gradient-free black tile */
  background: string;
  color: string;
}

export interface WallConfig {
  columns: number;
  /** seconds between grid refreshes/advances */
  intervalSec: number;
  tiles: WallTile[];
}

export interface EventConfig {
  locale: Locale;
  /** "open" = guests register on /e/:slug; "none" = no registration form, QR opens public gallery */
  registration?: "open" | "none";
  theme: { primary: string; background: string; text: string; logoUrl: string };
  fields: EventField[];
  consentText: Bilingual;
  successMessage: Bilingual;
  gallery: { allowDownloadAll: boolean; showVideos: boolean; mode: "private" | "public"; requireApproval?: boolean };
  selfie: "required" | "optional" | "off";
  limits: { maxVideoMB: number; maxPhotoMB: number };
  /** settings for template_mode = "backdrop" (client-side, $0 per photo) */
  backdrop?: BackdropSettingsConfig;
  /** settings for the /wall/:slug venue display */
  wall?: WallConfig;
}


export const DEFAULT_CONFIG: EventConfig = {
  locale: "both",
  registration: "open",
  theme: { primary: "#C9A227", background: "#0E0E10", text: "#FAFAF7", logoUrl: "" },
  fields: [
    { key: "name", type: "text", required: true, label: { ar: "الاسم", en: "Name" } },
    { key: "phone", type: "tel", required: true, label: { ar: "رقم الهاتف", en: "Phone" } },
    { key: "email", type: "email", required: false, label: { ar: "الإيميل", en: "Email" } },
  ],
  consentText: { ar: "أوافق على استخدام صوري لأغراض الفعالية", en: "I agree to my photos being used for this event" },
  successMessage: { ar: "تم! صورك رح توصلك هون", en: "Done! Your photos will appear here" },
  gallery: { allowDownloadAll: true, showVideos: true, mode: "private", requireApproval: false },
  selfie: "optional",
  limits: { maxVideoMB: 50, maxPhotoMB: 25 },
};

export interface EventRow {
  id: string;
  slug: string;
  name: string;
  status: "draft" | "dryrun" | "live" | "archived";
  config: EventConfig;
  staff_pin?: string | null;
  created_at: string;
  /** none = raw photos, frame = PNG overlay, ai = AI restyle */
  template_mode?: "none" | "frame" | "ai";
  template_prompt?: string | null;
  /** data URL of the style reference image */
  template_reference_url?: string | null;
  /** data URL of the transparent PNG frame */
  template_frame_url?: string | null;
  template_quality?: "low" | "medium" | "high";
  template_aspect_ratio?: string;
  /** hard cap on AI generations for this event */
  max_generations?: number;
  generations_used?: number;
}

export interface GuestRow {
  id: string;
  event_id: string;
  code: string;
  form_data: Record<string, string>;
  consent: boolean;
  source: string;
  created_at: string;
  selfie_path?: string | null;
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
  approved?: boolean;
  original_url?: string | null;
  processed_url?: string | null;
  process_status?: "pending" | "processing" | "done" | "failed";
  error_message?: string | null;
  generation_cost?: number | null;
  generation_model?: string | null;
  processing_started_at?: string | null;
  processing_finished_at?: string | null;
}

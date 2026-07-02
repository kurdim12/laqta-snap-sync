// Pure, dependency-light email composition for guest code delivery. No secrets,
// no network (the QR is generated locally). Bilingual AR + EN so it reads
// correctly regardless of the guest's device language.
import { qrDataUrl } from "@/lib/qr";

export interface FieldLike {
  key: string;
  type: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Pull the guest's email out of form_data using the event's field definitions
// (the field whose type is "email"). Returns null when absent/invalid.
export function extractEmail(
  fields: FieldLike[] | undefined,
  formData: Record<string, unknown> | undefined,
): string | null {
  if (!formData) return null;
  const keys = (fields || []).filter((f) => f.type === "email").map((f) => f.key);
  // Fall back to a conventional "email" key if the event has no typed field.
  if (!keys.includes("email")) keys.push("email");
  for (const k of keys) {
    const v = String(formData[k] ?? "").trim();
    if (EMAIL_RE.test(v)) return v;
  }
  return null;
}

export interface CodeEmailInput {
  eventName: string;
  code: string;
  galleryUrl: string;
  lang?: "ar" | "en";
}

export interface ComposedEmail {
  subject: string;
  html: string;
  text: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// Bilingual "your photos are ready" email with the code, a direct gallery link,
// and a QR. `lang` only decides which language leads; both are always included.
export async function codeEmail(input: CodeEmailInput): Promise<ComposedEmail> {
  const { eventName, code, galleryUrl, lang = "en" } = input;
  const qr = await qrDataUrl(galleryUrl, 220).catch(() => "");
  const name = esc(eventName);
  const url = esc(galleryUrl);
  const c = esc(code);

  const en = {
    title: "Your event photos",
    body: `Your photos & videos from ${name} are ready.`,
    codeLabel: "Your gallery code",
    open: "Open my gallery",
    hint: "Keep this code — it opens your private gallery.",
  };
  const ar = {
    title: "صور مناسبتك",
    body: `صورك وفيديوهاتك من ${name} جاهزة.`,
    codeLabel: "رمز معرضك",
    open: "افتح معرضي",
    hint: "احتفظ بهذا الرمز — يفتح معرضك الخاص.",
  };

  const subject =
    lang === "ar" ? `${ar.title} · ${en.title}` : `${en.title} · ${ar.title}`;

  const block = (t: typeof en, dir: "ltr" | "rtl") => `
    <div dir="${dir}" style="text-align:${dir === "rtl" ? "right" : "left"};padding:8px 0">
      <h2 style="margin:0 0 6px;font-size:18px;color:#0E0E10">${t.title}</h2>
      <p style="margin:0 0 12px;color:#444;font-size:14px">${t.body}</p>
      <p style="margin:0 0 4px;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px">${t.codeLabel}</p>
      <div style="font-family:monospace;font-size:32px;font-weight:800;letter-spacing:6px;color:#C9A227">${c}</div>
      <a href="${url}" style="display:inline-block;margin:14px 0;background:#C9A227;color:#0E0E10;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${t.open}</a>
      <p style="margin:6px 0 0;color:#999;font-size:12px">${t.hint}</p>
    </div>`;

  const first = lang === "ar" ? block(ar, "rtl") : block(en, "ltr");
  const second = lang === "ar" ? block(en, "ltr") : block(ar, "rtl");
  const qrImg = qr
    ? `<div style="text-align:center;margin:10px 0"><img src="${qr}" width="180" height="180" alt="QR" style="border:8px solid #fff;border-radius:8px"/></div>`
    : "";

  const html = `<div style="max-width:480px;margin:0 auto;font-family:Inter,Arial,sans-serif">
    <div style="text-align:center;font-weight:800;letter-spacing:3px;color:#C9A227;font-size:20px;padding:8px 0">LAQTA · لقطة</div>
    ${first}${qrImg}<hr style="border:none;border-top:1px solid #eee;margin:12px 0"/>${second}
    <p style="text-align:center;color:#bbb;font-size:11px;margin-top:16px">${url}</p>
  </div>`;

  const text = `${en.title} — ${en.body}\n${en.codeLabel}: ${code}\n${galleryUrl}\n\n${ar.title} — ${ar.body}\n${ar.codeLabel}: ${code}\n${galleryUrl}`;

  return { subject, html, text };
}

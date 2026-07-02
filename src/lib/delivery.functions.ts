import { createServerFn } from "@tanstack/react-start";
import { getRequestIP, getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { codeEmail, extractEmail, type FieldLike } from "./delivery/templates";

// Guest code delivery. Two entry points:
//   - sendGuestCodeEmail (anon, from the registration outbox): idempotent, one
//     'sent' email per guest — an anon caller can never force a resend, so a
//     leaked code (codes appear in public /g/CODE links) can't be used to
//     email-bomb the guest.
//   - adminResendGuestCode (admin only): verifies the caller's Supabase session
//     is an admin, then force-resends.

const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count++;
  return true;
}
function ipKey(): string {
  try {
    return getRequestIP() || "anon";
  } catch {
    return "anon";
  }
}

// Canonical app origin for the gallery link. Never trust a client-supplied
// origin (it would let a caller put a phishing link in the guest's inbox).
// Prefer APP_ORIGIN; the request-host fallback is https-only and, behind
// Cloudflare, the host is routed (not arbitrarily spoofable). Set APP_ORIGIN
// in production to remove the fallback entirely.
function appOrigin(): string {
  const env = typeof process !== "undefined" ? process.env.APP_ORIGIN : undefined;
  if (env && /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(env)) return env.replace(/\/$/, "");
  try {
    const o = new URL(getRequest().url).origin;
    return /^https:\/\//i.test(o) ? o : "";
  } catch {
    return "";
  }
}

export interface SendCodeResult {
  status: "sent" | "failed" | "queued" | "skipped";
  reason?: string;
}

// Shared delivery core. `allowResend` bypasses the one-email idempotency guard
// and is only ever passed true from the admin-authenticated path.
async function deliverCode(
  rawCode: string,
  lang: "ar" | "en" | undefined,
  allowResend: boolean,
): Promise<SendCodeResult> {
  const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code) return { status: "skipped", reason: "bad code" };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: g } = await supabaseAdmin
    .from("guests")
    .select("id, event_id, code, form_data")
    .ilike("code", code)
    .maybeSingle();
  if (!g) return { status: "skipped", reason: "guest not found" };

  const { data: ev } = await supabaseAdmin
    .from("events")
    .select("name, status, config")
    .eq("id", g.event_id)
    .maybeSingle();
  if (!ev) return { status: "skipped", reason: "event not found" };

  const cfg = (ev.config || {}) as { fields?: FieldLike[] };
  const email = extractEmail(cfg.fields, (g.form_data || {}) as Record<string, unknown>);
  if (!email) return { status: "skipped", reason: "no email on file" };

  // Idempotency: never resend a 'sent' email unless the admin forces it.
  const { data: existing } = await supabaseAdmin
    .from("deliveries")
    .select("id, status")
    .eq("guest_id", g.id)
    .eq("channel", "email")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.status === "sent" && !allowResend) {
    return { status: "sent", reason: "already sent" };
  }

  // Throttle only real sends (keyed on the platform IP). A NAT'd venue shares
  // one IP, so keep this generous; over the limit we record a visible 'queued'
  // row instead of silently dropping.
  const upsert = async (status: string, providerId: string | null, error: string | null) => {
    const row = {
      guest_id: g.id,
      channel: "email",
      status,
      destination: email,
      provider_message_id: providerId,
      error,
      updated_at: new Date().toISOString(),
    };
    if (existing?.id) await supabaseAdmin.from("deliveries").update(row).eq("id", existing.id);
    else await supabaseAdmin.from("deliveries").insert(row);
  };

  if (!rateLimit(`sendcode:${ipKey()}`, 300, 60_000)) {
    await upsert("queued", null, "rate limited");
    return { status: "queued", reason: "rate limited" };
  }

  const composed = await codeEmail({
    eventName: ev.name,
    code: g.code,
    galleryUrl: `${appOrigin()}/g/${g.code}`,
    lang,
  });
  const { resendSend } = await import("./delivery/resend");
  const result = await resendSend({
    channel: "email",
    to: email,
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
  });
  await upsert(result.status, result.providerMessageId ?? null, result.error ?? null);
  return { status: result.status, reason: result.error };
}

// Anon path — from the registration outbox. No resend, ever.
export const sendGuestCodeEmail = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      code: z.string().min(1).max(32),
      lang: z.enum(["ar", "en"]).optional(),
    }),
  )
  .handler(async ({ data }): Promise<SendCodeResult> => deliverCode(data.code, data.lang, false));

// Admin path — verifies the caller's Supabase session is an admin, then forces
// a resend.
export const adminResendGuestCode = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      code: z.string().min(1).max(32),
      accessToken: z.string().min(1),
      lang: z.enum(["ar", "en"]).optional(),
    }),
  )
  .handler(async ({ data }): Promise<SendCodeResult> => {
    if (!rateLimit(`adminresend:${ipKey()}`, 60, 60_000)) {
      return { status: "failed", reason: "rate limited" };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: u } = await supabaseAdmin.auth.getUser(data.accessToken);
    if (!u?.user) return { status: "failed", reason: "unauthorized" };
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: u.user.id,
      _role: "admin",
    });
    if (isAdmin !== true) return { status: "failed", reason: "unauthorized" };
    return deliverCode(data.code, data.lang, true);
  });

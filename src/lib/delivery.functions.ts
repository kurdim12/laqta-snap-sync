import { createServerFn } from "@tanstack/react-start";
import { getRequestIP, getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { codeEmail, extractEmail, type FieldLike } from "./delivery/templates";

// Guest code delivery. Triggered best-effort from the registration outbox after
// the guest row syncs, and from the admin dashboard ("resend"). Idempotent: a
// guest gets at most one 'sent' email per channel unless force=true (admin).

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
// origin (it would let a caller send a phishing link to the real guest). Prefer
// APP_ORIGIN; otherwise derive from the request itself.
function appOrigin(): string {
  const env = typeof process !== "undefined" ? process.env.APP_ORIGIN : undefined;
  if (env && /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(env)) return env.replace(/\/$/, "");
  try {
    return new URL(getRequest().url).origin;
  } catch {
    return "";
  }
}

export interface SendCodeResult {
  status: "sent" | "failed" | "queued" | "skipped";
  reason?: string;
}

export const sendGuestCodeEmail = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      code: z
        .string()
        .min(1)
        .max(32)
        .transform((c) => c.toUpperCase().replace(/[^A-Z0-9]/g, "")),
      lang: z.enum(["ar", "en"]).optional(),
      force: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }): Promise<SendCodeResult> => {
    // Strict limit — this sends email to a real inbox.
    if (!rateLimit(`sendcode:${ipKey()}`, 20, 60_000)) {
      return { status: "failed", reason: "rate limited" };
    }
    if (!data.code) return { status: "skipped", reason: "bad code" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: g } = await supabaseAdmin
      .from("guests")
      .select("id, event_id, code, form_data")
      .ilike("code", data.code)
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

    // Idempotency: one 'sent' email per guest unless the admin forces a resend.
    const { data: existing } = await supabaseAdmin
      .from("deliveries")
      .select("id, status")
      .eq("guest_id", g.id)
      .eq("channel", "email")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.status === "sent" && !data.force) {
      return { status: "sent", reason: "already sent" };
    }

    const origin = appOrigin();
    const galleryUrl = `${origin}/g/${g.code}`;
    const composed = await codeEmail({
      eventName: ev.name,
      code: g.code,
      galleryUrl,
      lang: data.lang,
    });

    const { resendSend } = await import("./delivery/resend");
    const result = await resendSend({
      channel: "email",
      to: email,
      subject: composed.subject,
      html: composed.html,
      text: composed.text,
    });

    const row = {
      guest_id: g.id,
      channel: "email",
      status: result.status,
      destination: email,
      provider_message_id: result.providerMessageId ?? null,
      error: result.error ?? null,
      updated_at: new Date().toISOString(),
    };
    if (existing?.id) {
      await supabaseAdmin.from("deliveries").update(row).eq("id", existing.id);
    } else {
      await supabaseAdmin.from("deliveries").insert(row);
    }

    return { status: result.status, reason: result.error };
  });

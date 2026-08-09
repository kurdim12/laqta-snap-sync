import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";

// Server-side upload authorization.
//
// Storage writes by anon (staff console + guest selfie) previously used a
// blanket anon INSERT/UPDATE policy on storage.objects — anyone with the
// publishable key could write into any live event's folder. That policy is
// dropped (see migration 20260702_0001_lock_storage_writes). Instead, the
// client asks these server functions for short-lived SIGNED UPLOAD URLs. The
// server (service role) authorizes the caller — staff PIN or guest code —
// validates the target path, MIME type, size and count, then mints a one-time
// upload token scoped to that exact object. The client uploads straight to
// storage with `uploadToSignedUrl`, so no anon write policy is needed.
//
// Admins are unaffected: they authenticate and write directly under the
// has_role('admin') storage policies.

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
    // Use the platform-trusted remote address (e.g. Cloudflare's
    // cf-connecting-ip), NOT the client-spoofable X-Forwarded-For — otherwise
    // an attacker rotates a forged header and never trips the limit. NOTE: this
    // Map is per-instance; a shared KV/DB store is the production-grade limiter.
    return getRequestIP() || "anon";
  } catch {
    return "anon";
  }
}

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
]);
const HARD_CEILING = 200 * 1024 * 1024; // 200 MB — matches bucket file_size_limit
const MAX_FILES_PER_CALL = 8; // original + web + thumb (+poster) leaves headroom

interface EventLimits {
  maxPhotoMB: number;
  maxVideoMB: number;
}

function limitsFor(config: unknown): EventLimits {
  const cfg = (config || {}) as { limits?: Partial<EventLimits> };
  return {
    maxPhotoMB: Number(cfg.limits?.maxPhotoMB) || 25,
    maxVideoMB: Number(cfg.limits?.maxVideoMB) || 50,
  };
}

// Validate one requested file against MIME allowlist and the event's size cap,
// returning an error string or null.
function checkFile(
  f: { path: string; contentType: string; bytes: number; kind: string },
  evId: string,
  limits: EventLimits,
): string | null {
  if (!f.path.startsWith(`${evId}/`)) return "path outside event scope";
  if (f.path.includes("..")) return "invalid path";
  if (!ALLOWED_MIME.has(f.contentType)) return `disallowed type ${f.contentType}`;
  const isVideo = f.kind === "video" || f.contentType.startsWith("video/");
  const capMB = isVideo ? limits.maxVideoMB : limits.maxPhotoMB;
  if (f.bytes <= 0 || f.bytes > Math.min(capMB * 1024 * 1024, HARD_CEILING)) {
    return `exceeds ${capMB}MB limit`;
  }
  return null;
}

const fileSchema = z.object({
  path: z.string().min(1).max(512),
  contentType: z.string().min(1).max(128),
  bytes: z.number().int().nonnegative(),
  kind: z.enum(["photo", "video"]),
});

export interface MintedUrl {
  path: string;
  token: string;
  signedUrl: string;
}

// Staff (PIN-gated) upload URL minting.
export const mintStaffUploadUrls = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      slug: z.string().min(1).max(128),
      pin: z.string().min(1).max(32),
      files: z.array(fileSchema).min(1).max(MAX_FILES_PER_CALL),
    }),
  )
  .handler(async ({ data }): Promise<{ urls: MintedUrl[] }> => {
    if (!rateLimit(`mint-staff:${ipKey()}`, 120, 60_000)) {
      throw new Error("Too many requests");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Authorize via the staff PIN (reuses the DB lockout logic).
    const { data: evId } = await supabaseAdmin.rpc("verify_staff_pin", {
      _slug: data.slug,
      _pin: data.pin,
    });
    if (!evId) throw new Error("Unauthorized");

    const { data: ev } = await supabaseAdmin
      .from("events")
      .select("config")
      .eq("id", evId)
      .maybeSingle();
    const limits = limitsFor(ev?.config);

    const urls: MintedUrl[] = [];
    for (const f of data.files) {
      const err = checkFile(f, evId as string, limits);
      if (err) throw new Error(`${f.path}: ${err}`);
      const { data: signed, error } = await supabaseAdmin.storage
        .from("media")
        .createSignedUploadUrl(f.path, { upsert: true });
      if (error || !signed) throw new Error(`could not mint upload for ${f.path}`);
      urls.push({ path: signed.path, token: signed.token, signedUrl: signed.signedUrl });
    }
    return { urls };
  });

// Guest selfie (code-gated) upload URL minting. A guest may only write their
// own selfie object: `${eventId}/selfies/${guestId}.jpg`.
export const mintGuestSelfieUrl = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      eventId: z.string().uuid(),
      guestId: z.string().uuid(),
      // Strip anything outside the code alphabet — ilike treats % and _ as
      // wildcards, so an unsanitized "%" would match any code for a known
      // guest id and bypass the code check.
      code: z
        .string()
        .min(1)
        .max(32)
        .transform((c) => c.toUpperCase().replace(/[^A-Z0-9]/g, "")),
      contentType: z.string().min(1).max(128),
      bytes: z.number().int().nonnegative(),
    }),
  )
  .handler(async ({ data }): Promise<{ url: MintedUrl }> => {
    if (!rateLimit(`mint-selfie:${ipKey()}`, 60, 60_000)) {
      throw new Error("Too many requests");
    }
    if (!data.contentType.startsWith("image/") || !ALLOWED_MIME.has(data.contentType)) {
      throw new Error("disallowed type");
    }
    if (data.bytes <= 0 || data.bytes > 15 * 1024 * 1024) {
      throw new Error("selfie too large");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Authorize: the guest row must exist for this code + event.
    const { data: g } = await supabaseAdmin
      .from("guests")
      .select("id, event_id")
      .eq("id", data.guestId)
      .ilike("code", data.code)
      .maybeSingle();
    if (!g || g.event_id !== data.eventId) throw new Error("Unauthorized");

    // Event must be live/dryrun.
    const { data: ev } = await supabaseAdmin
      .from("events")
      .select("status")
      .eq("id", data.eventId)
      .maybeSingle();
    if (!ev || (ev.status !== "live" && ev.status !== "dryrun")) {
      throw new Error("Event not available");
    }

    const path = `${data.eventId}/selfies/${data.guestId}.jpg`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from("media")
      .createSignedUploadUrl(path, { upsert: true });
    if (error || !signed) throw new Error("could not mint upload");
    return { url: { path: signed.path, token: signed.token, signedUrl: signed.signedUrl } };
  });

// Register the guest's submitted selfie as a real gallery photo after its
// signed upload completes. The guest code proves ownership; a deterministic
// asset id makes retries idempotent. AI processing is started separately so
// registration never waits for a potentially long image generation.
export const registerGuestPhoto = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      eventId: z.string().uuid(),
      guestId: z.string().uuid(),
      code: z
        .string()
        .min(1)
        .max(32)
        .transform((c) => c.toUpperCase().replace(/[^A-Z0-9]/g, "")),
      storagePath: z.string().min(1).max(512),
      bytes: z.number().int().positive().max(15 * 1024 * 1024),
      // LAQTA shirt variant picked at the kiosk; recorded so the portrait can
      // be re-processed externally later with the right garment.
      shirtVariant: z.enum(["black", "graphite", "white"]).nullish(),
    }),
  )
  .handler(async ({ data }): Promise<{ assetId: string; templateMode: string }> => {
    if (!rateLimit(`register-guest-photo:${ipKey()}`, 30, 60_000)) {
      throw new Error("Too many requests");
    }
    const expectedPath = `${data.eventId}/selfies/${data.guestId}.jpg`;
    if (data.storagePath !== expectedPath) throw new Error("path outside guest scope");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: guest } = await supabaseAdmin
      .from("guests")
      .select("id, event_id")
      .eq("id", data.guestId)
      .ilike("code", data.code)
      .maybeSingle();
    if (!guest || guest.event_id !== data.eventId) throw new Error("Unauthorized");

    const { data: event } = await supabaseAdmin
      .from("events")
      .select("status, config, template_mode")
      .eq("id", data.eventId)
      .maybeSingle();
    if (!event || (event.status !== "live" && event.status !== "dryrun")) {
      throw new Error("Event not available");
    }
    const cfg = (event.config || {}) as { gallery?: { requireApproval?: boolean } };
    const approved = cfg.gallery?.requireApproval !== true;
    // AI runs server-side; backdrop is rendered by the browser that uploaded it.
    const templateMode = String(event.template_mode ?? "none");
    const processStatus = templateMode === "ai" || templateMode === "backdrop" ? "pending" : "done";

    const { error } = await supabaseAdmin.from("assets").upsert({
      id: data.guestId,
      event_id: data.eventId,
      guest_id: data.guestId,
      parent_asset_id: null,
      kind: "photo",
      variant: "original",
      storage_path: data.storagePath,
      content_type: "image/jpeg",
      bytes: data.bytes,
      status: "ready",
      approved,
      original_url: data.storagePath,
      process_status: processStatus,
      error_message: null,
    }, { onConflict: "id" });
    if (error) throw new Error(`could not register guest photo: ${error.message}`);
    return { assetId: data.guestId, templateMode };
  });

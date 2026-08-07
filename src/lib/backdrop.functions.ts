import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";

// Backdrop treatment support (template_mode = 'backdrop').
//
// The cutout + gradient render happens in the guest's / staff's browser (no AI,
// no provider, $0 per photo). These functions only authorize the caller, mint a
// signed upload URL for the processed JPEG, and record the result on the asset
// row — the same columns the AI pipeline writes, so galleries and the wall need
// no special-casing.

const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (b.count >= max) return false;
  b.count++;
  return true;
}
function ipKey(): string {
  try { return getRequestIP() || "anon"; } catch { return "anon"; }
}

const authShape = {
  assetId: z.string().uuid(),
  slug: z.string().max(128).nullish(),
  pin: z.string().max(16).nullish(),
  code: z.string().max(32).nullish(),
  guestId: z.string().uuid().nullish(),
};

type Auth = { assetId: string; slug?: string | null; pin?: string | null; code?: string | null; guestId?: string | null };

/** Resolve the event this caller may act on, and confirm the asset is in it. */
async function authorizeAsset(data: Auth): Promise<{ eventId: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let eventId: string | null = null;

  if (data.slug && data.pin) {
    const { data: ev } = await supabaseAdmin.rpc("verify_staff_pin", { _slug: data.slug, _pin: data.pin });
    eventId = (ev as string | null) ?? null;
  } else if (data.code && data.guestId) {
    const { data: guest } = await supabaseAdmin
      .from("guests")
      .select("id, event_id")
      .eq("id", data.guestId)
      .ilike("code", data.code.toUpperCase().replace(/[^A-Z0-9]/g, ""))
      .maybeSingle();
    eventId = guest?.event_id ?? null;
  }
  if (!eventId) throw new Error("Unauthorized");

  const { data: asset } = await supabaseAdmin
    .from("assets")
    .select("id, event_id")
    .eq("id", data.assetId)
    .maybeSingle();
  if (!asset || asset.event_id !== eventId) throw new Error("Unauthorized");
  return { eventId };
}

export const mintBackdropUpload = createServerFn({ method: "POST" })
  .inputValidator(z.object({ ...authShape, bytes: z.number().int().positive().max(20 * 1024 * 1024) }))
  .handler(async ({ data }): Promise<{ path: string; token: string }> => {
    if (!rateLimit(`backdrop-mint:${ipKey()}`, 60, 60_000)) throw new Error("Too many requests");
    const { eventId } = await authorizeAsset(data);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = `${eventId}/processed/${data.assetId}.jpg`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from("media")
      .createSignedUploadUrl(path, { upsert: true });
    if (error || !signed) throw new Error(error?.message || "could not authorize upload");
    return { path: signed.path, token: signed.token };
  });

export const finishBackdrop = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      ...authShape,
      ok: z.boolean(),
      storagePath: z.string().max(512).nullish(),
      error: z.string().max(4000).nullish(),
      ms: z.number().int().nonnegative().max(600_000).nullish(),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    if (!rateLimit(`backdrop-finish:${ipKey()}`, 60, 60_000)) throw new Error("Too many requests");
    const { eventId } = await authorizeAsset(data);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.ok && data.storagePath) {
      const expected = `${eventId}/processed/${data.assetId}.jpg`;
      if (data.storagePath !== expected) throw new Error("path outside event scope");
      await supabaseAdmin
        .from("assets")
        .update({
          process_status: "done",
          processed_url: data.storagePath,
          generation_cost: 0,
          generation_model: "backdrop/canvas",
          error_message: null,
          processing_finished_at: new Date().toISOString(),
        })
        .eq("id", data.assetId);
    } else {
      await supabaseAdmin
        .from("assets")
        .update({
          process_status: "failed",
          error_message: (data.error || "backdrop render failed").slice(0, 4000),
          processing_finished_at: new Date().toISOString(),
        })
        .eq("id", data.assetId);
    }
    return { ok: true };
  });

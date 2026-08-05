import { createFileRoute } from "@tanstack/react-router";

// Fire-and-forget hook that kicks the AI template for one uploaded photo.
// Public prefix (no site auth) — the caller proves it is staff for this event
// with the event slug + staff PIN, exactly like the upload URL minting.

// Per-PIN rate limit: 30 requests / minute / event PIN (per worker instance).
const buckets = new Map<string, { count: number; resetAt: number }>();
function allow(key: string, max = 30, windowMs = 60_000): boolean {
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

export const Route = createFileRoute("/api/public/process-photo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { assetId?: string; slug?: string; pin?: string; guestId?: string; code?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        const assetId = String(body.assetId || "");
        const slug = String(body.slug || "");
        const pin = String(body.pin || "");
        const guestId = String(body.guestId || "");
        const code = String(body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        const staffAuth = !!slug && !!pin;
        const guestAuth = /^[0-9a-f-]{36}$/i.test(guestId) && !!code;
        if (!/^[0-9a-f-]{36}$/i.test(assetId) || (!staffAuth && !guestAuth)) {
          return new Response("Bad request", { status: 400 });
        }

        // Rate limit before any DB or provider work — over-limit requests never
        // consume a generation slot.
        const authKey = staffAuth ? `staff:${slug}:${pin}` : `guest:${guestId}:${code}`;
        if (!allow(authKey)) {
          return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let evId: string | null = null;
        if (staffAuth) {
          const { data } = await supabaseAdmin.rpc("verify_staff_pin", { _slug: slug, _pin: pin });
          evId = data || null;
        } else {
          const { data: guest } = await supabaseAdmin
            .from("guests")
            .select("event_id")
            .eq("id", guestId)
            .ilike("code", code)
            .maybeSingle();
          evId = guest?.event_id || null;
        }
        if (!evId) return new Response("Unauthorized", { status: 401 });

        const { data: asset } = await supabaseAdmin
          .from("assets")
          .select("event_id, guest_id")
          .eq("id", assetId)
          .maybeSingle();
        if (!asset || asset.event_id !== evId || (guestAuth && asset.guest_id !== guestId)) {
          return new Response("Not found", { status: 404 });
        }

        const { processAssetById } = await import("@/lib/photo-processing.server");
        const result = await processAssetById(assetId);
        return Response.json(result);
      },
    },
  },
});

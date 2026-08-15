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
        let body: { assetId?: string; slug?: string; pin?: string; guestId?: string; code?: string; sessionId?: string };
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
        const sessionId = String(body.sessionId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
        const staffAuth = !!slug && !!pin;
        const guestAuth = /^[0-9a-f-]{36}$/i.test(guestId) && !!code;
        // Anonymous kiosk/session flow: the caller proves it owns the asset by
        // presenting the same opaque session id the asset was created with.
        const sessionAuth = sessionId.length >= 16;
        if (!/^[0-9a-f-]{36}$/i.test(assetId) || (!staffAuth && !guestAuth && !sessionAuth)) {
          return new Response("Bad request", { status: 400 });
        }

        // Rate limit before any DB or provider work — over-limit requests never
        // consume a generation slot.
        const authKey = staffAuth ? `staff:${slug}:${pin}` : guestAuth ? `guest:${guestId}:${code}` : `session:${sessionId}`;
        if (!allow(authKey)) {
          return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let evId: string | null = null;
        if (staffAuth) {
          const { data } = await supabaseAdmin.rpc("verify_staff_pin", { _slug: slug, _pin: pin });
          evId = data || null;
        } else if (guestAuth) {
          const { data: guest } = await supabaseAdmin
            .from("guests")
            .select("event_id")
            .eq("id", guestId)
            .ilike("code", code)
            .maybeSingle();
          evId = guest?.event_id || null;
        }

        const { data: asset } = await supabaseAdmin
          .from("assets")
          .select("event_id, guest_id, session_id")
          .eq("id", assetId)
          .maybeSingle();
        if (!asset) return new Response("Not found", { status: 404 });
        if (sessionAuth && !staffAuth && !guestAuth) {
          if ((asset as { session_id?: string | null }).session_id !== sessionId) {
            return new Response("Unauthorized", { status: 401 });
          }
          evId = asset.event_id;
        }
        if (!evId) return new Response("Unauthorized", { status: 401 });
        if (asset.event_id !== evId || (guestAuth && asset.guest_id !== guestId)) {
          return new Response("Not found", { status: 404 });
        }


        console.log("[process-photo] entry", { assetId, eventId: evId, auth: staffAuth ? "staff" : "guest" });
        const { executionContextFor } = await import("@/lib/execution-context.server");
        const context = executionContextFor(request);
        const { processAssetById } = await import("@/lib/photo-processing.server");
        // Detached runs get a shorter provider timeout: Workers cancel
        // waitUntil work ~30s after the response, so the abort must fire first.
        const work = processAssetById(assetId, { detached: !!context }).then((result) => {
          console.log("[process-photo] result", { assetId, ...result });
          return result;
        });
        if (context) {
          context.waitUntil(work);
          return Response.json({ ok: true, status: "accepted" }, { status: 202 });
        }
        // Local development has no Worker execution context, so await the same
        // work instead of silently abandoning it.
        return Response.json(await work);
      },
    },
  },
});

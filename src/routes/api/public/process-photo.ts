import { createFileRoute } from "@tanstack/react-router";

// Fire-and-forget hook that kicks the AI template for one uploaded photo.
// Public prefix (no site auth) — the caller proves it is staff for this event
// with the event slug + staff PIN, exactly like the upload URL minting.
export const Route = createFileRoute("/api/public/process-photo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { assetId?: string; slug?: string; pin?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        const assetId = String(body.assetId || "");
        const slug = String(body.slug || "");
        const pin = String(body.pin || "");
        if (!/^[0-9a-f-]{36}$/i.test(assetId) || !slug || !pin) {
          return new Response("Bad request", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: evId } = await supabaseAdmin.rpc("verify_staff_pin", { _slug: slug, _pin: pin });
        if (!evId) return new Response("Unauthorized", { status: 401 });

        const { data: asset } = await supabaseAdmin
          .from("assets")
          .select("event_id")
          .eq("id", assetId)
          .maybeSingle();
        if (!asset || asset.event_id !== evId) return new Response("Not found", { status: 404 });

        const { processAssetById } = await import("@/lib/photo-processing.server");
        const result = await processAssetById(assetId);
        return Response.json(result);
      },
    },
  },
});

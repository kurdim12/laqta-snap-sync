import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Admin-only template tooling: try a prompt on a sample photo before going
// live, and re-run the template on a photo that failed.

async function assertAdmin(context: { supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> }; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (data !== true) throw new Error("Forbidden");
}

/** One provider call's evidence: exact request body (no API key — that only
 * ever travels in a header) and the raw, untruncated provider response. */
export interface ProviderAttempt {
  attempt: number;
  requestBody: string;
  responseStatus: number | null;
  responseBody: string | null;
  transportError: string | null;
  recordedAt: string;
}

export const testTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      prompt: z.string().min(1).max(4000),
      imageDataUrl: z.string().min(32).max(12_000_000),
      referenceDataUrl: z.string().max(12_000_000).nullish(),
      /** ordered extra scene references (car, location) */
      extraReferenceUrls: z.array(z.string().max(12_000_000)).max(4).nullish(),

      quality: z.enum(["low", "medium", "high"]).default("medium"),
      aspectRatio: z.string().max(32).default("1024x1024"),
      model: z.string().max(120).nullish(),
      eventId: z.string().uuid().nullish(),
    }),
  )
  .handler(async ({ data, context }): Promise<{
    ok: boolean;
    dataUrl?: string;
    ms?: number;
    cost?: number;
    costIsActual?: boolean;
    model?: string;
    error?: string;
    attempts?: ProviderAttempt[];
  }> => {
    await assertAdmin(context as never);
    const { generateStyled } = await import("@/lib/ai-template.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = (context as unknown as { userId: string }).userId;
    // Same evidence trail as guest processing: every attempt's outgoing request
    // body and raw provider response, returned to the Template panel verbatim.
    const attempts: ProviderAttempt[] = [];
    try {
      // Test runs never touch the event's generation cap, but they are logged
      // so total testing spend stays visible in admin.
      const r = await generateStyled({
        prompt: data.prompt,
        imageDataUrl: data.imageDataUrl,
        referenceDataUrl: data.referenceDataUrl ?? null,
        extraReferenceUrls: data.extraReferenceUrls ?? null,

        quality: data.quality,
        aspectRatio: data.aspectRatio,
        model: data.model ?? null,
        onAttempt: async (a) => { attempts.push(a); },
      });
      await supabaseAdmin.from("template_test_runs").insert({
        event_id: data.eventId ?? null,
        user_id: userId,
        model: r.model,
        cost: r.cost,
        ms: r.ms,
        ok: true,
      } as never);
      return { ok: true, dataUrl: r.dataUrl, ms: r.ms, cost: r.cost, costIsActual: r.costIsActual, model: r.model, attempts };
    } catch (e) {
      const { modelId } = await import("@/lib/ai-template.server");
      await supabaseAdmin.from("template_test_runs").insert({
        event_id: data.eventId ?? null,
        user_id: userId,
        model: modelId(data.model ?? null),
        cost: 0,
        ms: 0,
        ok: false,
      } as never);
      return { ok: false, error: (e as Error).message, attempts };
    }
  });

export const reprocessAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ assetId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { processAssetById } = await import("@/lib/photo-processing.server");
    return processAssetById(data.assetId);
  });

export const sweepEventProcessing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ eventId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { sweepStaleProcessing } = await import("@/lib/photo-processing.server");
    return { swept: await sweepStaleProcessing(data.eventId) };
  });

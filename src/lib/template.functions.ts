import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Admin-only template tooling: try a prompt on a sample photo before going
// live, and re-run the template on a photo that failed.

async function assertAdmin(context: { supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> }; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (data !== true) throw new Error("Forbidden");
}

export const testTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      prompt: z.string().min(1).max(4000),
      imageDataUrl: z.string().min(32).max(12_000_000),
      referenceDataUrl: z.string().max(12_000_000).nullish(),
      quality: z.enum(["low", "medium", "high"]).default("medium"),
      aspectRatio: z.string().max(32).default("1024x1024"),
    }),
  )
  .handler(async ({ data, context }): Promise<{
    ok: boolean;
    dataUrl?: string;
    ms?: number;
    cost?: number;
    model?: string;
    error?: string;
  }> => {
    await assertAdmin(context as never);
    const { generateStyled } = await import("@/lib/ai-template.server");
    try {
      const r = await generateStyled({
        prompt: data.prompt,
        imageDataUrl: data.imageDataUrl,
        referenceDataUrl: data.referenceDataUrl ?? null,
        quality: data.quality,
        aspectRatio: data.aspectRatio,
      });
      return { ok: true, dataUrl: r.dataUrl, ms: r.ms, cost: r.cost, model: r.model };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
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

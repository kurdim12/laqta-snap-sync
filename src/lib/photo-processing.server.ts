// Server-only: runs an event's AI photo template over one asset.
//
// Flow: check the spend cap -> mark processing -> download the original ->
// call the AI provider (120s timeout, one retry on 5xx/network only) ->
// upload the JPEG result to `${eventId}/processed/${assetId}.jpg` -> record
// processed_url, model, actual cost and timings. Failures are recorded on the
// row and the original stays intact, so the guest always gets a photo (the
// gallery then falls back to the branded frame overlay).

import { generateStyled, dataUrlToBytes, bytesToDataUrl, AI_DETACHED_TIMEOUT_MS } from "./ai-template.server";

export interface ProcessResult {
  ok: boolean;
  status: "done" | "failed" | "skipped";
  error?: string;
  ms?: number;
  model?: string;
  cost?: number;
}

export async function sweepStaleProcessing(eventId?: string): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cutoff = new Date(Date.now() - 3 * 60_000).toISOString();
  let query = supabaseAdmin
    .from("assets")
    .update({
      process_status: "failed",
      error_message: "Timed out",
      processing_finished_at: new Date().toISOString(),
    })
    .eq("process_status", "processing")
    // A NULL processing_started_at (row claimed by pre-timestamp code) must
    // sweep too — `.lt` alone never matches NULL, leaving the row stuck forever.
    .or(`processing_started_at.is.null,processing_started_at.lt.${cutoff}`);
  if (eventId) query = query.eq("event_id", eventId);
  const { data, error } = await query.select("id");
  if (error) throw new Error(`stale processing sweep failed: ${error.message}`);
  return data?.length ?? 0;
}

export async function processAssetById(
  assetId: string,
  opts?: { detached?: boolean },
): Promise<ProcessResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: asset } = await supabaseAdmin
    .from("assets")
    .select("id, event_id, kind, variant, storage_path, content_type, process_status, processing_started_at")
    .eq("id", assetId)
    .maybeSingle();
  if (!asset) return { ok: false, status: "failed", error: "asset not found" };
  if (asset.kind !== "photo" || asset.variant !== "original") {
    return { ok: true, status: "skipped" };
  }
  const staleCutoff = Date.now() - 3 * 60_000;
  const processingStarted = asset.processing_started_at ? new Date(asset.processing_started_at).getTime() : 0;
  if (asset.process_status === "processing" && processingStarted > staleCutoff) {
    return { ok: true, status: "skipped" };
  }

  const { data: ev } = await supabaseAdmin
    .from("events")
    .select("id, template_mode, template_prompt, template_reference_url, template_quality, template_aspect_ratio, template_model, car_reference_url, location_reference_url, requires_ref_images")
    .eq("id", asset.event_id)
    .maybeSingle();
  if (!ev || ev.template_mode !== "ai" || !ev.template_prompt) {
    console.log("[processAsset] skipped", { assetId, mode: ev?.template_mode, hasPrompt: !!ev?.template_prompt });
    return { ok: true, status: "skipped" };
  }

  // Events that compose the guest with fixed scene references (car + location)
  // must not burn a generation before both are uploaded — the model would
  // invent them.
  const evx = ev as unknown as {
    car_reference_url?: string | null;
    location_reference_url?: string | null;
    requires_ref_images?: boolean | null;
  };
  if (evx.requires_ref_images && (!evx.car_reference_url || !evx.location_reference_url)) {
    const message = "Missing car or location reference image — upload both in Admin → Template.";
    await supabaseAdmin
      .from("assets")
      .update({
        process_status: "failed",
        error_message: message,
        processing_finished_at: new Date().toISOString(),
      })
      .eq("id", assetId);
    return { ok: false, status: "failed", error: message };
  }


  const started = Date.now();

  // Atomically claim the asset before consuming a paid generation. The guest
  // gallery may retry a pending trigger, so only one request may proceed.
  let claimQuery = supabaseAdmin
    .from("assets")
    .update({
      process_status: "processing",
      original_url: asset.storage_path,
      error_message: null,
      processing_started_at: new Date().toISOString(),
    })
    .eq("id", assetId);
  claimQuery = asset.process_status === "processing"
    ? claimQuery.eq("process_status", "processing").lt("processing_started_at", new Date(staleCutoff).toISOString())
    : claimQuery.neq("process_status", "processing");
  const { data: claimed } = await claimQuery.select("id").maybeSingle();
  if (!claimed) return { ok: true, status: "skipped" };

  // Spend cap: consume a slot atomically BEFORE the paid call, so concurrent
  // uploads can never overshoot. One photo consumes at most one slot — the
  // provider-level retry happens inside generateStyled and does not re-consume.
  const { data: allowed } = await supabaseAdmin.rpc("consume_generation", { _event_id: asset.event_id });
  if (allowed !== true) {
    await supabaseAdmin
      .from("assets")
      .update({
        process_status: "failed",
        original_url: asset.storage_path,
        error_message: "Generation cap reached",
        processing_finished_at: new Date().toISOString(),
      })
      .eq("id", assetId);
    return { ok: false, status: "failed", error: "Generation cap reached" };
  }

  try {
    const { data: file, error: dlErr } = await supabaseAdmin.storage
      .from("media")
      .download(asset.storage_path);
    if (dlErr || !file) throw new Error("could not read the original photo");
    const imageDataUrl = bytesToDataUrl(await file.arrayBuffer(), asset.content_type || "image/jpeg");

    const ref = ev.template_reference_url;
    const result = await generateStyled({
      prompt: ev.template_prompt,
      imageDataUrl,
      referenceDataUrl: ref && ref.startsWith("data:") ? ref : null,
      // Ordered scene references: car, then location.
      extraReferenceUrls: [evx.car_reference_url || null, evx.location_reference_url || null],

      quality: ev.template_quality,
      aspectRatio: ev.template_aspect_ratio,
      model: (ev as { template_model?: string | null }).template_model ?? null,
      // Detached (waitUntil) runs are killed by Workers ~30s after the 202
      // response; abort well before that so THIS code marks the row failed.
      timeoutMs: opts?.detached ? AI_DETACHED_TIMEOUT_MS : null,
      onAttempt: async (attempt) => {
        const { data: current } = await supabaseAdmin
          .from("assets")
          .select("meta")
          .eq("id", assetId)
          .maybeSingle();
        const meta = (current?.meta && typeof current.meta === "object" && !Array.isArray(current.meta)
          ? current.meta
          : {}) as Record<string, unknown>;
        const previous = Array.isArray(meta.ai_provider_attempts) ? meta.ai_provider_attempts : [];
        await supabaseAdmin
          .from("assets")
          .update({ meta: { ...meta, ai_provider_attempts: [...previous, attempt] } as never })
          .eq("id", assetId);
      },
    });

    const { bytes, contentType } = dataUrlToBytes(result.dataUrl);
    const ext = contentType.includes("png") ? "png" : "jpg";
    const outPath = `${asset.event_id}/processed/${assetId}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("media")
      .upload(outPath, bytes, { contentType, upsert: true });
    if (upErr) throw new Error(`could not save the processed photo: ${upErr.message}`);

    await supabaseAdmin
      .from("assets")
      .update({
        process_status: "done",
        processed_url: outPath,
        generation_cost: result.cost,
        generation_model: result.model,
        error_message: null,
        processing_finished_at: new Date().toISOString(),
      })
      .eq("id", assetId);

    return { ok: true, status: "done", ms: Date.now() - started, model: result.model, cost: result.cost };
  } catch (e) {
    // Store the provider message verbatim (untruncated) so ZodError paths and
    // policy refusals are fully readable in the Diagnostics panel.
    const message = (e as Error).message || "processing failed";
    console.error("[processAsset] failed", { assetId, message });
    await supabaseAdmin
      .from("assets")
      .update({
        process_status: "failed",
        error_message: message,
        processing_finished_at: new Date().toISOString(),
      })
      .eq("id", assetId);
    return { ok: false, status: "failed", error: message, ms: Date.now() - started };
  }
}

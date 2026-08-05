// Server-only: runs an event's AI photo template over one asset.
//
// Flow: check the spend cap -> mark processing -> download the original ->
// call the AI provider (120s timeout, one retry on 5xx/network only) ->
// upload the JPEG result to `${eventId}/processed/${assetId}.jpg` -> record
// processed_url, model, actual cost and timings. Failures are recorded on the
// row and the original stays intact, so the guest always gets a photo (the
// gallery then falls back to the branded frame overlay).

import { generateStyled, dataUrlToBytes, bytesToDataUrl } from "./ai-template.server";

export interface ProcessResult {
  ok: boolean;
  status: "done" | "failed" | "skipped";
  error?: string;
  ms?: number;
  model?: string;
  cost?: number;
}

export async function processAssetById(assetId: string): Promise<ProcessResult> {
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
    .select("id, template_mode, template_prompt, template_reference_url, template_quality, template_aspect_ratio")
    .eq("id", asset.event_id)
    .maybeSingle();
  if (!ev || ev.template_mode !== "ai" || !ev.template_prompt) {
    return { ok: true, status: "skipped" };
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
      quality: ev.template_quality,
      aspectRatio: ev.template_aspect_ratio,
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
    // Store the provider message verbatim so policy refusals are distinguishable.
    const message = (e as Error).message || "processing failed";
    await supabaseAdmin
      .from("assets")
      .update({
        process_status: "failed",
        error_message: message.slice(0, 500),
        processing_finished_at: new Date().toISOString(),
      })
      .eq("id", assetId);
    return { ok: false, status: "failed", error: message, ms: Date.now() - started };
  }
}

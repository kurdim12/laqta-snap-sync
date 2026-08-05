// Server-only: runs an event's AI photo template over one asset.
//
// Flow: mark processing -> download the original from storage -> call the AI
// provider -> upload the result to `${eventId}/processed/${assetId}.png` ->
// record processed_url + cost + timings. Failures are recorded on the row and
// the original stays intact, so the guest always gets a photo.

import { generateStyled, dataUrlToBytes, bytesToDataUrl } from "./ai-template.server";

export interface ProcessResult {
  ok: boolean;
  status: "done" | "failed" | "skipped";
  error?: string;
  ms?: number;
}

export async function processAssetById(assetId: string): Promise<ProcessResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: asset } = await supabaseAdmin
    .from("assets")
    .select("id, event_id, kind, variant, storage_path, content_type, process_status")
    .eq("id", assetId)
    .maybeSingle();
  if (!asset) return { ok: false, status: "failed", error: "asset not found" };
  if (asset.kind !== "photo" || asset.variant !== "original") {
    return { ok: true, status: "skipped" };
  }
  if (asset.process_status === "processing" || asset.process_status === "done") {
    if (asset.process_status === "processing") return { ok: true, status: "skipped" };
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
  await supabaseAdmin
    .from("assets")
    .update({
      process_status: "processing",
      original_url: asset.storage_path,
      error_message: null,
      processing_started_at: new Date().toISOString(),
    })
    .eq("id", assetId);

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
    const outPath = `${asset.event_id}/processed/${assetId}.png`;
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
        error_message: null,
        processing_finished_at: new Date().toISOString(),
      })
      .eq("id", assetId);

    return { ok: true, status: "done", ms: Date.now() - started };
  } catch (e) {
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

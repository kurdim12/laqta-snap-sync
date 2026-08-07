import { supabase } from "@/integrations/supabase/client";
import { renderBackdrop, type BackdropSettings } from "./backdrop";
import { mintBackdropUpload, finishBackdrop } from "./backdrop.functions";

type Auth = { slug?: string; pin?: string; code?: string; guestId?: string };

/**
 * Full browser-side backdrop pipeline for one asset: render -> signed upload ->
 * record on the asset row. Never throws — a failure is recorded so the gallery
 * falls back to the original photo instead of hanging on "processing".
 */
export async function applyBackdrop(opts: {
  source: Blob;
  assetId: string;
  settings: BackdropSettings;
  auth: Auth;
}): Promise<boolean> {
  const started = Date.now();
  const base = { assetId: opts.assetId, ...opts.auth };
  try {
    const out = await renderBackdrop(opts.source, opts.settings, opts.assetId);
    const { path, token } = await mintBackdropUpload({ data: { ...base, bytes: out.size } });
    const { error } = await supabase.storage
      .from("media")
      .uploadToSignedUrl(path, token, out, { contentType: "image/jpeg" });
    if (error) throw error;
    await finishBackdrop({ data: { ...base, ok: true, storagePath: path, ms: Date.now() - started } });
    return true;
  } catch (e) {
    try {
      await finishBackdrop({
        data: { ...base, ok: false, error: (e as Error).message || "backdrop failed", ms: Date.now() - started },
      });
    } catch { /* the sweeper will time the row out */ }
    return false;
  }
}

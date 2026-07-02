// OpenRouter image generation (Phase 7.1). Server-only: reads OPENROUTER_API_KEY
// at request time; returns 'skipped' when unset (like the Resend provider) so
// the flow is wired before the key exists. The prompt is composed SERVER-SIDE
// from the admin style prompt + preset — guests never inject prompt text — and
// the reference image must be the guest's OWN enrolled selfie only.
import process from "node:process";

export interface GenerateInput {
  /** e.g. "google/gemini-3.1-flash-image" (Nano Banana 2). */
  model: string;
  /** Server-composed prompt. Never guest free-text. */
  prompt: string;
  /** The guest's own enrolled selfie URL — nothing else. */
  referenceImageUrl: string;
  aspectRatio?: string;
}

export interface GenerateResult {
  status: "done" | "failed" | "skipped";
  imageBase64?: string;
  costUsd?: number;
  error?: string;
}

export async function generatePortrait(input: GenerateInput): Promise<GenerateResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { status: "skipped", error: "OPENROUTER_API_KEY not configured" };
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        input_references: [{ type: "image_url", image_url: input.referenceImageUrl }],
        ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return { status: "failed", error: `OpenRouter ${resp.status}: ${body.slice(0, 200)}` };
    }
    const data = (await resp.json().catch(() => ({}))) as {
      data?: { b64_json?: string }[];
      usage?: { cost?: number };
    };
    const b64 = data.data?.[0]?.b64_json;
    return {
      status: b64 ? "done" : "failed",
      imageBase64: b64,
      costUsd: data.usage?.cost,
      error: b64 ? undefined : "no image in response",
    };
  } catch (e) {
    return { status: "failed", error: (e as Error).message };
  }
}

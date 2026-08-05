// Server-only AI photo template engine.
//
// Calls OpenRouter with an image-output model, passing the guest photo (and an
// optional style reference image) as data URLs. Never imported from client code.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type Quality = "low" | "medium" | "high";

// Rough per-image estimates (USD) so the admin sees a cost signal. Not billing.
const COST: Record<Quality, number> = { low: 0.02, medium: 0.07, high: 0.19 };

export function estimateCost(q: string | null | undefined): number {
  return COST[(q as Quality) || "medium"] ?? COST.medium;
}

export function modelId(): string {
  return process.env["AI_IMAGE_MODEL"] || "openai/gpt-image-1";
}

export interface GenerateInput {
  prompt: string;
  /** data URL of the source photo */
  imageDataUrl: string;
  /** optional data URL of a style reference */
  referenceDataUrl?: string | null;
  quality?: string | null;
  aspectRatio?: string | null;
}

export interface GenerateResult {
  dataUrl: string;
  ms: number;
  cost: number;
  model: string;
}

function extractImage(json: unknown): string | null {
  const msg = (json as { choices?: { message?: Record<string, unknown> }[] })?.choices?.[0]?.message;
  if (!msg) return null;
  // OpenRouter image-output shape
  const images = msg["images"] as { image_url?: { url?: string } }[] | undefined;
  if (Array.isArray(images)) {
    for (const im of images) {
      const u = im?.image_url?.url;
      if (typeof u === "string" && u.startsWith("data:")) return u;
    }
  }
  // Multimodal content-parts shape
  const content = msg["content"];
  if (Array.isArray(content)) {
    for (const part of content as { type?: string; image_url?: { url?: string } }[]) {
      const u = part?.image_url?.url;
      if (typeof u === "string" && u.startsWith("data:")) return u;
    }
  }
  return null;
}

export async function generateStyled(input: GenerateInput): Promise<GenerateResult> {
  const key = process.env["OPENROUTER_API_KEY"];
  if (!key) throw new Error("OPENROUTER_API_KEY is not configured");

  const model = modelId();
  const started = Date.now();

  const parts: Record<string, unknown>[] = [
    {
      type: "text",
      text:
        `${input.prompt}\n\n` +
        `Keep the person's face, identity and pose recognisable. ` +
        `Target output size ${input.aspectRatio || "1024x1024"}, ${input.quality || "medium"} quality.` +
        (input.referenceDataUrl ? ` The second image is the STYLE REFERENCE — match its look, colour and treatment.` : ""),
    },
    { type: "image_url", image_url: { url: input.imageDataUrl } },
  ];
  if (input.referenceDataUrl) {
    parts.push({ type: "image_url", image_url: { url: input.referenceDataUrl } });
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "LAQTA",
    },
    body: JSON.stringify({
      model,
      modalities: ["image", "text"],
      messages: [{ role: "user", content: parts }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI provider ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = await res.json();
  const dataUrl = extractImage(json);
  if (!dataUrl) {
    throw new Error("AI provider returned no image — check the model supports image output");
  }
  return {
    dataUrl,
    ms: Date.now() - started,
    cost: estimateCost(input.quality),
    model,
  };
}

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error("invalid data URL");
  const contentType = m[1] || "image/png";
  const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return { bytes, contentType };
}

export function bytesToDataUrl(bytes: ArrayBuffer, contentType: string): string {
  const b = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return `data:${contentType};base64,${btoa(s)}`;
}

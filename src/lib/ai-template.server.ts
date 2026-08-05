// Server-only AI photo template engine.
//
// Calls OpenRouter with an image-output model, passing the guest photo (and an
// optional style reference image) as data URLs. Never imported from client code.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Hard wall-clock timeout for a single provider call. */
export const AI_TIMEOUT_MS = 120_000;

export type Quality = "low" | "medium" | "high";

// Rough per-image estimates (USD), used only when the provider does not report
// a real usage.cost. Real generations report the actual figure.
const COST: Record<Quality, number> = { low: 0.02, medium: 0.07, high: 0.19 };

export function estimateCost(q: string | null | undefined): number {
  return COST[(q as Quality) || "medium"] ?? COST.medium;
}

export function modelId(): string {
  return process.env["AI_IMAGE_MODEL"] || "openai/gpt-image-2";
}

export interface GenerateInput {
  prompt: string;
  /** data URL (or https URL) of the source photo — ALWAYS the first reference */
  imageDataUrl: string;
  /** optional second reference, e.g. a flat photo of the branded shirt */
  referenceDataUrl?: string | null;
  quality?: string | null;
  aspectRatio?: string | null;
}

export interface GenerateResult {
  dataUrl: string;
  ms: number;
  /** actual usage.cost from the provider when reported, else an estimate */
  cost: number;
  /** true when `cost` came from the provider rather than our estimate */
  costIsActual: boolean;
  model: string;
}

/** Guest photo first, style reference (if any) second — order matters. */
export function buildInputReferences(
  photoUrl: string,
  referenceUrl?: string | null,
): { type: "image_url"; image_url: { url: string } }[] {
  const refs: { type: "image_url"; image_url: { url: string } }[] = [
    { type: "image_url", image_url: { url: photoUrl } },
  ];
  if (referenceUrl) refs.push({ type: "image_url", image_url: { url: referenceUrl } });
  return refs;
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

class ProviderError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message);
  }
}

export async function generateStyled(input: GenerateInput): Promise<GenerateResult> {
  const key = process.env["OPENROUTER_API_KEY"];
  if (!key) throw new Error("OPENROUTER_API_KEY is not configured");

  const model = modelId();
  const started = Date.now();

  const references = buildInputReferences(input.imageDataUrl, input.referenceDataUrl);
  const parts: Record<string, unknown>[] = [
    {
      type: "text",
      text:
        `${input.prompt}\n\n` +
        `Keep the person's face, identity and pose recognisable. ` +
        `Target output size ${input.aspectRatio || "1024x1024"}, ${input.quality || "medium"} quality.` +
        (input.referenceDataUrl
          ? ` The FIRST image is the guest photo. The SECOND image is the STYLE REFERENCE (e.g. the branded shirt) — match its look, colour, logo and treatment.`
          : ""),
    },
    ...references,
  ];

  const body = JSON.stringify({
    model,
    modalities: ["image", "text"],
    output_format: "jpeg",
    output_compression: 85,
    input_references: references,
    messages: [{ role: "user", content: parts }],
  });

  // One call. Retried ONCE by the caller loop below, and only on 5xx/network.
  async function callOnce(): Promise<{ json: unknown }> {
    let res: Response;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": "LAQTA",
        },
        body,
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
    } catch (e) {
      const err = e as Error;
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        // Timeouts are NOT retried — a second 120s wait doubles the stall.
        throw new ProviderError("Timeout after 120s", 408, false);
      }
      throw new ProviderError(`Network error: ${err.message}`, 0, true);
    }
    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      // 4xx (including content-policy refusals) are terminal — never retried.
      throw new ProviderError(`AI provider ${res.status}: ${text}`, res.status, res.status >= 500);
    }
    return { json: await res.json() };
  }

  let json: unknown;
  try {
    json = (await callOnce()).json;
  } catch (e) {
    const err = e as ProviderError;
    if (!(err instanceof ProviderError) || !err.retryable) throw err;
    json = (await callOnce()).json;
  }

  const dataUrl = extractImage(json);
  if (!dataUrl) {
    throw new Error("AI provider returned no image — check the model supports image output");
  }
  const usageCost = (json as { usage?: { cost?: number } })?.usage?.cost;
  return {
    dataUrl,
    ms: Date.now() - started,
    cost: typeof usageCost === "number" ? usageCost : estimateCost(input.quality),
    costIsActual: typeof usageCost === "number",
    model,
  };
}

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error("invalid data URL");
  const contentType = m[1] || "image/jpeg";
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

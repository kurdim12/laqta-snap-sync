// Server-only AI photo template engine.
//
// Calls OpenRouter's DEDICATED Images API (POST /api/v1/images) with the guest
// photo (and an optional style reference image) as input_references.
// Never imported from client code.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/images";

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
  // openai/gpt-image-2 is served by the Images API endpoint above (it is not a
  // chat-completions model). Override with AI_IMAGE_MODEL if ever needed.
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
  onAttempt?: (attempt: {
    attempt: number;
    requestBody: string;
    responseStatus: number | null;
    responseBody: string | null;
    transportError: string | null;
    recordedAt: string;
  }) => Promise<void>;
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
  // OpenRouter Images API: { data: [{ b64_json, media_type }] }
  const data = (json as { data?: { b64_json?: string; media_type?: string; url?: string }[] })?.data;
  if (Array.isArray(data) && data.length) {
    const first = data[0];
    if (first?.b64_json) return `data:${first.media_type || "image/jpeg"};base64,${first.b64_json}`;
    if (typeof first?.url === "string" && first.url.startsWith("data:")) return first.url;
  }
  return null;
}

class ProviderError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message);
  }
}

/** quality must be one of the documented enum values, else the request 400s. */
const QUALITIES = new Set(["auto", "low", "medium", "high"]);

/**
 * OpenRouter rejects a request that carries BOTH an explicit pixel `size` and
 * an `aspect_ratio` — the pixel size is authoritative. Send exactly one:
 * "1024x1536" -> { size }, "2:3" -> { aspect_ratio }.
 */
export function sizeOrAspect(value?: string | null): { size?: string; aspect_ratio?: string } {
  const v = (value || "").trim();
  if (!v) return {};
  if (/^\d{2,5}\s*[x×]\s*\d{2,5}$/i.test(v)) return { size: v.toLowerCase().replace(/\s|×/g, (c) => (c === "×" ? "x" : "")) };
  if (/^\d{1,2}:\d{1,2}$/.test(v)) return { aspect_ratio: v };
  return {};
}

export async function generateStyled(input: GenerateInput): Promise<GenerateResult> {
  const key = process.env["OPENROUTER_API_KEY"];
  if (!key) throw new Error("OPENROUTER_API_KEY is not configured");

  const model = modelId();
  const started = Date.now();

  const quality = input.quality && QUALITIES.has(input.quality) ? input.quality : undefined;

  const body = JSON.stringify({
    model,
    prompt: input.prompt,
    input_references: buildInputReferences(input.imageDataUrl, input.referenceDataUrl),
    ...(quality ? { quality } : {}),
    // never both — see sizeOrAspect
    ...sizeOrAspect(input.aspectRatio),
    output_format: "jpeg",
    output_compression: 85, // 0-100, jpeg/webp only
    n: 1,
  });

  // One call. Retried ONCE by the caller loop below, and only on 5xx/network.
  let attemptNumber = 0;
  async function callOnce(): Promise<{ json: unknown }> {
    attemptNumber += 1;
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
      await input.onAttempt?.({
        attempt: attemptNumber,
        requestBody: body,
        responseStatus: null,
        responseBody: null,
        transportError: `${err.name}: ${err.message}`,
        recordedAt: new Date().toISOString(),
      });
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        // Timeouts are NOT retried — a second 120s wait doubles the stall.
        throw new ProviderError("Timeout after 120s", 408, false);
      }
      throw new ProviderError(`Network error: ${err.message}`, 0, true);
    }
    // Read once as text so Diagnostics receives the provider response verbatim
    // for successes and failures alike. JSON parsing happens from this copy.
    const text = await res.text();
    await input.onAttempt?.({
      attempt: attemptNumber,
      requestBody: body,
      responseStatus: res.status,
      responseBody: text,
      transportError: null,
      recordedAt: new Date().toISOString(),
    });
    if (!res.ok) {
      // 4xx (including content-policy refusals) are terminal — never retried.
      throw new ProviderError(`AI provider ${res.status}: ${text}`, res.status, res.status >= 500);
    }
    return { json: JSON.parse(text) as unknown };
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

// Image models selectable per event (OpenRouter Images API ids).
// Client-safe: the admin editor renders this list; the server validates against it.

export interface AiImageModel {
  id: string;
  label: string;
  note: string;
}

export const AI_IMAGE_MODELS: AiImageModel[] = [
  {
    id: "google/gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image",
    note: "Fastest (~8s) · ~$0.07 — best for live booths",
  },
  {
    id: "google/gemini-3-pro-image",
    label: "Gemini 3 Pro Image",
    note: "Higher fidelity · slower and pricier",
  },
  {
    id: "google/gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image (Nano Banana)",
    note: "Fast · older generation",
  },
  {
    id: "openai/gpt-image-2",
    label: "OpenAI GPT Image 2",
    note: "Strongest prompt following · ~90s, ~$0.12+ per photo",
  },
];

export const DEFAULT_AI_IMAGE_MODEL = "google/gemini-3.1-flash-image";

export function isAiImageModel(id: string | null | undefined): boolean {
  return !!id && AI_IMAGE_MODELS.some((m) => m.id === id);
}

import black from "@/assets/shirt-black.png.asset.json";
import graphite from "@/assets/shirt-graphite.png.asset.json";
import white from "@/assets/shirt-white.png.asset.json";

/**
 * The three LYNK & CO shirt variants a participant can be dressed in.
 * A portrait stores only the variant id (`assets.shirt_variant`), so the
 * processed image can be generated later, externally, and pushed back in.
 */
export interface ShirtVariant {
  id: "black" | "graphite" | "white";
  name: string;
  /** swatch colour of the garment */
  color: string;
  /** contrasting colour of the chest logo */
  logoColor: string;
  imageUrl: string;
  active: boolean;
}

export const SHIRT_VARIANTS: ShirtVariant[] = [
  { id: "black", name: "Black", color: "#0B0B0C", logoColor: "#FFFFFF", imageUrl: black.url, active: true },
  { id: "graphite", name: "Graphite", color: "#4A4A4C", logoColor: "#FFFFFF", imageUrl: graphite.url, active: true },
  { id: "white", name: "White", color: "#F4F4F2", logoColor: "#0B0B0C", imageUrl: white.url, active: true },
];

export function shirtById(id: string | null | undefined): ShirtVariant | null {
  return SHIRT_VARIANTS.find((s) => s.id === id) ?? null;
}

export function randomShirt(seed?: string): ShirtVariant {
  if (!seed) return SHIRT_VARIANTS[Math.floor(Math.random() * SHIRT_VARIANTS.length)];
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return SHIRT_VARIANTS[Math.abs(h) % SHIRT_VARIANTS.length];
}

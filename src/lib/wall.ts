import type { WallConfig, WallTile } from "./types";

/**
 * Brand copy / logo tiles interleaved between participant portraits on the
 * venue wall. `kind` decides how the tile renders:
 *   text  — a bold statement block (the "WHY NOT" beat of the reference wall)
 *   logo  — the LAQTA wordmark on a flat panel
 *   empty — a black filler panel that keeps the grid rhythm
 */
export const DEFAULT_WALL_TILES: WallTile[] = [
  { kind: "logo", text: "LAQTA", background: "#0A0A0A", color: "#FFFFFF" },
  { kind: "text", text: "TAKE YOUR SHOT", background: "#0A0A0A", color: "#22D3EE" },
  { kind: "logo", text: "LAQTA", background: "#0A0A0A", color: "#FFFFFF" },
  { kind: "text", text: "MAKE YOUR MARK", background: "#0A0A0A", color: "#F43F5E" },
  { kind: "text", text: "LIVE ON THE WALL", background: "#0A0A0A", color: "#818CF8" },
  { kind: "empty", text: "", background: "#050505", color: "#FFFFFF" },
];

export const DEFAULT_WALL: WallConfig = {
  columns: 3,
  intervalSec: 8,
  tiles: DEFAULT_WALL_TILES,
};

export function wallOf(config: unknown): WallConfig {
  const w = (config as { wall?: Partial<WallConfig> } | null)?.wall;
  if (!w) return DEFAULT_WALL;
  const tiles = Array.isArray(w.tiles) && w.tiles.length ? w.tiles : DEFAULT_WALL_TILES;
  return {
    columns: Math.max(1, Math.min(6, Number(w.columns) || DEFAULT_WALL.columns)),
    intervalSec: Math.max(3, Math.min(120, Number(w.intervalSec) || DEFAULT_WALL.intervalSec)),
    tiles: tiles.map((t) => ({ kind: t.kind ?? "text", text: t.text ?? "", background: t.background || "#0A0A0A", color: t.color || "#FFFFFF" })),
  };
}

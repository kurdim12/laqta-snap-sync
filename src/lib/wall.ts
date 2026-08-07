import type { WallConfig, WallTile } from "./types";

/** Brand copy tiles interleaved between guest photos on the venue wall. */
export const DEFAULT_WALL_TILES: WallTile[] = [
  { text: "LYNK&CO", background: "#0A0A0A", color: "#FFFFFF" },
  { text: "CHANGING MOBILITY FOREVER", background: "#1D4ED8", color: "#FFFFFF" },
  { text: "PERSONAL OPEN CO", background: "#111827", color: "#F5F3EE" },
  { text: "WHY NOT", background: "#E11D48", color: "#FFFFFF" },
];

export const DEFAULT_WALL: WallConfig = {
  columns: 3,
  intervalSec: 8,
  tiles: DEFAULT_WALL_TILES,
};

export function wallOf(config: unknown): WallConfig {
  const w = (config as { wall?: Partial<WallConfig> } | null)?.wall;
  if (!w) return DEFAULT_WALL;
  return {
    columns: Math.max(1, Math.min(6, Number(w.columns) || DEFAULT_WALL.columns)),
    intervalSec: Math.max(3, Math.min(120, Number(w.intervalSec) || DEFAULT_WALL.intervalSec)),
    tiles: Array.isArray(w.tiles) && w.tiles.length ? w.tiles : DEFAULT_WALL_TILES,
  };
}

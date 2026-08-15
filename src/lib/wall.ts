import type { ResolvedWall, WallBox, WallConfig, WallPattern, WallTile } from "./types";

/**
 * Legacy brand tiles. Kept only so events saved before the box model still have
 * their copy; `wallOf()` folds them into `boxes`.
 */
export const DEFAULT_WALL_TILES: WallTile[] = [
  { kind: "logo", text: "LYNK&CO", background: "#0A0A0A", color: "#FFFFFF" },
  { kind: "text", text: "WHY NOT", background: "#FFFFFF", color: "#0A0A0A" },
];

/**
 * The whole screen carries exactly three brand panels: one white message, one
 * blue message, one logo. Each turns to its next line on its own flip — the
 * count on screen never changes.
 */
export const DEFAULT_WALL_BOXES: WallBox[] = [
  {
    kind: "text",
    background: "#FFFFFF",
    color: "#0A0A0A",
    lines: ["WHY NOT", "PERSONAL", "OPEN CO"],
  },
  {
    kind: "text",
    background: "#2563EB",
    color: "#FFFFFF",
    lines: ["TAKE YOUR SHOT", "PICK YOUR FIT", "LIVE ON THE WALL"],
  },
  {
    kind: "logo",
    background: "#0A0A0A",
    color: "#FFFFFF",
    lines: ["LYNK&CO"],
  },
];

/** At most this many of each kind may sit on the wall at one time. */
export const MAX_MESSAGE_BOXES = 2;
export const MAX_LOGO_BOXES = 1;

/** Rows in the wall grid — the tower is a fixed height, columns are the knob. */
export const WALL_ROWS = 6;

export const DEFAULT_WALL: ResolvedWall = {
  columns: 3,
  intervalSec: 6,
  tiles: DEFAULT_WALL_TILES,
  pattern: "scatter",
  boxes: DEFAULT_WALL_BOXES,
  flipMs: 900,
};

const PATTERNS: WallPattern[] = ["scatter", "serpentine", "diagonal"];

function hex(v: unknown, fallback: string): string {
  return typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : fallback;
}

function cleanLines(v: unknown, fallback: string[]): string[] {
  // Only an ABSENT lines array falls back to the built-in copy. A box the
  // operator deliberately emptied stays empty (a plain colour panel) — falling
  // back there would resurrect LAQTA's default slogans on a client's screen
  // right after they deleted them.
  if (!Array.isArray(v)) return fallback;
  const out = v
    .map((l) => String(l ?? "").trim())
    .filter(Boolean)
    .slice(0, 12);
  return out.length ? out : [""];
}

/**
 * Fold a pre-box `tiles` array into the three-box model so an event saved under
 * the old shape keeps its copy: text tiles become the message lines (split
 * across the two boxes), logo tiles become the logo lines.
 */
export function boxesFromTiles(tiles: WallTile[]): WallBox[] {
  const texts = tiles.filter((t) => (t.kind ?? "text") === "text").map((t) => t.text).filter(Boolean);
  const logos = tiles.filter((t) => t.kind === "logo").map((t) => t.text).filter(Boolean);

  // Alternate so both message boxes get copy instead of one taking all of it.
  const even = texts.filter((_, i) => i % 2 === 0);
  const odd = texts.filter((_, i) => i % 2 === 1);

  return [
    { ...DEFAULT_WALL_BOXES[0], lines: even.length ? even : DEFAULT_WALL_BOXES[0].lines },
    { ...DEFAULT_WALL_BOXES[1], lines: odd.length ? odd : DEFAULT_WALL_BOXES[1].lines },
    { ...DEFAULT_WALL_BOXES[2], lines: logos.length ? logos : DEFAULT_WALL_BOXES[2].lines },
  ];
}

/** Trim a box list down to the on-screen budget: two messages, one logo. */
export function capBoxes(boxes: WallBox[]): WallBox[] {
  const out: WallBox[] = [];
  let messages = 0;
  let logos = 0;
  for (const b of boxes) {
    if (b.kind === "logo") {
      if (logos >= MAX_LOGO_BOXES) continue;
      logos++;
    } else {
      if (messages >= MAX_MESSAGE_BOXES) continue;
      messages++;
    }
    out.push(b);
  }
  return out;
}

export function wallOf(config: unknown): ResolvedWall {
  const w = (config as { wall?: Partial<WallConfig> } | null)?.wall;
  if (!w) return DEFAULT_WALL;

  const tiles = Array.isArray(w.tiles) && w.tiles.length ? w.tiles : DEFAULT_WALL_TILES;
  const normalisedTiles = tiles.map((t) => ({
    kind: t.kind ?? "text",
    text: t.text ?? "",
    background: t.background || "#0A0A0A",
    color: t.color || "#FFFFFF",
  }));

  const rawBoxes = Array.isArray(w.boxes) && w.boxes.length ? w.boxes : null;
  const boxes = capBoxes(
    rawBoxes
      ? rawBoxes.map((b, i) => {
          const d = DEFAULT_WALL_BOXES[Math.min(i, DEFAULT_WALL_BOXES.length - 1)];
          return {
            kind: b?.kind === "logo" ? ("logo" as const) : ("text" as const),
            background: hex(b?.background, d.background),
            color: hex(b?.color, d.color),
            lines: cleanLines(b?.lines, d.lines),
          };
        })
      : boxesFromTiles(normalisedTiles),
  );

  return {
    columns: Math.max(1, Math.min(6, Number(w.columns) || DEFAULT_WALL.columns)),
    intervalSec: Math.max(2, Math.min(120, Number(w.intervalSec) || DEFAULT_WALL.intervalSec)),
    tiles: normalisedTiles,
    pattern: PATTERNS.includes(w.pattern as WallPattern) ? (w.pattern as WallPattern) : DEFAULT_WALL.pattern,
    boxes: boxes.length ? boxes : DEFAULT_WALL_BOXES,
    flipMs: Math.max(200, Math.min(4000, Number(w.flipMs) || DEFAULT_WALL.flipMs)),
  };
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * The order the wall turns its cells — one cell per tick, every cell exactly
 * once before any repeats. Never returns two of the same index, so the wall can
 * never flip the same cell twice in a cycle while another sits stale.
 */
export function flipOrder(capacity: number, columns: number, pattern: WallPattern): number[] {
  const n = Math.max(1, Math.floor(capacity));
  const cols = Math.max(1, Math.floor(columns));
  const rows = Math.ceil(n / cols);

  if (pattern === "serpentine") {
    const out: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const col = r % 2 === 0 ? c : cols - 1 - c;
        const idx = r * cols + col;
        if (idx < n) out.push(idx);
      }
    }
    return out;
  }

  if (pattern === "diagonal") {
    const out: number[] = [];
    for (let band = 0; band <= rows + cols - 2; band++) {
      for (let r = 0; r < rows; r++) {
        const c = band - r;
        if (c < 0 || c >= cols) continue;
        const idx = r * cols + c;
        if (idx < n) out.push(idx);
      }
    }
    return out;
  }

  // scatter — step by a golden-ratio stride made coprime with the cell count, so
  // consecutive turns land far apart and the cycle still covers every cell once.
  let stride = Math.max(1, Math.round(n * 0.382));
  for (let k = 0; k < n && gcd(stride, n) !== 1; k++) stride = (stride % n) + 1;
  if (gcd(stride, n) !== 1) stride = 1;

  const out: number[] = [];
  let cur = 0;
  for (let i = 0; i < n; i++) {
    out.push(cur);
    cur = (cur + stride) % n;
  }
  return out;
}

/**
 * Where the fixed brand boxes live. One per horizontal band, staggered across
 * columns, so the three panels read as spread over the whole screen rather than
 * stacked in a corner. Deterministic: the same grid always yields the same slots.
 */
export function brandSlots(capacity: number, columns: number, count: number): number[] {
  const cap = Math.max(0, Math.floor(capacity));
  const cols = Math.max(1, Math.floor(columns));
  const n = Math.max(0, Math.min(Math.floor(count), cap));
  if (!n) return [];

  const rows = Math.max(1, Math.ceil(cap / cols));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.min(rows - 1, Math.floor(((i + 0.5) * rows) / n));
    const col = (i * Math.max(1, cols - 1) + 1) % cols;
    let idx = row * cols + col;
    // resolve collisions and out-of-range (ragged last row) by walking forward
    for (let k = 0; k < cap && (idx >= cap || out.includes(idx)); k++) idx = (idx + 1) % cap;
    out.push(idx);
  }
  return out;
}

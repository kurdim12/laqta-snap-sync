// Client-side "lightbox cell" photo treatment — NO AI, NO provider calls, $0/photo.
//
// Cuts the subject out of the photo in the browser (WASM segmentation) and
// drops them into an illuminated box: a soft radial gradient in ONE colour
// drawn (deterministically, per photo) from the event palette, a halftone dot
// grain, and a thin inner shadow on all four edges so the cell reads as a
// recessed lightbox — matching the LYNK & CO LED tower.

export interface BackdropCellColor {
  /** base hex colour of the illuminated box */
  color: string;
  /** relative draw weight — a rare accent (e.g. red) gets a small number */
  weight: number;
}

export interface BackdropSettings {
  /** weighted colour pool; one colour per cell, picked per photo */
  cells: BackdropCellColor[];
  halftone: boolean;
  /** 0-100 */
  halftoneOpacity: number;
  aspect: "1:1" | "4:5";
  /** legacy gradient pairs kept so older events still resolve */
  palette?: { from: string; to: string }[];
}

/** Purple / teal common, red roughly 1 in 8 — as on the reference tower. */
export const DEFAULT_BACKDROP: BackdropSettings = {
  cells: [
    { color: "#6C2BD9", weight: 7 },
    { color: "#2DD4BF", weight: 7 },
    { color: "#E11D48", weight: 2 },
  ],
  halftone: true,
  halftoneOpacity: 12,
  aspect: "1:1",
};

export function backdropOf(config: unknown): BackdropSettings {
  const b = (config as { backdrop?: Partial<BackdropSettings> } | null)?.backdrop;
  if (!b) return DEFAULT_BACKDROP;

  let cells: BackdropCellColor[] | null =
    Array.isArray(b.cells) && b.cells.length
      ? b.cells
          .map((c) => ({ color: String(c?.color || "#6C2BD9"), weight: Math.max(0, Number(c?.weight) || 0) }))
          .filter((c) => c.weight > 0)
      : null;

  // Fold a pre-lightbox palette (gradient pairs) into single-colour cells so an
  // event saved under the old shape keeps its colours.
  if (!cells?.length && Array.isArray(b.palette) && b.palette.length) {
    cells = b.palette.map((p) => ({ color: p.from, weight: 1 }));
  }

  return {
    cells: cells?.length ? cells : DEFAULT_BACKDROP.cells,
    halftone: b.halftone ?? DEFAULT_BACKDROP.halftone,
    halftoneOpacity: typeof b.halftoneOpacity === "number" ? b.halftoneOpacity : DEFAULT_BACKDROP.halftoneOpacity,
    aspect: b.aspect === "4:5" ? "4:5" : "1:1",
  };
}

/* ------------------------------------------------------------------ */
/* colour helpers — shared by the canvas render and the CSS wall cells  */
/* ------------------------------------------------------------------ */

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const s = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(s || "6C2BD9", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** mix toward white (t>0) or black (t<0) */
export function shade(hex: string, t: number): string {
  const [r, g, b] = rgb(hex);
  const to = t >= 0 ? 255 : 0;
  const k = Math.abs(t);
  const m = (v: number) => Math.round(v + (to - v) * k);
  return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

/** Deterministic weighted pick — the same photo always gets the same colour. */
export function pickCellColor(seed: string, cells: BackdropCellColor[]): string {
  const pool = cells.length ? cells : DEFAULT_BACKDROP.cells;
  const total = pool.reduce((a, c) => a + Math.max(0, c.weight || 0), 0) || pool.length;
  let n = (hash(seed) % 10000) / 10000 * total;
  for (const c of pool) {
    n -= Math.max(0, c.weight || 0) || 1;
    if (n <= 0) return c.color;
  }
  return pool[pool.length - 1].color;
}

/** CSS for an illuminated lightbox face in `color` — used by the wall cells. */
export function cellBackgroundCss(color: string): string {
  return `radial-gradient(120% 105% at 50% 42%, ${shade(color, 0.34)} 0%, ${color} 42%, ${shade(color, -0.45)} 100%)`;
}

/** CSS overlay for the halftone dot grain. */
export function halftoneCss(opacity: number): { backgroundImage: string; backgroundSize: string; opacity: number } {
  return {
    backgroundImage: "radial-gradient(rgba(0,0,0,0.95) 26%, transparent 27%)",
    backgroundSize: "3.2% 3.2%",
    opacity: Math.max(0, Math.min(100, opacity)) / 100,
  };
}

/** Inner shadow that makes a face read as a recessed box. */
export const RECESS_SHADOW =
  "inset 0 0 0 1px rgba(0,0,0,0.55), inset 0 1.6vh 3.2vh rgba(0,0,0,0.42), inset 0 -1.6vh 3.2vh rgba(0,0,0,0.42), inset 1.6vh 0 3.2vh rgba(0,0,0,0.32), inset -1.6vh 0 3.2vh rgba(0,0,0,0.32)";

/* ------------------------------------------------------------------ */
/* canvas render                                                       */
/* ------------------------------------------------------------------ */

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("cutout decode failed")); };
    img.src = url;
  });
}

/** Tight bounding box of non-transparent pixels (sampled at low res for speed). */
function alphaBounds(img: HTMLImageElement) {
  const s = Math.min(1, 320 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s));
  const h = Math.max(1, Math.round(img.naturalHeight * s));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 24) {
        found = true;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  const k = 1 / s;
  return { x: minX * k, y: minY * k, w: (maxX - minX + 1) * k, h: (maxY - minY + 1) * k };
}

function drawHalftone(ctx: CanvasRenderingContext2D, w: number, h: number, opacity: number) {
  const step = Math.max(8, Math.round(w / 44));
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(100, opacity)) / 100;
  ctx.fillStyle = "#000000";
  const r = step * 0.26;
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Thin inner shadow on all four edges — the "recessed box" read. */
function drawInnerShadow(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const d = Math.round(Math.min(w, h) * 0.10);
  const edge = (x0: number, y0: number, x1: number, y1: number, strength: number) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  ctx.save();
  edge(0, 0, 0, d, 0.5);          // top
  edge(0, h, 0, h - d, 0.5);      // bottom
  edge(0, 0, d, 0, 0.38);         // left
  edge(w, 0, w - d, 0, 0.38);     // right
  ctx.restore();
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = Math.max(2, Math.round(w * 0.004));
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
}

export async function cutoutSubject(source: Blob): Promise<Blob> {
  const { removeBackground } = await import("@imgly/background-removal");
  return removeBackground(source, { output: { format: "image/png" } });
}

/**
 * Render one lightbox cell. `seed` (asset id) picks the colour so the same
 * photo always lands on the same panel and the wall never re-shuffles.
 */
export async function renderBackdrop(
  source: Blob,
  settings: BackdropSettings,
  seed: string,
): Promise<Blob> {
  const cutout = await cutoutSubject(source);
  const img = await blobToImage(cutout);
  const box = alphaBounds(img);

  // 4K-class tile so the venue LED wall never shows JPEG mush
  const W = 2160;
  const H = settings.aspect === "4:5" ? 2700 : 2160;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas context");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // illuminated box: lighter centre, deeper edges, single colour
  const base = pickCellColor(seed, settings.cells);
  const grad = ctx.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.05, W / 2, H * 0.5, Math.max(W, H) * 0.78);
  grad.addColorStop(0, shade(base, 0.34));
  grad.addColorStop(0.42, base);
  grad.addColorStop(1, shade(base, -0.45));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  if (settings.halftone) drawHalftone(ctx, W, H, settings.halftoneOpacity);

  // Head-and-shoulders framing: face large in frame, subject centred, head near
  // the top — identical geometry on every cell so the grid reads as one wall.
  const targetH = H * 0.86;
  let scale = targetH / box.h;
  if (box.w * scale > W * 0.95) scale = (W * 0.95) / box.w;
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const dx = W / 2 - (box.x + box.w / 2) * scale;
  const dy = H * 0.08 - box.y * scale;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.30)";
  ctx.shadowBlur = W * 0.025;
  ctx.shadowOffsetY = W * 0.010;
  ctx.drawImage(img, dx, dy, drawW, drawH);
  ctx.restore();

  drawInnerShadow(ctx, W, H);

  return new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.95),
  );
}

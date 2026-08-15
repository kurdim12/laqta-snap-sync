// Client-side "backdrop" photo treatment — NO AI, NO provider calls, $0/photo.
//
// Cuts the subject out of the photo in the browser (WASM segmentation), drops
// them on a flat brand gradient, adds an optional halftone dot texture, and
// crops head-and-shoulders so a grid of them reads as one consistent wall.

export interface BackdropSettings {
  /**
   * One pair per tile colour, cycled deterministically. The panel is lit from
   * behind the subject: `from` is the bright glow at the centre, `to` the deep
   * shade the corners fall away to.
   */
  palette: { from: string; to: string }[];
  halftone: boolean;
  /** 0-100 */
  halftoneOpacity: number;
  aspect: "1:1" | "4:5";
}

/**
 * Sampled off the LYNK & CO installation wall: saturated backlit panels in
 * violet, mint, electric blue, magenta and cyan, each blooming behind the
 * subject and falling into a much deeper shade at the edges.
 */
export const DEFAULT_BACKDROP: BackdropSettings = {
  palette: [
    { from: "#A855F7", to: "#3B0764" }, // violet
    { from: "#8FF0BF", to: "#0E9F6E" }, // mint / spring green
    { from: "#4F7DF3", to: "#1E1B4B" }, // electric blue
    { from: "#FF4D8D", to: "#9D174D" }, // magenta
    { from: "#22D3EE", to: "#0E7490" }, // cyan
    { from: "#C084FC", to: "#4C1D95" }, // orchid
  ],
  halftone: true,
  halftoneOpacity: 18,
  aspect: "4:5",
};

export function backdropOf(config: unknown): BackdropSettings {
  const b = (config as { backdrop?: Partial<BackdropSettings> } | null)?.backdrop;
  if (!b) return DEFAULT_BACKDROP;
  return {
    palette: Array.isArray(b.palette) && b.palette.length ? b.palette : DEFAULT_BACKDROP.palette,
    halftone: b.halftone ?? DEFAULT_BACKDROP.halftone,
    halftoneOpacity: typeof b.halftoneOpacity === "number" ? b.halftoneOpacity : DEFAULT_BACKDROP.halftoneOpacity,
    aspect: b.aspect === "1:1" ? "1:1" : "4:5",
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

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
  const step = Math.max(10, Math.round(w / 46));
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(100, opacity)) / 100;
  ctx.fillStyle = "#000000";
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      // dots fade out toward the top so the face stays clean
      const t = y / h;
      const r = (step * 0.16) + (step * 0.20) * t;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Which palette pair a given asset gets — stable for the life of the photo. */
export function panelPair(settings: BackdropSettings, seed: string): { from: string; to: string } {
  return settings.palette[hash(seed) % settings.palette.length];
}

/**
 * Paint the lit panel the subject stands on. A backlit lightbox, not a flat
 * wash: the glow blooms from behind the head and shoulders and falls into the
 * deeper shade at the corners, which is what gives the reference wall its
 * depth. The centre sits above the midline so the brightest part lands behind
 * the face.
 */
export function paintPanel(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  settings: BackdropSettings,
  seed: string,
): void {
  const pair = panelPair(settings, seed);
  const cx = W / 2;
  const cy = H * 0.42;
  // Reach exactly the farthest corner, so the corners land on the deep shade
  // rather than stopping partway and flattening the panel out.
  const outer = Math.hypot(W / 2, Math.max(cy, H - cy));
  const grad = ctx.createRadialGradient(cx, cy, W * 0.04, cx, cy, outer);
  grad.addColorStop(0, pair.from);
  grad.addColorStop(0.45, pair.from);
  grad.addColorStop(1, pair.to);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  if (settings.halftone) drawHalftone(ctx, W, H, settings.halftoneOpacity);
}

export async function cutoutSubject(source: Blob): Promise<Blob> {
  const { removeBackground } = await import("@imgly/background-removal");
  return removeBackground(source, { output: { format: "image/png" } });
}

/**
 * Render one wall tile. `seed` (asset id) picks the gradient so the same photo
 * always gets the same colour and the wall never re-shuffles.
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
  const H = settings.aspect === "1:1" ? 2160 : 2700;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas context");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  paintPanel(ctx, W, H, settings, seed);

  // Head-and-shoulders framing: subject fills ~74% of the height, head near the
  // top, horizontally centred — identical geometry on every tile.
  const targetH = H * 0.74;
  let scale = targetH / box.h;
  if (box.w * scale > W * 0.9) scale = (W * 0.9) / box.w;
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const dx = W / 2 - (box.x + box.w / 2) * scale;
  const dy = H * 0.13 - box.y * scale;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = W * 0.03;
  ctx.shadowOffsetY = W * 0.012;
  ctx.drawImage(img, dx, dy, drawW, drawH);
  ctx.restore();

  return new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.95),
  );
}

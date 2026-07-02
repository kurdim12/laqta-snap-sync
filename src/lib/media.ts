// Client-side image/video variant generation using canvas APIs.

// iPhone HEIC/HEIF can't be decoded by <canvas> in most browsers, so the resize
// pipeline would throw and the photo would get no web/thumb variants. Convert
// HEIC to JPEG first (heic2any is browser-only and dynamically imported so it
// never runs during SSR or bloats the initial bundle).
export async function toDecodable(file: File | Blob): Promise<File | Blob> {
  const type = (file as File).type || "";
  const name = ((file as File).name || "").toLowerCase();
  const isHeic = /image\/(heic|heif)/.test(type) || /\.(heic|heif)$/.test(name);
  if (!isHeic) return file;
  try {
    const heic2any = (await import("heic2any")).default;
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    return (Array.isArray(out) ? out[0] : out) as Blob;
  } catch {
    return file; // fall back to the original; caller handles decode failure
  }
}

export async function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("image decode failed"));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blob failed"))), type, quality);
  });
}

export async function resizeImage(file: File, maxSide: number, quality = 0.85): Promise<Blob> {
  const img = await loadImage(await toDecodable(file));
  const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * ratio);
  const h = Math.round(img.naturalHeight * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  return canvasToBlob(canvas, "image/jpeg", quality);
}

// Resize an uploaded logo and return a PNG data URL (preserves transparency).
// Small enough to live inline in the event config — no storage bucket needed and
// no signed-URL expiry, so the logo renders permanently on the form and gallery.
export async function logoDataUrl(file: File, maxSide = 256): Promise<string> {
  const img = await loadImage(file);
  const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * ratio));
  const h = Math.max(1, Math.round(img.naturalHeight * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/png");
}

export async function videoPoster(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.src = url;
    v.crossOrigin = "anonymous";
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, (v.duration || 1) / 2);
    };
    v.onseeked = async () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = v.videoWidth || 640;
        canvas.height = v.videoHeight || 360;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const blob = await canvasToBlob(canvas, "image/jpeg", 0.8);
        URL.revokeObjectURL(url);
        resolve(blob);
      } catch {
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
  });
}

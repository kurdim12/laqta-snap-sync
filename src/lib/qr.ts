// Tiny QR via external image service (no extra deps; works offline-after-cache).
// For production swap to a local qr lib.
export function qrUrl(text: string, size = 280): string {
  const enc = encodeURIComponent(text);
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&data=${enc}`;
}

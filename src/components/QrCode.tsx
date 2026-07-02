import { useEffect, useState } from "react";
import { qrDataUrl } from "@/lib/qr";

interface Props {
  /** Text/URL to encode. Never sent off-device — encoded locally. */
  value: string;
  /** Rendered pixel size (square). */
  size?: number;
  className?: string;
  alt?: string;
}

/**
 * Client-side QR image. Replaces the old third-party api.qrserver.com URL so
 * private gallery links are never disclosed to an external service. Generates
 * the code in an effect and swaps it in; renders a same-size placeholder first
 * to avoid layout shift.
 */
export function QrCode({ value, size = 280, className, alt = "QR code" }: Props) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    qrDataUrl(value, size)
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [value, size]);

  if (!src) {
    return <div className={className} style={{ width: size, height: size }} aria-hidden />;
  }
  return <img src={src} alt={alt} width={size} height={size} className={className} />;
}

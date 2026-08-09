import { useEffect, useRef, useState } from "react";

/**
 * Full-screen capture with an oval head-and-shoulders guide and a "wave!"
 * prompt. Used for backdrop events so every subject on the wall is framed at
 * the same distance and is gesturing — a grid of static portraits falls flat.
 */
export function FaceGuideCamera({
  facing = "user",
  onCapture,
  onClose,
}: {
  facing?: "user" | "environment";
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // 4K-class capture: ask for the highest the device can give, fall
          // back gracefully on phones that top out lower.
          video: {
            facingMode: facing,
            width: { ideal: 2160, max: 4096 },
            height: { ideal: 3840, max: 4096 },
          },
          audio: false,
        });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        setErr("Camera unavailable — use the gallery button. / الكاميرا غير متاحة");
      }
    })();
    return () => {
      alive = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (facing === "user") { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((b) => {
      if (!b) return;
      onCapture(new File([b], `capture-${Date.now()}.jpg`, { type: "image/jpeg" }));
    }, "image/jpeg", 0.96);
  }

  function startCountdown() {
    if (count !== null) return;
    let n = 3;
    setCount(n);
    const t = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(t); setCount(null); shoot(); }
      else setCount(n);
    }, 800);
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black">
      <video ref={videoRef} playsInline muted className={`h-full w-full object-cover ${facing === "user" ? "scale-x-[-1]" : ""}`} />

      {/* oval face guide */}
      <svg viewBox="0 0 100 160" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
        <defs>
          <mask id="guide-mask">
            <rect width="100" height="160" fill="white" />
            <ellipse cx="50" cy="66" rx="27" ry="38" fill="black" />
          </mask>
        </defs>
        <rect width="100" height="160" fill="rgba(0,0,0,0.55)" mask="url(#guide-mask)" />
        <ellipse cx="50" cy="66" rx="27" ry="38" fill="none" stroke="white" strokeWidth="0.5" strokeDasharray="3 2" opacity="0.9" />
      </svg>

      <div className="pointer-events-none absolute inset-x-0 top-10 px-6 text-center">
        <p className="font-arabic text-2xl font-bold text-white drop-shadow">👋 لوّح للكاميرا!</p>
        <p className="mt-1 text-lg font-bold uppercase tracking-wide text-white/90 drop-shadow">Wave at the camera!</p>
        <p className="mt-2 text-xs text-white/70">
          ضع رأسك وكتفيك داخل البيضاوي · Fit your head and shoulders inside the oval
        </p>
      </div>

      {count !== null && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="code-display text-[8rem] text-white drop-shadow-lg">{count}</span>
        </div>
      )}

      {err && (
        <div className="absolute inset-x-0 top-1/2 px-6 text-center text-sm text-white">{err}</div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-8 pb-10">
        <button type="button" onClick={onClose} className="rounded-full bg-white/15 px-5 py-3 text-sm font-bold text-white backdrop-blur">
          ✕
        </button>
        <button
          type="button"
          onClick={startCountdown}
          disabled={!!err}
          aria-label="Capture"
          className="h-20 w-20 rounded-full border-4 border-white bg-white/25 backdrop-blur transition active:scale-95 disabled:opacity-40"
        />
        <span className="w-12" />
      </div>
    </div>
  );
}

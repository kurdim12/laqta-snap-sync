import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Share2, X } from "lucide-react";

export interface LightboxItem {
  id: string;
  kind: "photo" | "video";
  url?: string;
  thumbUrl?: string;
}

interface Props {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
  showDownload?: boolean;
  showShare?: boolean;
  shareTitle?: string;
}

export function Lightbox({ items, index, onClose, onIndexChange, showDownload = true, showShare = true, shareTitle }: Props) {
  const item = items[index];
  const [shared, setShared] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);

  const prev = useCallback(() => onIndexChange((index - 1 + items.length) % items.length), [index, items.length, onIndexChange]);
  const next = useCallback(() => onIndexChange((index + 1) % items.length), [index, items.length, onIndexChange]);

  // Focus management + body scroll lock
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      const el = previouslyFocusedRef.current as HTMLElement | null;
      if (el && typeof el.focus === "function") el.focus();
    };
  }, []);

  // Keyboard: Esc + arrows + Tab focus trap
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowLeft") { prev(); return; }
      if (e.key === "ArrowRight") { next(); return; }
      if (e.key === "Tab" && containerRef.current) {
        const focusables = containerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), video[controls]',
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onClose]);

  // touch swipe
  const [touchX, setTouchX] = useState<number | null>(null);
  function onTouchStart(e: React.TouchEvent) { setTouchX(e.touches[0].clientX); }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 60) (dx > 0 ? prev : next)();
    setTouchX(null);
  }

  async function share() {
    if (!item?.url) return;
    const data: ShareData = { title: shareTitle, url: item.url };
    try {
      if (navigator.share) { await navigator.share(data); return; }
    } catch { /* user cancelled */ }
    try {
      await navigator.clipboard.writeText(item.url);
      setShared("Copied link");
      setTimeout(() => setShared(null), 1400);
    } catch { /* noop */ }
  }

  if (!item) return null;
  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={shareTitle ? `${shareTitle} — image viewer` : "Image viewer"}
      className="fixed inset-0 z-50 bg-black/95"
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent px-4 py-3 text-white">
        <div className="text-xs opacity-70">{index + 1} / {items.length}</div>
        <div className="flex items-center gap-2">
          {showShare && (
            <button
              onClick={(e) => { e.stopPropagation(); share(); }}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/30 px-3 py-1 text-xs font-semibold transition hover:bg-white/10"
              aria-label="Share"
            >
              <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
              {shared || "Share"}
            </button>
          )}
          {showDownload && item.url && (
            <a
              href={item.url}
              download
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground"
              aria-label="Download"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Download
            </a>
          )}
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full border border-white/30 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {items.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prev(); }}
            className="absolute start-2 top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20 sm:grid"
            aria-label="Previous image"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden="true" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); next(); }}
            className="absolute end-2 top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20 sm:grid"
            aria-label="Next image"
          >
            <ChevronRight className="h-6 w-6" aria-hidden="true" />
          </button>
        </>
      )}

      <div className="grid h-full place-items-center p-4 pt-16" onClick={(e) => e.stopPropagation()}>
        {item.kind === "video" ? (
          <video src={item.url} controls autoPlay className="max-h-[85vh] max-w-full" />
        ) : (
          <img src={item.url} alt="" className="max-h-[85vh] max-w-full object-contain animate-in fade-in" />
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";

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

  const prev = useCallback(() => onIndexChange((index - 1 + items.length) % items.length), [index, items.length, onIndexChange]);
  const next = useCallback(() => onIndexChange((index + 1) % items.length), [index, items.length, onIndexChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
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
    <div className="fixed inset-0 z-50 bg-black/95" onClick={onClose} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent px-4 py-3 text-white">
        <div className="text-xs opacity-70">{index + 1} / {items.length}</div>
        <div className="flex items-center gap-2">
          {showShare && (
            <button onClick={(e) => { e.stopPropagation(); share(); }} className="rounded-full border border-white/30 px-3 py-1 text-xs font-semibold transition hover:bg-white/10">
              {shared || "Share"}
            </button>
          )}
          {showDownload && item.url && (
            <a href={item.url} download onClick={(e) => e.stopPropagation()} className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
              Download
            </a>
          )}
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full border border-white/30 text-white">✕</button>
        </div>
      </div>

      {items.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prev(); }}
            className="absolute start-2 top-1/2 z-10 hidden -translate-y-1/2 grid h-12 w-12 place-items-center rounded-full bg-white/10 text-2xl text-white backdrop-blur transition hover:bg-white/20 sm:block"
            aria-label="Previous"
          >‹</button>
          <button
            onClick={(e) => { e.stopPropagation(); next(); }}
            className="absolute end-2 top-1/2 z-10 hidden -translate-y-1/2 grid h-12 w-12 place-items-center rounded-full bg-white/10 text-2xl text-white backdrop-blur transition hover:bg-white/20 sm:block"
            aria-label="Next"
          >›</button>
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

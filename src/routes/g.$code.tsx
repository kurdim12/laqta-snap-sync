import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_CONFIG, type EventConfig, type EventRow } from "@/lib/types";
import { T, pick, useLang } from "@/lib/i18n";
import { Lightbox } from "@/components/Lightbox";
import { applyEventTheme } from "@/lib/theme";
import { getGalleryByCode, getDownloadUrlsByCode } from "@/lib/gallery.functions";
import { compositeFrame } from "@/lib/media";

export const Route = createFileRoute("/g/$code")({
  head: () => ({ meta: [{ title: "LAQTA · Your photos" }] }),
  component: Gallery,
});


interface GalleryAsset {
  id: string;
  kind: "photo" | "video";
  url?: string;
  thumbUrl?: string;
  /** the event's AI style is still rendering this photo */
  processing?: boolean;
  /** show the branded PNG frame over this tile */
  framed?: boolean;
}

function Gallery() {
  const { code } = useParams({ from: "/g/$code" });
  const navigate = useNavigate();
  const [guestCode, setGuestCode] = useState<string | null>(null);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [assets, setAssets] = useState<GalleryAsset[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const cfg = event?.config || DEFAULT_CONFIG;
  const [lang, setLang, toggleable] = useLang(cfg.locale);

  const themeCleanupRef = useRef<(() => void) | null>(null);

  async function load() {
    try {
      // Signing happens server-side (service role, rate limited). The anon
      // client no longer reads assets or calls get_code_gallery directly.
      const r = await getGalleryByCode({ data: { code } });
      if (r.notFound || !r.event || !r.guest) { setNotFound(true); return; }
      setNotFound(false);
      setGuestCode(r.guest.code);
      const e = r.event;
      const ev: EventRow = {
        id: e.id, slug: e.slug, name: e.name,
        created_at: e.created_at ?? "",
        status: e.status as EventRow["status"],
        config: { ...DEFAULT_CONFIG, ...(e.config as Partial<EventConfig>) } as EventConfig,
      };
      setEvent(ev);
      const mode = e.template_mode;
      const frame = e.template_frame_url || null;
      setFrameUrl(frame);
      if (themeCleanupRef.current) themeCleanupRef.current();
      themeCleanupRef.current = applyEventTheme(ev.config.theme);
      setAssets(
        (r.assets || []).map((a) => ({
          id: a.id,
          kind: a.kind === "video" ? "video" : "photo",
          url: a.url,
          thumbUrl: a.thumbUrl,
          processing: a.process_status === "pending" || a.process_status === "processing",
          // Frame overlay: always in frame mode, and as the branding fallback
          // when an AI generation failed or was skipped.
          framed: !!frame && (mode === "frame" || (mode === "ai" && (a.process_status === "failed" || a.process_status === "skipped" || !a.process_status))),
        })),
      );
    } catch {
      setNotFound(true);
    }
  }

  useEffect(() => {
    load();
    return () => {
      if (themeCleanupRef.current) { themeCleanupRef.current(); themeCleanupRef.current = null; }
    };
  }, [code]);


  useEffect(() => {
    if (notFound) return;
    let last = Date.now();
    const onActivity = () => { last = Date.now(); };
    window.addEventListener("pointerdown", onActivity);
    // Poll fast while a styled render is still cooking, slow otherwise.
    const styling = assets.some((a) => a.processing);
    const i = setInterval(() => {
      if (Date.now() - last > 10 * 60_000) return;
      load();
    }, styling ? 5_000 : 20_000);
    return () => { clearInterval(i); window.removeEventListener("pointerdown", onActivity); };
  }, [notFound, code, assets]);

  if (notFound) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-6 text-center">
        <div className="w-full max-w-sm">
          <div className="code-display text-3xl text-primary">LAQTA</div>
          <p className="mt-6 font-arabic text-lg">{pick(T.wrongCode, "ar")}</p>
          <p className="text-sm text-muted-foreground">{pick(T.wrongCode, "en")}</p>
          <input
            dir="ltr"
            placeholder={pick(T.enterCode, "en")}
            className="code-display mt-6 w-full rounded-xl border border-border bg-input px-4 py-4 text-center text-2xl text-foreground outline-none focus:border-primary"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = (e.target as HTMLInputElement).value.trim().toUpperCase();
                if (v) navigate({ to: "/g/$code", params: { code: v } });
              }
            }}
          />
        </div>
      </main>
    );
  }

  if (!guestCode) {
    return <main className="grid min-h-screen place-items-center bg-background"><div className="text-muted-foreground">···</div></main>;
  }

  async function downloadAll() {
    // Full-res download URLs are minted server-side (service role, rate limited)
    // with a forced Content-Disposition: attachment.
    const { urls } = await getDownloadUrlsByCode({
      data: { code, prefix: `${event?.name || "laqta"}-${guestCode || ""}` },
    });
    let i = 0;
    for (const u of urls) {
      i += 1;
      try {
        // Cross-origin signed URLs ignore the <a download> attribute, so fetch
        // the bytes and download a same-origin blob instead.
        const resp = await fetch(u);
        let blob = await resp.blob();
        let ext = new URL(u).pathname.split(".").pop() || "jpg";
        // Branded fallback: a failed AI photo still downloads with the frame.
        const framedAsset = frameUrl && assets[i - 1]?.framed && assets[i - 1]?.kind === "photo";
        if (framedAsset && frameUrl) {
          try {
            blob = await compositeFrame(URL.createObjectURL(blob), frameUrl);
            ext = "jpg";
          } catch { /* fall back to the un-framed original */ }
        }
        const objUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objUrl;
        link.download = `${event?.name || "laqta"}-${guestCode}-${i}.${ext}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objUrl);
      } catch { /* skip files that fail to fetch */ }
      await new Promise((res) => setTimeout(res, 250));
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6">
      <header className="mx-auto flex max-w-5xl items-center justify-between">
        <div>
          {event?.config.theme.logoUrl ? (
            <img src={event.config.theme.logoUrl} alt={event.name} className="h-10 object-contain" />
          ) : (
            <div className="text-xl font-bold text-primary">{event?.name}</div>
          )}
          <div className="mt-1 text-xs text-muted-foreground">
            {pick(T.yourCode, lang)}: <span className="code-display text-primary" dir="ltr">{guestCode}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {toggleable && (
            <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground">
              {lang === "ar" ? "EN" : "ع"}
            </button>
          )}
          {cfg.gallery.allowDownloadAll && assets.length > 0 && (
            <button
              onClick={downloadAll}
              className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
            >
              {pick(T.downloadAll, lang)}
            </button>
          )}
          {typeof navigator !== "undefined" && (
            <button
              onClick={() => shareGallery(event?.name || "LAQTA", typeof window !== "undefined" ? window.location.href : "")}
              className="rounded-full border border-border bg-card px-3 py-2 text-sm font-semibold"
              aria-label="Share gallery"
            >↗</button>
          )}
        </div>
      </header>

      {assets.length === 0 ? (
        <section className="mx-auto mt-20 max-w-md text-center">
          <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-card text-primary">
            <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="6" width="18" height="13" rx="2" /><circle cx="12" cy="13" r="3.5" /><path d="M8 6l1.5-2h5L16 6" />
            </svg>
          </div>
          <p className="mt-6 text-xl font-semibold">{pick(T.photosOnTheWay, lang)} 📸</p>
          <p className="mt-1 text-sm text-muted-foreground">{pick(T.comeBackSoon, lang)}</p>
          <p className="mt-6 text-xs text-muted-foreground">{pick(T.yourCode, lang)}</p>
          <p className="code-display mt-1 text-3xl text-primary" dir="ltr">{guestCode}</p>
        </section>
      ) : (
        <section className="mx-auto mt-6 grid max-w-5xl grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {assets.map((a, i) => (
            <button
              key={a.id}
              onClick={() => setLightbox(i)}
              className="group relative aspect-square overflow-hidden rounded-lg bg-card animate-in fade-in"
            >
              {a.kind === "video" ? (
                <>
                  {a.thumbUrl ? (
                    <img src={a.thumbUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <video src={`${a.url || ""}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  )}
                  <span className="absolute inset-0 grid place-items-center text-3xl text-white drop-shadow">▶</span>
                </>
              ) : (
                <img src={a.thumbUrl || a.url} alt="" className={`h-full w-full object-cover transition group-hover:scale-105 ${a.processing ? "scale-105 blur-md" : ""}`} />
              )}
              {frameUrl && a.framed && !a.processing && (
                <img src={frameUrl} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
              )}
              {a.processing && (
                <span className="absolute inset-0 grid place-items-center bg-black/45 px-2 text-center text-[10px] font-bold leading-tight text-white">
                  <span>
                    <span className="block animate-pulse font-arabic text-xs">…جاري تطبيق ستايل الفعالية</span>
                    <span className="block animate-pulse">applying event style…</span>
                  </span>
                </span>
              )}
            </button>
          ))}
        </section>
      )}

      {lightbox !== null && (
        <Lightbox
          items={assets}
          index={lightbox}
          onClose={() => setLightbox(null)}
          onIndexChange={setLightbox}
          shareTitle={event?.name}
        />
      )}
    </main>
  );
}

async function shareGallery(name: string, url: string) {
  const data: ShareData = { title: `${name} · LAQTA`, text: `Photos from ${name}`, url };
  try { if (navigator.share) { await navigator.share(data); return; } } catch { /* cancelled */ }
  try { await navigator.clipboard.writeText(url); } catch { /* noop */ }
}

import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_CONFIG, type EventConfig, type EventRow } from "@/lib/types";
import { T, pick, useLang } from "@/lib/i18n";
import { Lightbox } from "@/components/Lightbox";
import { applyEventTheme } from "@/lib/theme";

export const Route = createFileRoute("/g/$code")({
  head: () => ({ meta: [{ title: "LAQTA · Your photos" }] }),
  component: Gallery,
});


interface GalleryAsset {
  id: string;
  kind: "photo" | "video";
  url?: string;
  thumbUrl?: string;
}

interface CodeAsset {
  id: string;
  kind: string;
  variant: string;
  parent_asset_id: string | null;
  storage_path: string;
  created_at: string;
}

async function signMany(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    paths.map(async (p) => {
      const { data } = await supabase.storage.from("media").createSignedUrl(p, 3600);
      if (data?.signedUrl) out[p] = data.signedUrl;
    }),
  );
  return out;
}

function enrichCode(rows: CodeAsset[], urls: Record<string, string>): GalleryAsset[] {
  const originals = rows.filter((r) => r.variant === "original");
  const webs = rows.filter((r) => r.variant === "web");
  const thumbs = rows.filter((r) => r.variant === "thumb" || r.variant === "poster");
  const display = originals.length ? originals : webs.length ? webs : rows.filter((r) => r.variant !== "thumb" && r.variant !== "poster");
  return display.map((r) => {
    const isVideo = r.kind === "video";
    const web = webs.find((w) => w.parent_asset_id === r.id);
    const thumb = thumbs.find((t) => t.parent_asset_id === r.id);
    const full = web || r;
    const thumbAsset = thumb || (isVideo ? undefined : full);
    return {
      id: r.id,
      kind: isVideo ? "video" : "photo",
      url: urls[full.storage_path],
      thumbUrl: thumbAsset ? urls[thumbAsset.storage_path] : undefined,
    };
  });
}

function Gallery() {
  const { code } = useParams({ from: "/g/$code" });
  const navigate = useNavigate();
  const rawAssetsRef = useRef<CodeAsset[]>([]);
  const [guestCode, setGuestCode] = useState<string | null>(null);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [assets, setAssets] = useState<GalleryAsset[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const cfg = event?.config || DEFAULT_CONFIG;
  const [lang, setLang, toggleable] = useLang(cfg.locale);

  const themeCleanupRef = useRef<(() => void) | null>(null);

  async function load() {
    try {
      const { data: res, error } = await supabase.rpc("get_code_gallery", { _code: code });
      const r = res as unknown as {
        notFound?: boolean;
        guest?: { code: string };
        event?: { id: string; slug: string; name: string; status: string; config: unknown; created_at: string };
        assets?: CodeAsset[];
      } | null;
      if (error || !r || r.notFound || !r.event || !r.guest) { setNotFound(true); return; }
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
      if (themeCleanupRef.current) themeCleanupRef.current();
      themeCleanupRef.current = applyEventTheme(ev.config.theme);
      const rows = (r.assets || []) as CodeAsset[];
      rawAssetsRef.current = rows;
      const paths = Array.from(new Set(rows.map((a) => a.storage_path)));
      const urls = await signMany(paths);
      setAssets(enrichCode(rows, urls));
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
    const i = setInterval(() => {
      if (Date.now() - last > 10 * 60_000) return;
      load();
    }, 20_000);
    return () => { clearInterval(i); window.removeEventListener("pointerdown", onActivity); };
  }, [notFound, code]);

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
    const rows = rawAssetsRef.current;
    const originals = rows.filter((r) => r.variant === "original");
    const webs = rows.filter((r) => r.variant === "web");
    const display = originals.length ? originals : webs;
    for (const r of display) {
      try {
        const { data } = await supabase.storage.from("media").createSignedUrl(r.storage_path, 3600);
        if (!data?.signedUrl) continue;
        // Cross-origin signed URLs ignore the <a download> attribute, so fetch
        // the bytes and download a same-origin blob instead.
        const resp = await fetch(data.signedUrl);
        const blob = await resp.blob();
        const ext = r.storage_path.split(".").pop() || (r.kind === "video" ? "mp4" : "jpg");
        const objUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objUrl;
        link.download = `${event?.name || "laqta"}-${guestCode}-${r.id.slice(0, 6)}.${ext}`;
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
                <img src={a.thumbUrl || a.url} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
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

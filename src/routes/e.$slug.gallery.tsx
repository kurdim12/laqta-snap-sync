import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_CONFIG, type AssetRow, type EventConfig, type EventRow } from "@/lib/types";
import { T, pick, useLang } from "@/lib/i18n";
import { Lightbox } from "@/components/Lightbox";

export const Route = createFileRoute("/e/$slug/gallery")({
  head: () => ({ meta: [{ title: "LAQTA · Gallery" }] }),
  component: PublicGallery,
});

function applyTheme(c: EventConfig) {
  const r = document.documentElement.style;
  if (c.theme.primary) r.setProperty("--primary", c.theme.primary);
  if (c.theme.background) r.setProperty("--background", c.theme.background);
  if (c.theme.text) r.setProperty("--foreground", c.theme.text);
}

async function signedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("media").createSignedUrl(path, 3600);
  if (error || !data) return null;
  return data.signedUrl;
}

type Enriched = AssetRow & { url?: string; thumbUrl?: string };

function PublicGallery() {
  const { slug } = useParams({ from: "/e/$slug/gallery" });
  const [event, setEvent] = useState<EventRow | null>(null);
  const [assets, setAssets] = useState<Enriched[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [liveOn, setLiveOn] = useState(false);
  const cfg = event?.config || DEFAULT_CONFIG;
  const [lang, setLang, toggleable] = useLang(cfg.locale);
  const eventRef = useRef<EventRow | null>(null);
  eventRef.current = event;

  async function loadAssets(ev: EventRow) {
    const { data } = await supabase
      .from("assets")
      .select("*")
      .eq("event_id", ev.id)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(500);
    const rows = (data || []) as AssetRow[];
    const originals = rows.filter((r) => r.variant === "original");
    const webs = rows.filter((r) => r.variant === "web");
    const thumbs = rows.filter((r) => r.variant === "thumb");
    const display = originals.length ? originals : webs.length ? webs : rows;
    const enriched = await Promise.all(display.map(async (r) => {
      const web = webs.find((w) => w.parent_asset_id === r.id) || r;
      const thumb = thumbs.find((t) => t.parent_asset_id === r.id) || web;
      const [url, thumbUrl] = await Promise.all([signedUrl(web.storage_path), signedUrl(thumb.storage_path)]);
      return { ...r, url: url || undefined, thumbUrl: thumbUrl || undefined };
    }));
    setAssets(enriched);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("events")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();
      if (!alive) return;
      if (!data || (data.status !== "live" && data.status !== "dryrun")) {
        setUnavailable(true);
        return;
      }
      const ev: EventRow = {
        ...data,
        status: data.status as EventRow["status"],
        config: { ...DEFAULT_CONFIG, ...(data.config as Partial<EventConfig>) } as EventConfig,
      };
      if (ev.config.gallery.mode !== "public") {
        setUnavailable(true);
        return;
      }
      setEvent(ev);
      applyTheme(ev.config);
      loadAssets(ev);
    })();
    return () => { alive = false; };
  }, [slug]);

  // realtime + polling fallback
  useEffect(() => {
    if (!event) return;
    const ch = supabase
      .channel(`public-gallery-${event.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assets", filter: `event_id=eq.${event.id}` },
        () => { if (eventRef.current) loadAssets(eventRef.current); },
      )
      .subscribe((status) => setLiveOn(status === "SUBSCRIBED"));
    let last = Date.now();
    const onActivity = () => { last = Date.now(); };
    window.addEventListener("pointerdown", onActivity);
    const i = setInterval(() => {
      if (Date.now() - last > 10 * 60_000) return;
      if (eventRef.current) loadAssets(eventRef.current);
    }, 20_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(i);
      window.removeEventListener("pointerdown", onActivity);
    };
  }, [event]);

  if (unavailable) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-6 text-center">
        <div>
          <div className="code-display text-4xl text-primary">LAQTA</div>
          <p className="mt-6 font-arabic text-lg text-muted-foreground">{pick(T.eventUnavailable, "ar")}</p>
          <p className="text-sm text-muted-foreground">{pick(T.eventUnavailable, "en")}</p>
        </div>
      </main>
    );
  }
  if (!event) {
    return <main className="grid min-h-screen place-items-center bg-background"><div className="text-muted-foreground">···</div></main>;
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6">
      <header className="mx-auto flex max-w-6xl items-center justify-between">
        <div>
          {event.config.theme.logoUrl ? (
            <img src={event.config.theme.logoUrl} alt={event.name} className="h-10 object-contain" />
          ) : (
            <div className="text-xl font-bold text-primary">{event.name}</div>
          )}
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{lang === "ar" ? "معرض الفعالية" : "Event gallery"}</span>
            <span className={liveOn ? "text-[color:var(--success)]" : "text-muted-foreground"}>
              {liveOn ? (lang === "ar" ? "● مباشر" : "● live") : (lang === "ar" ? "○ تحديث دوري" : "○ refreshing")}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {toggleable && (
            <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground">
              {lang === "ar" ? "EN" : "ع"}
            </button>
          )}
          <button
            onClick={() => sharePage(event.name)}
            className="rounded-full border border-border bg-card px-3 py-2 text-sm font-semibold"
            aria-label="Share"
          >↗</button>
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
        </section>
      ) : (
        <section className="mx-auto mt-6 grid max-w-6xl grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {assets.map((a, i) => (
            <button
              key={a.id}
              onClick={() => setLightbox(i)}
              className="group relative aspect-square overflow-hidden rounded-lg bg-card animate-in fade-in"
            >
              {a.kind === "video" ? (
                <>
                  <img src={a.thumbUrl || a.url} alt="" className="h-full w-full object-cover" />
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
          shareTitle={event.name}
          showDownload={event.config.gallery.allowDownloadAll}
        />
      )}
    </main>
  );
}

async function sharePage(name: string) {
  const url = typeof window !== "undefined" ? window.location.href : "";
  const data: ShareData = { title: `${name} · LAQTA`, text: `Live photos from ${name}`, url };
  try { if (navigator.share) { await navigator.share(data); return; } } catch { /* cancelled */ }
  try { await navigator.clipboard.writeText(url); } catch { /* noop */ }
}

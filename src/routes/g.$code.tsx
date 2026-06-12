import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_CONFIG, type AssetRow, type EventConfig, type EventRow, type GuestRow } from "@/lib/types";
import { T, pick, useLang } from "@/lib/i18n";
import { Lightbox } from "@/components/Lightbox";

export const Route = createFileRoute("/g/$code")({
  head: () => ({ meta: [{ title: "LAQTA · Your photos" }] }),
  component: Gallery,
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

function Gallery() {
  const { code } = useParams({ from: "/g/$code" });
  const navigate = useNavigate();
  const [guest, setGuest] = useState<GuestRow | null>(null);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [assets, setAssets] = useState<(AssetRow & { url?: string; thumbUrl?: string })[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const cfg = event?.config || DEFAULT_CONFIG;
  const [lang, setLang, toggleable] = useLang(cfg.locale);

  async function load() {
    const { data: gRows } = await supabase.rpc("get_guest_by_code", { _code: code.toUpperCase() });
    const g = Array.isArray(gRows) ? gRows[0] : gRows;
    if (!g) { setNotFound(true); return; }
    setNotFound(false);
    setGuest(g as GuestRow);
    if (!event || event.id !== g.event_id) {
      const { data: e } = await supabase.from("events_public").select("id,slug,name,status,config,created_at").eq("id", g.event_id).maybeSingle();
      if (e && e.id && e.slug && e.name) {
        const ev: EventRow = { id: e.id, slug: e.slug, name: e.name, created_at: e.created_at ?? "", status: e.status as EventRow["status"], config: { ...DEFAULT_CONFIG, ...(e.config as Partial<EventConfig>) } as EventConfig };
        setEvent(ev);
        applyTheme(ev.config);
      }
    }
    const { data: a } = await supabase
      .from("assets")
      .select("*")
      .eq("guest_id", g.id)
      .eq("status", "ready")
      .order("created_at", { ascending: false });
    const rows = (a || []) as AssetRow[];
    // group: prefer web variant for display; thumb for grid
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

  useEffect(() => { load(); }, [code]);

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

  if (!guest) {
    return <main className="grid min-h-screen place-items-center bg-background"><div className="text-muted-foreground">···</div></main>;
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
            {pick(T.yourCode, lang)}: <span className="code-display text-primary" dir="ltr">{guest.code}</span>
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
              onClick={() => downloadAll(assets, `${event?.name || "laqta"}-${guest.code}`)}
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
          <p className="code-display mt-1 text-3xl text-primary" dir="ltr">{guest.code}</p>
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
          shareTitle={event?.name}
        />
      )}
    </main>
  );
}

async function downloadAll(assets: { url?: string; id: string }[], prefix: string) {
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    if (!a.url) continue;
    const link = document.createElement("a");
    link.href = a.url;
    link.download = `${prefix}-${i + 1}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // small stagger so the browser doesn't drop downloads
    await new Promise((r) => setTimeout(r, 350));
  }
}

async function shareGallery(name: string, url: string) {
  const data: ShareData = { title: `${name} · LAQTA`, text: `Photos from ${name}`, url };
  try { if (navigator.share) { await navigator.share(data); return; } } catch { /* cancelled */ }
  try { await navigator.clipboard.writeText(url); } catch { /* noop */ }
}

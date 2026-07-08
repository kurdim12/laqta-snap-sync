import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_CONFIG, type AssetRow, type EventConfig, type EventRow } from "@/lib/types";
import { T, pick, useLang } from "@/lib/i18n";
import { Lightbox } from "@/components/Lightbox";
import { applyEventTheme } from "@/lib/theme";


export const Route = createFileRoute("/e/$slug/gallery")({
  head: () => ({ meta: [{ title: "LAQTA · Gallery" }] }),
  component: PublicGallery,
});


interface GalleryAsset {
  id: string;
  kind: "photo" | "video";
  url?: string;
  thumbUrl?: string;
  album?: string;
}

// Sign a batch of storage paths with the anon client (RLS allows reading
// approved public-wall objects). Returns a path -> signed URL map.
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

// Collapse original/web/thumb variants into one display tile each, mirroring
// the server-side buildEnriched logic.
function enrich(rows: AssetRow[], urls: Record<string, string>): GalleryAsset[] {
  const originals = rows.filter((r) => r.variant === "original");
  const webs = rows.filter((r) => r.variant === "web");
  const thumbs = rows.filter((r) => r.variant === "thumb" || r.variant === "poster");
  const display = originals.length ? originals : webs.length ? webs : rows.filter((r) => r.variant !== "thumb" && r.variant !== "poster");
  return display.map((r) => {
    const isVideo = r.kind === "video";
    const web = webs.find((w) => w.parent_asset_id === r.id);
    const thumb = thumbs.find((t) => t.parent_asset_id === r.id);
    const full = web || r;
    // Photos fall back to the full image as a thumbnail; a video only has an
    // image thumbnail if it has a poster — otherwise the tile shows its frame.
    const thumbAsset = thumb || (isVideo ? undefined : full);
    return {
      id: r.id,
      kind: isVideo ? "video" : "photo",
      url: urls[full.storage_path],
      thumbUrl: thumbAsset ? urls[thumbAsset.storage_path] : undefined,
      album: (r.meta as { album?: string })?.album || "",
    };
  });
}

// Group assets into album sections (preserving each asset's flat index for the
// lightbox). Returns null when nothing has an album, so the flat grid is used.
function groupAlbums(assets: GalleryAsset[]): { name: string; items: { asset: GalleryAsset; index: number }[] }[] | null {
  if (!assets.some((a) => a.album)) return null;
  const map = new Map<string, { asset: GalleryAsset; index: number }[]>();
  assets.forEach((asset, index) => {
    const key = asset.album || "";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push({ asset, index });
  });
  const named = Array.from(map.keys()).filter(Boolean).sort();
  const order = [...named, ...(map.has("") ? [""] : [])];
  return order.map((name) => ({ name, items: map.get(name)! }));
}

function PublicGallery() {
  const { slug } = useParams({ from: "/e/$slug/gallery" });
  const [event, setEvent] = useState<EventRow | null>(null);
  const [assets, setAssets] = useState<GalleryAsset[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const cfg = event?.config || DEFAULT_CONFIG;
  const [lang, setLang, toggleable] = useLang(cfg.locale);

  const themeCleanupRef = useRef<(() => void) | null>(null);

  async function load() {
    try {
      // Read the event via the safe public view (anon-readable, no staff_pin).
      const { data: e } = await supabase
        .from("events_public")
        .select("id,slug,name,status,config,created_at")
        .eq("slug", slug)
        .maybeSingle();
      const ecfg = (e?.config || {}) as Partial<EventConfig>;
      if (!e || !e.id || !e.slug || !e.name || (e.status !== "live" && e.status !== "dryrun") || ecfg.gallery?.mode !== "public") {
        setUnavailable(true);
        return;
      }
      const ev: EventRow = {
        id: e.id, slug: e.slug, name: e.name,
        created_at: e.created_at ?? "",
        status: e.status as EventRow["status"],
        config: { ...DEFAULT_CONFIG, ...ecfg } as EventConfig,
      };
      setEvent(ev);
      if (themeCleanupRef.current) themeCleanupRef.current();
      themeCleanupRef.current = applyEventTheme(ev.config.theme);

      // Only approved, ready photos are visible on the public wall (RLS enforces
      // this too; the explicit filters keep payloads small).
      const { data: aRows } = await supabase
        .from("assets")
        .select("*")
        .eq("event_id", e.id)
        .eq("status", "ready")
        .eq("approved", true)
        .order("created_at", { ascending: false })
        .limit(500);
      const rows = (aRows || []) as AssetRow[];
      const paths = Array.from(new Set(rows.map((r) => r.storage_path)));
      const urls = await signMany(paths);
      setAssets(enrich(rows, urls));
    } catch {
      setUnavailable(true);
    }
  }

  useEffect(() => {
    load();
    return () => {
      if (themeCleanupRef.current) { themeCleanupRef.current(); themeCleanupRef.current = null; }
    };
  }, [slug]);


  useEffect(() => {
    if (unavailable) return;
    let last = Date.now();
    const onActivity = () => { last = Date.now(); };
    window.addEventListener("pointerdown", onActivity);
    const i = setInterval(() => {
      if (Date.now() - last > 10 * 60_000) return;
      load();
    }, 20_000);
    return () => { clearInterval(i); window.removeEventListener("pointerdown", onActivity); };
  }, [unavailable, slug]);

  // Make the browser Back button close an open folder (return to the folder
  // list) instead of leaving the gallery. Opening a folder pushes a history
  // entry; Back pops it and fires popstate.
  useEffect(() => {
    function onPop() { setOpenFolder(null); setLightbox(null); }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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

  function openFolderNav(name: string) {
    setLightbox(null);
    setOpenFolder(name);
    if (typeof window !== "undefined") window.history.pushState({ laqtaFolder: name }, "");
  }

  const tile = (a: GalleryAsset, i: number) => (
    <button
      key={a.id}
      onClick={() => setLightbox(i)}
      className="masonry-item group relative w-full overflow-hidden rounded-lg bg-card animate-in fade-in"
    >
      {a.kind === "video" ? (
        <div className="relative aspect-square">
          {a.thumbUrl ? (
            <img src={a.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : a.url ? (
            <video src={`${a.url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
          ) : (
            <div className="shimmer h-full w-full" />
          )}
          <span className="absolute inset-0 grid place-items-center text-3xl text-white drop-shadow">▶</span>
        </div>
      ) : a.thumbUrl || a.url ? (
        <img
          src={a.thumbUrl || a.url}
          alt=""
          loading="lazy"
          className="block h-auto w-full object-cover transition group-hover:scale-[1.02]"
        />
      ) : (
        <div className="shimmer aspect-square w-full" />
      )}
    </button>
  );
  const groups = groupAlbums(assets);
  const folderAssets = groups && openFolder !== null ? (groups.find((g) => g.name === openFolder)?.items.map((x) => x.asset) || []) : [];
  // The lightbox shows the currently open folder's photos (or the flat list).
  const lightboxItems = groups && openFolder !== null ? folderAssets : assets;


  return (
    <main className="min-h-screen bg-background px-4 py-6">
      <header className="mx-auto flex max-w-6xl items-center justify-between">
        <div>
          {event.config.theme.logoUrl ? (
            <img src={event.config.theme.logoUrl} alt={event.name} className="h-10 object-contain" />
          ) : (
            <div className="text-xl font-bold text-primary">{event.name}</div>
          )}
          <div className="mt-1 text-xs text-muted-foreground">
            {lang === "ar" ? "معرض الفعالية" : "Event gallery"}
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
      ) : groups ? (
        openFolder === null ? (
          // Folders only — no photo previews. Tap a folder to open it.
          <section className="mx-auto mt-6 grid max-w-6xl grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {groups.map((g) => (
              <button
                key={g.name || "_"}
                onClick={() => openFolderNav(g.name)}
                className="group flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-6 transition hover:-translate-y-0.5 hover:border-primary/50"
              >
                <svg viewBox="0 0 24 24" className="h-14 w-14 text-primary transition group-hover:scale-105" fill="currentColor" aria-hidden="true">
                  <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                </svg>
                <div className="w-full text-center">
                  <div className="truncate text-sm font-bold text-foreground">{g.name || (lang === "ar" ? "عام" : "General")}</div>
                  <div className="text-xs text-muted-foreground">{g.items.length} {lang === "ar" ? "عنصر" : "items"}</div>
                </div>
              </button>
            ))}
          </section>
        ) : (
          // Inside a folder — its photos.
          <div className="mx-auto mt-6 max-w-6xl">
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <button
                onClick={() => { if (typeof window !== "undefined") window.history.back(); else setOpenFolder(null); }}
                aria-label={lang === "ar" ? "رجوع" : "Back"}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-bold text-primary shadow-sm transition hover:bg-primary/20 active:scale-95"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d={lang === "ar" ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} /></svg>
                {lang === "ar" ? "رجوع" : "Back"}
              </button>
              <h2 className="flex min-w-0 items-center gap-2 text-lg font-bold">
                <span className="text-primary">📁</span>
                <span className="truncate">{openFolder || (lang === "ar" ? "عام" : "General")}</span>
                <span className="text-sm font-normal text-muted-foreground">· {folderAssets.length}</span>
              </h2>
            </div>
            {folderAssets.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">{pick(T.photosOnTheWay, lang)}</p>
            ) : (
              <section className="masonry">
                {folderAssets.map((a, i) => tile(a, i))}
              </section>
            )}
          </div>
        )
      ) : (
        <section className="masonry mx-auto mt-6 max-w-6xl">
          {assets.map((a, i) => tile(a, i))}
        </section>
      )}


      {lightbox !== null && (
        <Lightbox
          items={lightboxItems}
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

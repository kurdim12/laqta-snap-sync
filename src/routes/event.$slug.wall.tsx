import { createFileRoute, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { getVogueWall, type WallItem } from "@/lib/vogue.functions";

export const Route = createFileRoute("/event/$slug/wall")({
  head: () => ({
    meta: [
      { title: "LYNK & CO 900 — Vogue Cover Wall" },
      {
        name: "description",
        content: "A live wall of guest magazine covers created at the LYNK & CO 900 Vogue Experience.",
      },
      { property: "og:title", content: "LYNK & CO 900 — Vogue Cover Wall" },
      { property: "og:description", content: "Live guest magazine covers from the LYNK & CO 900 activation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VogueWall,
});

function VogueWall() {
  const { slug } = useParams({ from: "/event/$slug/wall" });
  const [items, setItems] = useState<WallItem[]>([]);
  const [hero, setHero] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await getVogueWall({ data: { slug, limit: 60 } });
      setItems(r.items);
    } catch {
      /* keep the last good set on screen */
    }
  }, [slug]);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 8000);
    return () => window.clearInterval(t);
  }, [load]);

  // Auto-cycle the hero in fullscreen mode.
  useEffect(() => {
    if (!fullscreen || items.length === 0) return;
    const t = window.setInterval(() => setHero((h) => (h + 1) % items.length), 6000);
    return () => window.clearInterval(t);
  }, [fullscreen, items.length]);

  async function toggleFullscreen() {
    const next = !fullscreen;
    setFullscreen(next);
    try {
      if (next) await document.documentElement.requestFullscreen();
      else if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* browsers may refuse without a gesture — the layout still switches */
    }
  }

  const current = items[hero % Math.max(1, items.length)];

  return (
    <main className="min-h-dvh bg-[#0B0B0C] text-[#F5F1E8]">
      <div className="flex items-center justify-between px-6 py-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.45em] text-[#C9A227]">LYNK &amp; CO 900</p>
          <h1 className="font-display text-2xl tracking-tight sm:text-3xl">VOGUE COVER WALL</h1>
        </div>
        <button
          onClick={toggleFullscreen}
          className="rounded-full border border-[#F5F1E8]/25 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em]"
        >
          {fullscreen ? "Exit" : "Fullscreen"}
        </button>
      </div>

      {items.length === 0 && (
        <p className="grid place-items-center py-32 text-sm text-[#F5F1E8]/40">Waiting for the first cover…</p>
      )}

      {fullscreen && current ? (
        <div className="grid gap-6 px-6 pb-10 lg:grid-cols-[1.4fr_1fr]">
          <div className="overflow-hidden rounded-3xl border border-[#C9A227]/40">
            <img src={current.url} alt="Featured guest cover" className="h-[78dvh] w-full object-cover" />
          </div>
          <div className="grid grid-cols-2 gap-4 overflow-hidden">
            {items.filter((_, i) => i !== hero % items.length).slice(0, 6).map((it) => (
              <img key={it.id} src={it.url} alt="Guest cover" className="aspect-[2/3] w-full rounded-2xl object-cover opacity-80" />
            ))}
          </div>
        </div>
      ) : (
        <div className="columns-2 gap-4 px-6 pb-12 sm:columns-3 [column-fill:_balance]">
          {items.map((it, i) => (
            <button
              key={it.id}
              onClick={() => { setHero(i); setFullscreen(true); }}
              className="mb-4 block w-full overflow-hidden rounded-2xl border border-[#F5F1E8]/10"
            >
              <img src={it.url} alt="Guest cover" loading="lazy" className="w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </main>
  );
}

import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { getWallBySlug } from "@/lib/gallery.functions";
import { wallOf } from "@/lib/wall";
import type { WallTile } from "@/lib/types";

export const Route = createFileRoute("/wall/$slug")({
  head: () => ({
    meta: [
      { title: "LAQTA · Live Wall" },
      { name: "description", content: "Live photo wall for the event — guest portraits on brand backdrops, refreshed as they arrive." },
      { property: "og:title", content: "LAQTA · Live Wall" },
      { property: "og:description", content: "Live photo wall for the event — guest portraits on brand backdrops." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Wall,
});

type Photo = { id: string; url: string; created_at: string };
type Cell = { kind: "photo"; photo: Photo } | { kind: "tile"; tile: WallTile; key: string };

function Wall() {
  const { slug } = useParams({ from: "/wall/$slug" });
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [missing, setMissing] = useState(false);
  const [offset, setOffset] = useState(0);
  const seen = useRef<Set<string>>(new Set());
  const [flash, setFlash] = useState<Photo | null>(null);

  const wall = useMemo(() => wallOf(config), [config]);

  useEffect(() => {
    let alive = true;
    async function load() {
      const r = await getWallBySlug({ data: { slug } }).catch(() => null);
      if (!alive) return;
      if (!r || !r.event) { setMissing(true); return; }
      setMissing(false);
      setName(r.event.name);
      setConfig(r.event.config as Record<string, unknown>);
      // Celebrate the first new photo of each poll with a full-bleed hero.
      const fresh = r.photos.find((p) => !seen.current.has(p.id));
      const first = seen.current.size === 0;
      r.photos.forEach((p) => seen.current.add(p.id));
      setPhotos(r.photos);
      if (fresh && !first) {
        setFlash(fresh);
        setTimeout(() => setFlash(null), 4500);
      }
    }
    load();
    const i = setInterval(load, 6000);
    return () => { alive = false; clearInterval(i); };
  }, [slug]);

  // Advance the visible window so an event with many photos keeps cycling.
  useEffect(() => {
    const i = setInterval(() => setOffset((o) => o + 1), wall.intervalSec * 1000);
    return () => clearInterval(i);
  }, [wall.intervalSec]);

  const rows = 4;
  const capacity = wall.columns * rows;

  const cells: Cell[] = useMemo(() => {
    if (photos.length === 0) return [];
    const out: Cell[] = [];
    const start = photos.length ? (offset * wall.columns) % photos.length : 0;
    let t = 0;
    for (let i = 0; i < capacity; i++) {
      // one brand tile every 5th cell, exactly like the reference wall
      if (i > 0 && i % 5 === 4 && wall.tiles.length) {
        out.push({ kind: "tile", tile: wall.tiles[t % wall.tiles.length], key: `t${i}-${t}` });
        t++;
      } else {
        out.push({ kind: "photo", photo: photos[(start + i) % photos.length] });
      }
    }
    return out;
  }, [photos, offset, capacity, wall.columns, wall.tiles]);

  if (missing) {
    return (
      <main className="grid min-h-screen place-items-center bg-black text-center text-white">
        <div>
          <div className="code-display text-5xl">LAQTA</div>
          <p className="mt-4 text-white/60">This wall is not available</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-black">
      <div
        className="grid h-screen w-screen gap-1 p-1"
        style={{ gridTemplateColumns: `repeat(${wall.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      >
        {cells.length === 0 && (
          <div className="col-span-full row-span-full grid place-items-center text-center text-white">
            <div>
              <div className="code-display text-6xl">{name || "LAQTA"}</div>
              <p className="mt-4 animate-pulse text-white/50">Waiting for the first photo…</p>
            </div>
          </div>
        )}
        {cells.map((c, i) =>
          c.kind === "photo" ? (
            <div key={`${c.photo.id}-${i}`} className="relative overflow-hidden">
              <img src={c.photo.url} alt="" loading="lazy" className="h-full w-full object-cover animate-in fade-in duration-700" />
            </div>
          ) : (
            <div
              key={c.key}
              className="grid place-items-center p-4 text-center"
              style={{ background: c.tile.background, color: c.tile.color }}
            >
              <span className="text-[clamp(0.9rem,2vw,2.2rem)] font-black uppercase leading-tight tracking-tight">
                {c.tile.text}
              </span>
            </div>
          ),
        )}
      </div>

      {flash && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/90 animate-in fade-in duration-300">
          <img src={flash.url} alt="" className="max-h-[86vh] max-w-[86vw] object-contain shadow-2xl" />
        </div>
      )}
    </main>
  );
}

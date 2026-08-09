import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { getWallBySlug } from "@/lib/gallery.functions";
import { wallOf } from "@/lib/wall";
import type { WallTile } from "@/lib/types";

export const Route = createFileRoute("/wall/$slug")({
  head: () => ({
    meta: [
      { title: "LAQTA · Live Portrait Wall" },
      { name: "description", content: "A live installation wall of guest portraits on vivid LAQTA backdrops, updating as new shots land." },
      { property: "og:title", content: "LAQTA · Live Portrait Wall" },
      { property: "og:description", content: "A live installation wall of guest portraits on vivid LAQTA backdrops." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Wall,
});

type Photo = { id: string; url: string; created_at: string };
type Cell =
  | { kind: "photo"; photo: Photo; key: string }
  | { kind: "tile"; tile: WallTile; key: string }
  | { kind: "placeholder"; key: string; hue: number };

/** Vivid backlit panel colours, echoing the reference installation. */
const PLACEHOLDER_GRADIENTS = [
  "linear-gradient(160deg,#7C3AED,#2563EB)",
  "linear-gradient(160deg,#06B6D4,#34D399)",
  "linear-gradient(160deg,#F43F5E,#F59E0B)",
  "linear-gradient(160deg,#EC4899,#8B5CF6)",
  "linear-gradient(160deg,#0EA5E9,#1E1B4B)",
  "linear-gradient(160deg,#22D3EE,#3B82F6)",
];

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

  useEffect(() => {
    const i = setInterval(() => setOffset((o) => o + 1), wall.intervalSec * 1000);
    return () => clearInterval(i);
  }, [wall.intervalSec]);

  const rows = 6;
  const capacity = wall.columns * rows;

  const cells: Cell[] = useMemo(() => {
    const out: Cell[] = [];
    const tileCount = wall.tiles.length;

    // Seeded RNG so a given rotation is stable across re-renders but the
    // brand tiles land in genuinely random cells (and random order) each cycle.
    let s = (offset * 2654435761 + 97) >>> 0;
    const rand = () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };

    const slots = new Set<number>();
    if (tileCount) {
      while (slots.size < Math.min(tileCount, capacity)) {
        slots.add(Math.floor(rand() * capacity));
      }
    }

    // random tile order for this rotation
    const order = wall.tiles.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    const start = photos.length ? Math.floor(rand() * photos.length) : 0;
    let t = 0;
    let p = 0;
    for (let i = 0; i < capacity; i++) {
      if (slots.has(i)) {
        const tile = wall.tiles[order[t % order.length]];
        out.push({ kind: "tile", tile, key: `t${i}-${offset}` });
        t++;

      } else if (photos.length) {
        const photo = photos[(start + p) % photos.length];
        out.push({ kind: "photo", photo, key: `p${i}-${photo.id}` });
        p++;
      } else {
        out.push({ kind: "placeholder", key: `ph${i}`, hue: i + offset });
      }
    }
    return out;
  }, [photos, offset, capacity, wall.columns, wall.tiles]);

  if (missing) {
    return (
      <main className="grid min-h-screen place-items-center bg-black text-center text-white">
        <div>
          <div className="text-6xl font-black tracking-[0.35em]">LAQTA</div>
          <p className="mt-4 text-white/50">This wall is not available</p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-black">
      {/* room glow behind the tower */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(65% 45% at 50% 30%, rgba(56,189,248,0.10), transparent 70%)" }}
      />

      {/* the tower */}
      <div className="relative mx-auto flex h-screen max-w-[min(100vw,calc(100vh*0.56))] flex-col px-[1.2vh] py-[1.2vh]">
        <div className="mb-[1vh] flex items-center justify-between px-[0.4vh]">
          <span className="text-[1.5vh] font-black uppercase tracking-[0.5em] text-white/80">LAQTA</span>
          <span className="truncate text-[1.2vh] font-semibold uppercase tracking-[0.3em] text-white/35">{name}</span>
        </div>

        <div
          className="grid min-h-0 flex-1 gap-[0.7vh] rounded-[0.6vh] bg-black p-[0.7vh] ring-1 ring-white/10"
          style={{
            gridTemplateColumns: `repeat(${wall.columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            boxShadow: "0 0 12vh rgba(59,130,246,0.15)",
          }}
        >
          {cells.map((c) =>
            c.kind === "photo" ? (
              <figure
                key={c.key}
                className="relative overflow-hidden bg-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
              >
                <img
                  src={c.photo.url}
                  alt=""
                  loading="lazy"
                  className="soft-pop h-full w-full object-cover"
                />
                {/* backlit panel: inner bevel + soft top sheen */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    boxShadow: "inset 0 0 3vh rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.10)",
                    background: "linear-gradient(180deg, rgba(255,255,255,0.10), transparent 35%)",
                  }}
                />
              </figure>
            ) : c.kind === "tile" ? (
              <div
                key={c.key}
                className="soft-pop relative grid place-items-center overflow-hidden p-[1vh] text-center"
                style={{ background: c.tile.background, color: c.tile.color }}
              >
                {c.tile.kind === "empty" ? null : c.tile.kind === "logo" ? (
                  <span className="text-[clamp(0.7rem,2.1vh,2rem)] font-black uppercase tracking-[0.35em]">
                    {c.tile.text || "LAQTA"}
                  </span>
                ) : (
                  <span className="text-[clamp(0.9rem,3.1vh,3rem)] font-black uppercase leading-[0.95] tracking-tight">
                    {c.tile.text}
                  </span>
                )}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)" }}
                />
              </div>
            ) : (
              <div
                key={c.key}
                className="relative grid animate-pulse place-items-center overflow-hidden"
                style={{ background: PLACEHOLDER_GRADIENTS[c.hue % PLACEHOLDER_GRADIENTS.length], opacity: 0.5 }}
              >
                <span className="text-[1.3vh] font-black uppercase tracking-[0.3em] text-white/80">Your shot here</span>
              </div>
            ),
          )}
        </div>

        <div className="mt-[1vh] flex items-center justify-center gap-[1.5vh] px-[0.4vh] text-[1.2vh] font-semibold uppercase tracking-[0.35em] text-white/40">
          <span>Take your shot</span>
          <span className="text-white/20">·</span>
          <span>Pick your fit</span>
          <span className="text-white/20">·</span>
          <span>Live on the wall</span>
        </div>
      </div>

      {flash && (
        <div className="fixed inset-0 z-50 grid animate-in place-items-center bg-black/92 fade-in duration-500">
          <img
            src={flash.url}
            alt=""
            className="max-h-[84vh] max-w-[84vw] object-contain shadow-[0_0_18vh_rgba(56,189,248,0.35)]"
          />
        </div>
      )}
    </main>
  );
}

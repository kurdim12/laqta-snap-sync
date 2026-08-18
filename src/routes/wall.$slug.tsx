import { createFileRoute, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getWallBySlug } from "@/lib/gallery.functions";
import { brandCellSlots, wallOf } from "@/lib/wall";
import { backdropOf, cellBackgroundCss, halftoneCss, pickCellColor, RECESS_SHADOW } from "@/lib/backdrop";
import type { WallBox } from "@/lib/types";

export const Route = createFileRoute("/wall/$slug")({
  head: () => ({
    meta: [
      { title: "LAQTA · Live Lightbox Wall" },
      { name: "description", content: "A live LED lightbox wall of guest portraits, one cell flipping at a time as new shots land." },
      { property: "og:title", content: "LAQTA · Live Lightbox Wall" },
      { property: "og:description", content: "A live LED lightbox wall of guest portraits, flipping cell by cell." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Wall,
});

type Photo = { id: string; url: string; created_at: string };

type Face =
  | { kind: "photo"; photo: Photo }
  | { kind: "brand"; box: WallBox; line: string; color: string }
  | { kind: "empty"; color: string };

/**
 * One cell of the wall as a two-faced card. The face on show is the parity of
 * `turns`; the other face is where the next content is staged before the turn.
 * `turns` only ever increments, so every flip rotates the same way and the DOM
 * node is reused — the wall can run for hours without growing.
 */
type Cell = { a: Face; b: Face; turns: number };

const visibleFace = (c: Cell): Face => (c.turns % 2 === 0 ? c.a : c.b);

function Wall() {
  const { slug } = useParams({ from: "/wall/$slug" });
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [missing, setMissing] = useState(false);
  const [board, setBoard] = useState<Cell[] | null>(null);
  const [rows, setRows] = useState(6);
  const [idle, setIdle] = useState(false);

  const photosRef = useRef<Photo[]>([]);
  const seen = useRef<Set<string>>(new Set());
  /** photos that landed since the wall opened — they jump the queue onto the wall */
  const arrivals = useRef<Photo[]>([]);
  const boardRef = useRef<Cell[] | null>(null);
  const photoCursor = useRef(0);
  const lineCursor = useRef<Record<number, number>>({});
  const colorCursor = useRef(0);
  const configKey = useRef("");
  const gridRef = useRef<HTMLDivElement | null>(null);

  const wall = useMemo(() => wallOf(config), [config]);
  const backdrop = useMemo(() => backdropOf(config), [config]);
  const palette = backdrop.cells;
  const capacity = wall.columns * rows;

  const boxesKey = useMemo(() => JSON.stringify(wall.boxes), [wall.boxes]);
  const paletteKey = useMemo(() => JSON.stringify(palette), [palette]);

  /** brand cell index -> which box sits there */
  const slotOf = useMemo(() => {
    const slots = brandCellSlots(capacity, wall.columns, Math.max(1, wall.boxes.length * 3));
    const m = new Map<number, number>();
    slots.forEach((cell, i) => m.set(cell, i % Math.max(1, wall.boxes.length)));
    return m;
  }, [capacity, wall.columns, wall.boxes.length]);

  const colorAt = useCallback(
    (seed: string) => pickCellColor(seed, palette),
    [palette],
  );

  /* ---------------- grid sizing: square cells filling the screen -------- */
  useEffect(() => {
    function measure() {
      const el = gridRef.current;
      if (!el) return;
      const cell = el.clientWidth / wall.columns;
      setRows(Math.max(1, Math.round(el.clientHeight / Math.max(1, cell))));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [wall.columns]);

  /* ---------------- polling ------------------------------------------- */
  useEffect(() => {
    let alive = true;
    async function load() {
      // Never an error screen on a venue display: keep the last good state.
      const r = await getWallBySlug({ data: { slug } }).catch(() => null);
      if (!alive || !r) return;
      if (!r.event) { setMissing(true); return; }
      setMissing(false);

      const nextConfig = (r.event.config || {}) as Record<string, unknown>;
      const cKey = JSON.stringify(nextConfig);
      if (cKey !== configKey.current) {
        configKey.current = cKey;
        setConfig(nextConfig);
      }

      const first = seen.current.size === 0;
      const fresh = r.photos.filter((p) => !seen.current.has(p.id));
      r.photos.forEach((p) => seen.current.add(p.id));
      photosRef.current = r.photos;
      // Newest unseen photos jump the queue so a guest sees themselves within
      // roughly one flip of their photo finishing.
      if (fresh.length && !first) arrivals.current.unshift(...fresh);
      if (first && r.photos.length) setBoard((b) => (b ? b : null) ?? null);
    }
    load();
    const i = setInterval(load, 8000);
    return () => { alive = false; clearInterval(i); };
  }, [slug]);

  /* ---------------- build / rebuild the grid --------------------------- */
  const buildBoard = useCallback((): Cell[] => {
    const prev = boardRef.current;
    const photos = photosRef.current;
    const cells: Cell[] = [];
    let p = 0;
    for (let i = 0; i < capacity; i++) {
      const boxIdx = slotOf.get(i);
      let face: Face;
      if (boxIdx !== undefined && wall.boxes[boxIdx]) {
        const box = wall.boxes[boxIdx];
        face = { kind: "brand", box, line: box.lines[0] ?? "", color: box.background || colorAt(`b${i}`) };
      } else if (photos.length) {
        face = { kind: "photo", photo: photos[p % photos.length] };
        p++;
      } else {
        // fewer photos than cells: fill the rest with colour so the wall is never empty
        face = { kind: "empty", color: colorAt(`e${i}`) };
      }
      const keep = prev && prev[i] ? prev[i] : null;
      const turns = keep ? keep.turns : 0;
      cells.push(turns % 2 === 0
        ? { a: face, b: keep ? keep.b : face, turns }
        : { a: keep ? keep.a : face, b: face, turns });
    }
    photoCursor.current = photos.length ? p % photos.length : 0;
    return cells;
  }, [capacity, slotOf, wall.boxes, colorAt]);

  const hasPhotos = photosRef.current.length > 0;
  useEffect(() => {
    const cells = buildBoard();
    boardRef.current = cells;
    setBoard(cells);
  }, [buildBoard, boxesKey, paletteKey, hasPhotos]);

  // Re-seed once the first photos land (the poll writes into a ref, so nudge it).
  useEffect(() => {
    const t = setInterval(() => {
      const b = boardRef.current;
      if (!b || !photosRef.current.length) return;
      if (b.some((c) => visibleFace(c).kind === "photo")) return;
      const cells = buildBoard();
      boardRef.current = cells;
      setBoard(cells);
    }, 2000);
    return () => clearInterval(t);
  }, [buildBoard]);

  /* ---------------- the flip ------------------------------------------- */
  const pickPhoto = useCallback((idx: number, cells: Cell[]): Photo | null => {
    const pool = photosRef.current;
    if (!pool.length) return null;
    const onScreen = new Set<string>();
    cells.forEach((c) => {
      const f = visibleFace(c);
      if (f.kind === "photo") onScreen.add(f.photo.id);
    });

    while (arrivals.current.length) {
      const p = arrivals.current.shift();
      if (p && pool.some((x) => x.id === p.id) && !onScreen.has(p.id)) return p;
    }
    for (let k = 0; k < pool.length; k++) {
      const p = pool[(photoCursor.current + k) % pool.length];
      if (!onScreen.has(p.id)) {
        photoCursor.current = (photoCursor.current + k + 1) % pool.length;
        return p;
      }
    }
    // every shot is already up — still turn to a different one
    const cur = visibleFace(cells[idx]);
    const curId = cur.kind === "photo" ? cur.photo.id : null;
    for (let k = 0; k < pool.length; k++) {
      const p = pool[(photoCursor.current + k) % pool.length];
      if (p.id !== curId) {
        photoCursor.current = (photoCursor.current + k + 1) % pool.length;
        return p;
      }
    }
    return null;
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const lo = Math.max(1, wall.flipMinSec) * 1000;
    const hi = Math.max(lo, wall.flipMaxSec * 1000);

    function tick() {
      const prev = boardRef.current;
      if (prev && prev.length) {
        // one random cell — with a fresh arrival waiting, prefer a photo cell
        const wantPhoto = arrivals.current.length > 0;
        const candidates: number[] = [];
        for (let i = 0; i < prev.length; i++) {
          const isBrand = slotOf.has(i);
          if (wantPhoto ? !isBrand : true) candidates.push(i);
        }
        const idx = candidates[Math.floor(Math.random() * candidates.length)] ?? 0;
        const boxIdx = slotOf.get(idx);
        let next: Face | null = null;

        if (boxIdx !== undefined && wall.boxes[boxIdx]) {
          const box = wall.boxes[boxIdx];
          const at = ((lineCursor.current[boxIdx] ?? 0) + 1) % Math.max(1, box.lines.length);
          lineCursor.current[boxIdx] = at;
          colorCursor.current++;
          next = {
            kind: "brand",
            box,
            line: box.lines[at] ?? "",
            color: box.background || colorAt(`b${idx}-${colorCursor.current}`),
          };
        } else {
          const photo = pickPhoto(idx, prev);
          next = photo
            ? { kind: "photo", photo }
            : { kind: "empty", color: colorAt(`e${idx}-${++colorCursor.current}`) };
        }

        if (next) {
          const cell = prev[idx];
          const out = prev.slice();
          out[idx] = cell.turns % 2 === 0
            ? { ...cell, b: next, turns: cell.turns + 1 }
            : { ...cell, a: next, turns: cell.turns + 1 };
          boardRef.current = out;
          setBoard(out);
        }
      }
      if (!stopped) timer = setTimeout(tick, lo + Math.random() * (hi - lo));
    }

    timer = setTimeout(tick, lo + Math.random() * (hi - lo));
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [slotOf, boxesKey, wall.boxes, wall.flipMinSec, wall.flipMaxSec, pickPhoto, colorAt]);

  /* ---------------- chrome-free kiosk behaviour ------------------------ */
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 3000);
    };
    wake();
    window.addEventListener("mousemove", wake);
    return () => { clearTimeout(t); window.removeEventListener("mousemove", wake); };
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* browsers may refuse without a gesture */ }
  }

  const halftone = backdrop.halftone ? halftoneCss(backdrop.halftoneOpacity) : null;

  const renderFace = useCallback((face: Face) => {
    const color = face.kind === "photo" ? null : face.color;
    return (
      <div className="relative h-full w-full overflow-hidden bg-black">
        {face.kind === "photo" ? (
          <img src={face.photo.url} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0" style={{ background: cellBackgroundCss(color || "#6C2BD9") }} />
        )}

        {face.kind !== "photo" && halftone && (
          <span aria-hidden className="pointer-events-none absolute inset-0" style={halftone} />
        )}

        {face.kind === "brand" && (
          <div className="absolute inset-0 grid place-items-center p-[8%] text-center">
            {face.box.kind === "logo" && face.box.imageUrl ? (
              <img src={face.box.imageUrl} alt="" className="max-h-[45%] max-w-[80%] object-contain" />
            ) : (
              <span
                className="font-black uppercase leading-[0.95] tracking-tight"
                style={{
                  color: face.box.color || "#FFFFFF",
                  fontSize: face.box.kind === "logo" ? "clamp(0.6rem,1.9vh,2rem)" : "clamp(0.7rem,2.6vh,2.6rem)",
                  letterSpacing: face.box.kind === "logo" ? "0.28em" : undefined,
                }}
              >
                {face.line}
              </span>
            )}
          </div>
        )}

        {/* recessed lightbox edge */}
        <span aria-hidden className="pointer-events-none absolute inset-0" style={{ boxShadow: RECESS_SHADOW }} />
      </div>
    );
  }, [halftone]);

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
    <main
      className="relative h-screen w-screen overflow-hidden bg-black"
      style={{ cursor: idle ? "none" : "auto" }}
      onDoubleClick={toggleFullscreen}
    >
      <div
        ref={gridRef}
        className="grid h-full w-full gap-[0.5vh] bg-black p-[0.5vh]"
        style={{
          gridTemplateColumns: `repeat(${wall.columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {(board ?? []).map((cell, i) => (
          <div
            key={i}
            className="flip-cell relative min-h-0"
            style={{ "--flip-ms": `${wall.flipMs}ms` } as React.CSSProperties}
          >
            <div className="flip-inner" style={{ transform: `rotateY(${cell.turns * 180}deg)` }}>
              <div className="flip-face">{renderFace(cell.a)}</div>
              <div className="flip-face flip-face-b">{renderFace(cell.b)}</div>
            </div>
          </div>
        ))}
      </div>

      {!idle && (
        <button
          onClick={toggleFullscreen}
          className="absolute bottom-4 right-4 rounded-full border border-white/25 bg-black/60 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.25em] text-white/80"
        >
          Fullscreen
        </button>
      )}
    </main>
  );
}

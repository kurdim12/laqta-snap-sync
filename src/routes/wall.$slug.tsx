import { createFileRoute, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getWallBySlug } from "@/lib/gallery.functions";
import { WALL_ROWS, brandSlots, flipOrder, wallOf } from "@/lib/wall";
import type { WallBox } from "@/lib/types";

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

type Face =
  | { kind: "photo"; photo: Photo }
  | { kind: "box"; box: WallBox; line: string }
  | { kind: "placeholder"; hue: number };

/**
 * One cell of the wall, as a two-faced card. The face on show is the parity of
 * `turns`; the other face is where the next content is staged before the turn.
 * `turns` only increments so every flip rotates the same way.
 */
type Cell = { a: Face; b: Face; turns: number };

const visibleFace = (c: Cell): Face => (c.turns % 2 === 0 ? c.a : c.b);

function sameFace(x: Face, y: Face): boolean {
  if (x.kind !== y.kind) return false;
  if (x.kind === "photo" && y.kind === "photo") return x.photo.id === y.photo.id;
  if (x.kind === "box" && y.kind === "box") return x.line === y.line && x.box.background === y.box.background;
  if (x.kind === "placeholder" && y.kind === "placeholder") return x.hue === y.hue;
  return false;
}

/** Vivid backlit panel colours, echoing the reference installation. */
const PLACEHOLDER_GRADIENTS = [
  "linear-gradient(160deg,#7C3AED,#2563EB)",
  "linear-gradient(160deg,#06B6D4,#34D399)",
  "linear-gradient(160deg,#F43F5E,#F59E0B)",
  "linear-gradient(160deg,#EC4899,#8B5CF6)",
  "linear-gradient(160deg,#0EA5E9,#1E1B4B)",
  "linear-gradient(160deg,#22D3EE,#3B82F6)",
];

/**
 * Fill the grid in one go. Only used for the first paint (and when the grid
 * shape changes) — after that the wall never rebuilds wholesale, it turns one
 * cell per tick.
 */
function buildBoard(
  capacity: number,
  slotOf: Map<number, number>,
  boxes: WallBox[],
  photos: Photo[],
  prev: Cell[] | null,
): { cells: Cell[]; photoCursor: number } {
  const cells: Cell[] = [];
  let p = 0;
  for (let i = 0; i < capacity; i++) {
    const boxIdx = slotOf.get(i);
    let face: Face;
    if (boxIdx !== undefined && boxes[boxIdx]) {
      const box = boxes[boxIdx];
      face = { kind: "box", box, line: box.lines[0] ?? "" };
    } else if (photos.length) {
      face = { kind: "photo", photo: photos[p % photos.length] };
      p++;
    } else {
      face = { kind: "placeholder", hue: i };
    }
    // Carry the cell's accumulated rotation over and write the new content onto
    // the face that is ALREADY up. `turns` drives an inline rotateY() that CSS
    // transitions, and the cells are keyed by position, so resetting to 0 here
    // would reuse the same DOM node and animate rotateY(2880deg) -> rotateY(0deg):
    // the entire wall counter-spinning through a dozen revolutions together —
    // the exact all-at-once behaviour this rewrite exists to remove.
    const keep = prev && prev[i] ? prev[i] : null;
    const turns = keep ? keep.turns : 0;
    cells.push(
      turns % 2 === 0
        ? { a: face, b: keep ? keep.b : face, turns }
        : { a: keep ? keep.a : face, b: face, turns },
    );
  }
  return { cells, photoCursor: photos.length ? p % photos.length : 0 };
}

function Wall() {
  const { slug } = useParams({ from: "/wall/$slug" });
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [missing, setMissing] = useState(false);
  const [board, setBoard] = useState<Cell[] | null>(null);
  const [flash, setFlash] = useState<Photo | null>(null);

  const seen = useRef<Set<string>>(new Set());
  const photosRef = useRef<Photo[]>([]);
  /** photos that landed since the wall opened — they jump the queue onto the wall */
  const arrivals = useRef<Photo[]>([]);
  const boardRef = useRef<Cell[] | null>(null);
  const cursor = useRef(0);
  const photoCursor = useRef(0);
  const lineCursor = useRef<number[]>([]);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** last config/photo payloads, serialised — the poll re-fetches every 6s and
   * must not hand React a new object each time, or `wall` would change identity
   * and tear down the flip interval before it ever fires. */
  const configKey = useRef<string>("");
  const photosKey = useRef<string>("");

  const wall = useMemo(() => wallOf(config), [config]);
  const capacity = wall.columns * WALL_ROWS;

  // Identity-stable keys: wallOf() rebuilds its objects on every render, so the
  // effects below must key off content, not array identity.
  const boxesKey = useMemo(() => JSON.stringify(wall.boxes), [wall.boxes]);

  const slotOf = useMemo(() => {
    const slots = brandSlots(capacity, wall.columns, wall.boxes.length);
    const m = new Map<number, number>();
    slots.forEach((cell, i) => m.set(cell, i));
    return m;
  }, [capacity, wall.columns, wall.boxes.length]);

  const order = useMemo(
    () => flipOrder(capacity, wall.columns, wall.pattern),
    [capacity, wall.columns, wall.pattern],
  );

  useEffect(() => {
    let alive = true;
    async function load() {
      const r = await getWallBySlug({ data: { slug } }).catch(() => null);
      if (!alive) return;
      if (!r || !r.event) { setMissing(true); return; }
      setMissing(false);
      setName(r.event.name);

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
      const pKey = r.photos.map((p) => p.id).join(",");
      if (pKey !== photosKey.current) {
        photosKey.current = pKey;
        setPhotos(r.photos);
      }

      if (fresh.length && !first) {
        // newest first, so the freshest face reaches the wall soonest
        arrivals.current.push(...fresh);
        setFlash(fresh[0]);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(null), 4500);
      }
    }
    load();
    const i = setInterval(load, 6000);
    return () => {
      alive = false;
      clearInterval(i);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [slug]);

  // Full rebuild ONLY when the grid shape changes, or when the very first photos
  // arrive (so the wall opens full instead of filling one cell per tick). Brand
  // copy deliberately does not appear here: re-seeding every photo cell because
  // someone fixed a typo is a whole-grid change, which is what we are avoiding.
  const hasPhotos = photos.length > 0;
  useEffect(() => {
    const { cells, photoCursor: nextCursor } = buildBoard(
      capacity, slotOf, wall.boxes, photosRef.current, boardRef.current,
    );
    cursor.current = 0;
    photoCursor.current = nextCursor;
    lineCursor.current = wall.boxes.map(() => 0);
    arrivals.current = [];
    boardRef.current = cells;
    setBoard(cells);
    // wall.boxes is re-created each render; its content is tracked by the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capacity, slotOf, hasPhotos]);

  // Brand copy/colour edits land in place on the face already showing, leaving
  // rotation and every photo cell untouched.
  useEffect(() => {
    const prev = boardRef.current;
    if (!prev) return;
    const out = prev.slice();
    let touched = false;
    slotOf.forEach((boxIdx, cellIdx) => {
      const box = wall.boxes[boxIdx];
      if (!box || cellIdx >= out.length) return;
      const at = Math.min(lineCursor.current[boxIdx] ?? 0, box.lines.length - 1);
      lineCursor.current[boxIdx] = Math.max(0, at);
      const face: Face = { kind: "box", box, line: box.lines[Math.max(0, at)] ?? "" };
      const cell = out[cellIdx];
      if (sameFace(face, visibleFace(cell))) return;
      out[cellIdx] = cell.turns % 2 === 0 ? { ...cell, a: face } : { ...cell, b: face };
      touched = true;
    });
    if (!touched) return;
    boardRef.current = out;
    setBoard(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxesKey, slotOf]);

  /** The next photo for cell `idx`, preferring one not already on the wall. */
  const pickPhoto = useCallback((idx: number, cells: Cell[]): Photo | null => {
    const pool = photosRef.current;
    if (!pool.length) return null;

    // Every photo currently up, INCLUDING this cell's own — leaving itself out
    // would let the search hand back the shot already showing here, and the
    // no-op guard below would then skip the turn and stall the wall.
    const onScreen = new Set<string>();
    cells.forEach((c) => {
      const f = visibleFace(c);
      if (f.kind === "photo") onScreen.add(f.photo.id);
    });

    // brand-new arrivals first
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

    // Fewer photos than cells: every shot is already up. Still turn to a
    // different one so the wall keeps breathing instead of freezing.
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

  // The heartbeat: exactly one cell turns per tick, walking `order` so every
  // cell turns once before any turns twice.
  useEffect(() => {
    if (!order.length) return;
    const id = setInterval(() => {
      const prev = boardRef.current;
      if (!prev || !prev.length) return;

      const idx = order[cursor.current % order.length];
      cursor.current++;
      if (idx >= prev.length) return;

      const boxIdx = slotOf.get(idx);
      let next: Face | null;
      if (boxIdx !== undefined) {
        const box = wall.boxes[boxIdx];
        if (!box) return;
        // A one-line box (the logo) turns over onto itself rather than eating
        // its tick — skipping it would leave a double-length dead gap in a
        // cadence that is supposed to be even.
        const at = ((lineCursor.current[boxIdx] ?? 0) + 1) % Math.max(1, box.lines.length);
        lineCursor.current[boxIdx] = at;
        next = { kind: "box", box, line: box.lines[at] ?? "" };
      } else {
        const photo = pickPhoto(idx, prev);
        next = photo ? { kind: "photo", photo } : null;
      }
      if (!next) return;

      const cell = prev[idx];
      // Only photos are worth suppressing when unchanged; a brand box turning
      // onto the same line is a deliberate beat, not a wasted flip.
      if (next.kind === "photo" && sameFace(next, visibleFace(cell))) return;

      const out = prev.slice();
      out[idx] = cell.turns % 2 === 0
        ? { ...cell, b: next, turns: cell.turns + 1 }
        : { ...cell, a: next, turns: cell.turns + 1 };
      boardRef.current = out;
      setBoard(out);
    }, wall.intervalSec * 1000);
    return () => clearInterval(id);
  }, [order, slotOf, boxesKey, wall.intervalSec, wall.boxes, pickPhoto]);

  const renderFace = useCallback((face: Face) => {
    if (face.kind === "photo") {
      return (
        <figure className="relative h-full w-full overflow-hidden bg-black">
          <img src={face.photo.url} alt="" loading="lazy" className="h-full w-full object-cover" />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              boxShadow: "inset 0 0 3vh rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.10)",
              background: "linear-gradient(180deg, rgba(255,255,255,0.10), transparent 35%)",
            }}
          />
        </figure>
      );
    }
    if (face.kind === "box") {
      return (
        <div
          className="relative grid h-full w-full place-items-center overflow-hidden p-[1vh] text-center"
          style={{ background: face.box.background, color: face.box.color }}
        >
          {face.box.kind === "logo" ? (
            <span className="text-[clamp(0.7rem,2.1vh,2rem)] font-black uppercase tracking-[0.35em]">
              {face.line || "LAQTA"}
            </span>
          ) : (
            <span className="text-[clamp(0.9rem,3.1vh,3rem)] font-black uppercase leading-[0.95] tracking-tight">
              {face.line}
            </span>
          )}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)" }}
          />
        </div>
      );
    }
    return (
      <div
        className="relative grid h-full w-full animate-pulse place-items-center overflow-hidden"
        style={{ background: PLACEHOLDER_GRADIENTS[face.hue % PLACEHOLDER_GRADIENTS.length], opacity: 0.5 }}
      >
        <span className="text-[1.3vh] font-black uppercase tracking-[0.3em] text-white/80">Your shot here</span>
      </div>
    );
  }, []);

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
            gridTemplateRows: `repeat(${WALL_ROWS}, minmax(0, 1fr))`,
            boxShadow: "0 0 12vh rgba(59,130,246,0.15)",
          }}
        >
          {(board ?? []).map((cell, i) => (
            <div
              key={i}
              className="flip-cell relative min-h-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
              style={{ "--flip-ms": `${wall.flipMs}ms` } as React.CSSProperties}
            >
              <div className="flip-inner" style={{ transform: `rotateY(${cell.turns * 180}deg)` }}>
                <div className="flip-face">{renderFace(cell.a)}</div>
                <div className="flip-face flip-face-b">{renderFace(cell.b)}</div>
              </div>
            </div>
          ))}
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

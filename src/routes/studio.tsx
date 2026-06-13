import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_CONFIG, type EventConfig, type EventRow } from "@/lib/types";
import { pick, T } from "@/lib/i18n";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AuthForm,
  NotAuthorized,
  EventEditor,
  PhotosModal,
  RegistrationsModal,
  QrModal,
  ConfirmModal,
} from "./admin";

export const Route = createFileRoute("/studio")({
  head: () => ({ meta: [{ title: "LAQTA · Studio" }] }),
  component: Studio,
});

/* ------------------------------------------------------------------ */
/* Auth gate (mirrors /admin)                                          */
/* ------------------------------------------------------------------ */
function Studio() {
  const [session, setSession] = useState<unknown>(undefined);
  const [role, setRole] = useState<"admin" | "none" | "loading">("loading");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setRole("none"); return; }
    setRole("loading");
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { setRole("none"); return; }
      const { data, error } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
      setRole(!error && data === true ? "admin" : "none");
    })();
  }, [session]);

  if (session === undefined || (session && role === "loading")) {
    return <main className="grid min-h-screen place-items-center bg-background"><div className="text-muted-foreground">···</div></main>;
  }
  if (!session) return <AuthForm />;
  if (role !== "admin") return <NotAuthorized />;
  return <StudioDashboard />;
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */
type Counts = Record<string, { guests: number; photos: number }>;

function StudioDashboard() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [covers, setCovers] = useState<Record<string, string[]>>({});
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<"all" | EventRow["status"]>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data } = await supabase.from("events").select("*").order("created_at", { ascending: false });
    const rows = (data || []).map((d) => ({ ...d, status: d.status as EventRow["status"], config: { ...DEFAULT_CONFIG, ...(d.config as Partial<EventConfig>) } })) as EventRow[];
    setEvents(rows);
    setLoading(false);
    const c: Counts = {};
    const cov: Record<string, string[]> = {};
    await Promise.all(rows.map(async (ev) => {
      const [{ count: gc }, { count: ac }, { data: thumbs }] = await Promise.all([
        supabase.from("guests").select("id", { count: "exact", head: true }).eq("event_id", ev.id),
        supabase.from("assets").select("id", { count: "exact", head: true }).eq("event_id", ev.id).eq("status", "ready").is("parent_asset_id", null),
        supabase.from("assets").select("storage_path").eq("event_id", ev.id).eq("status", "ready").eq("variant", "thumb").order("created_at", { ascending: false }).limit(4),
      ]);
      c[ev.id] = { guests: gc || 0, photos: ac || 0 };
      const paths = (thumbs || []).map((t) => t.storage_path);
      const urls = await Promise.all(paths.map(async (p) => (await supabase.storage.from("media").createSignedUrl(p, 3600)).data?.signedUrl));
      cov[ev.id] = urls.filter(Boolean) as string[];
    }));
    setCounts(c);
    setCovers(cov);
  }
  useEffect(() => { load(); }, []);

  async function signOut() { await supabase.auth.signOut(); }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) =>
      (filter === "all" || e.status === filter) &&
      (!q || e.name.toLowerCase().includes(q) || e.slug.toLowerCase().includes(q)),
    );
  }, [events, filter, search]);

  const stats = useMemo(() => {
    const photos = Object.values(counts).reduce((n, c) => n + c.photos, 0);
    const guests = Object.values(counts).reduce((n, c) => n + c.guests, 0);
    return {
      events: events.length,
      live: events.filter((e) => e.status === "live").length,
      guests,
      photos,
    };
  }, [events, counts]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-[color:var(--primary)]/15 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl border border-[color:var(--primary)]/30 bg-[color:var(--primary)]/5 text-lg font-black text-primary">L</div>
            <div>
              <div className="code-display text-sm font-black tracking-[0.32em] text-foreground">LAQTA</div>
              <div className="text-[10px] uppercase tracking-[0.4em] text-primary/70">studio console</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/admin" className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">Classic view</Link>
            <button onClick={signOut} className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">{pick(T.signOut, "en")}</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-7">
        {/* Hero stat bar */}
        <section className="mb-7 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-card to-background">
          <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
            <Stat label="Events" value={stats.events} />
            <Stat label="Live now" value={stats.live} accent />
            <Stat label="Guests" value={stats.guests} />
            <Stat label="Photos" value={stats.photos} />
          </div>
        </section>

        {/* Toolbar */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-4 grid place-items-center text-muted-foreground">⌕</span>
            <input
              placeholder="Search events…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-full border border-border bg-card px-10 py-3 text-sm outline-none transition focus:border-primary"
            />
          </div>
          <div className="flex shrink-0 gap-1 rounded-full border border-border bg-card p-1">
            {(["all", "live", "dryrun", "draft", "archived"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition ${filter === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >{s}</button>
            ))}
          </div>
          <button onClick={() => setCreating(true)} className="shrink-0 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-lg shadow-[color:var(--primary)]/20 transition hover:opacity-90">
            + New event
          </button>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-3xl border border-border bg-card">
                <div className="aspect-[4/3] animate-pulse bg-muted" />
                <div className="space-y-3 p-5">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-card/40 p-16 text-center">
            <div className="text-5xl opacity-30">✦</div>
            <h3 className="mt-4 text-lg font-bold">No events {filter !== "all" ? `in ${filter}` : "yet"}</h3>
            <p className="mt-1 text-sm text-muted-foreground">Create one to start collecting photos.</p>
            <button onClick={() => setCreating(true)} className="mt-5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground">+ New event</button>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((ev) => (
              <StudioCard key={ev.id} ev={ev} count={counts[ev.id]} covers={covers[ev.id] || []} onChange={load} />
            ))}
          </div>
        )}
      </div>

      {creating && <EventEditor onClose={() => { setCreating(false); load(); }} />}
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="px-6 py-5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
      <div className={`mt-1.5 text-3xl font-black tabular-nums ${accent ? "text-primary" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Event card                                                          */
/* ------------------------------------------------------------------ */
function StudioCard({ ev, count, covers, onChange }: { ev: EventRow; count?: { guests: number; photos: number }; covers: string[]; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [showRegs, setShowRegs] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const galleryUrl = `${origin}/e/${ev.slug}/gallery`;
  const formUrl = `${origin}/e/${ev.slug}`;
  const isPublic = ev.config.gallery?.mode === "public";
  const qrTarget = ev.config.registration === "none" || isPublic ? galleryUrl : formUrl;

  async function quickStatus(next: EventRow["status"]) { await supabase.from("events").update({ status: next }).eq("id", ev.id); onChange(); }
  async function del() { await supabase.from("events").delete().eq("id", ev.id); setConfirmDel(false); onChange(); }

  const statusTone =
    ev.status === "live" ? "border-[color:var(--success)]/40 bg-[color:var(--success)]/15 text-[color:var(--success)]"
    : ev.status === "dryrun" ? "border-[color:var(--warning)]/40 bg-[color:var(--warning)]/15 text-[color:var(--warning)]"
    : "border-border bg-muted text-muted-foreground";

  return (
    <div className="group overflow-hidden rounded-3xl border border-border bg-card transition duration-300 hover:-translate-y-0.5 hover:border-[color:var(--primary)]/40 hover:shadow-2xl hover:shadow-black/40">
      {/* Cover */}
      <button onClick={() => setShowPhotos(true)} className="relative block w-full overflow-hidden text-left">
        <div className="grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-0.5 bg-background">
          {covers.length > 0 ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="overflow-hidden bg-muted">
                {covers[i] ? (
                  <img src={covers[i]} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                ) : (
                  <div className="h-full w-full bg-gradient-to-br from-muted to-background" />
                )}
              </div>
            ))
          ) : (
            <div className="col-span-2 row-span-2 grid place-items-center bg-[radial-gradient(circle_at_50%_40%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent_70%)]">
              <div className="text-center">
                <div className="text-4xl opacity-40">📷</div>
                <div className="mt-2 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">no photos yet</div>
              </div>
            </div>
          )}
        </div>
        {/* gradient + title overlay */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent p-4">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusTone}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />{ev.status}
            </span>
            {isPublic && <span className="rounded-full border border-[color:var(--primary)]/40 bg-[color:var(--primary)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">public wall</span>}
          </div>
          <h2 className="mt-2 truncate text-xl font-bold text-white drop-shadow">{ev.name}</h2>
        </div>
      </button>

      {/* Meta + actions */}
      <div className="p-4">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span><b className="text-foreground tabular-nums">{count?.photos ?? "·"}</b> photos</span>
          <span><b className="text-foreground tabular-nums">{count?.guests ?? "·"}</b> guests</span>
          <span className="ms-auto truncate" dir="ltr">/{ev.slug}</span>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button onClick={() => setShowPhotos(true)} className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition hover:opacity-90">
            📷 Open photos
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border text-lg text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground">⋯</DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="truncate">{ev.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowQr(true)}>QR code & print sheets</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowRegs(true)}>Registrations</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditing(true)}>Edit event</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { navigator.clipboard?.writeText(qrTarget); }}>Copy share link</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</DropdownMenuLabel>
              {(["draft", "dryrun", "live"] as const).map((s) => (
                <DropdownMenuItem key={s} disabled={ev.status === s} onClick={() => quickStatus(s)} className="capitalize">
                  {ev.status === s ? "● " : "○ "}{s}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setConfirmDel(true)} className="text-destructive focus:text-destructive">Delete event</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {editing && <EventEditor event={ev} onClose={() => { setEditing(false); onChange(); }} />}
      {showRegs && <RegistrationsModal event={ev} onClose={() => setShowRegs(false)} />}
      {showQr && <QrModal url={qrTarget} title={ev.name} onClose={() => setShowQr(false)} />}
      {showPhotos && <PhotosModal event={ev} onClose={() => { setShowPhotos(false); onChange(); }} />}
      {confirmDel && (
        <ConfirmModal
          title="Delete event?"
          body={`"${ev.name}" and all its guests, registrations and assets will be removed. This cannot be undone.`}
          confirmLabel="Delete"
          onCancel={() => setConfirmDel(false)}
          onConfirm={del}
        />
      )}
    </div>
  );
}

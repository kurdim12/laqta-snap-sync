import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_CONFIG, type EventConfig, type EventRow, type GuestRow } from "@/lib/types";
import { T, pick } from "@/lib/i18n";
import { SelfieAvatar } from "@/components/SelfieAvatar";
import { qrUrl } from "@/lib/qr";
import { QrSheet } from "@/components/QrSheet";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import type { AssetRow } from "@/lib/types";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "LAQTA · Admin" }] }),
  component: Admin,
});

function Admin() {
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
  return <AdminDashboard />;
}

function NotAuthorized() {
  async function signOut() { await supabase.auth.signOut(); }
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <div className="max-w-sm">
        <div className="code-display text-3xl font-black text-primary">LAQTA</div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">admin console</div>
        <div className="mx-auto mt-8 grid h-16 w-16 place-items-center rounded-2xl border border-destructive/40 bg-destructive/10 text-3xl text-destructive">⛔</div>
        <h1 className="mt-5 text-xl font-bold">Not authorized</h1>
        <p className="mt-2 text-sm text-muted-foreground">This account doesn't have admin access. Ask an existing admin to grant your role, or sign out and try a different account.</p>
        <button onClick={signOut} className="mt-6 rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">Sign out</button>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

function AuthForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adminExists, setAdminExists] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.rpc("admin_exists");
      if (!alive) return;
      const exists = Boolean(data);
      setAdminExists(exists);
      if (exists) setMode("signin");
    })();
    return () => { alive = false; };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      if (mode === "signup") {
        if (adminExists) throw new Error("Sign-up is closed for this workspace");
        const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/admin" } });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,color-mix(in_oklab,var(--primary)_20%,transparent),transparent_60%)]" />
      <form onSubmit={submit} className="relative w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card/80 p-7 backdrop-blur">
        <div className="text-center">
          <div className="code-display text-2xl font-black tracking-[0.2em] text-primary">LAQTA</div>
          <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">admin console</p>
          <p className="mt-3 text-xs text-muted-foreground">{mode === "signup" ? "First user becomes admin" : "Sign in to continue"}</p>
        </div>
        <input dir="ltr" type="email" placeholder={pick(T.email, "en")} value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl border border-border bg-input px-4 py-3 text-foreground outline-none focus:border-primary" required />
        <input dir="ltr" type="password" placeholder={pick(T.password, "en")} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-border bg-input px-4 py-3 text-foreground outline-none focus:border-primary" required minLength={6} />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-primary px-6 py-3 font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-60">
          {mode === "signup" ? pick(T.signUp, "en") : pick(T.signIn, "en")}
        </button>
        {adminExists === false && (
          <button type="button" onClick={() => setMode(mode === "signup" ? "signin" : "signup")} className="w-full text-center text-xs text-muted-foreground underline">
            {mode === "signup" ? "Have an account? Sign in" : "Need an account? Sign up"}
          </button>
        )}
      </form>
    </main>
  );
}


/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

function AdminDashboard() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [counts, setCounts] = useState<Record<string, { guests: number; assets: number }>>({});
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<"all" | EventRow["status"]>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data } = await supabase.from("events").select("*").order("created_at", { ascending: false });
    const rows = (data || []).map((d) => ({ ...d, status: d.status as EventRow["status"], config: { ...DEFAULT_CONFIG, ...(d.config as Partial<EventConfig>) } })) as EventRow[];
    setEvents(rows);
    setLoading(false);
    const c: typeof counts = {};
    await Promise.all(rows.map(async (ev) => {
      const [{ count: gc }, { count: ac }] = await Promise.all([
        supabase.from("guests").select("id", { count: "exact", head: true }).eq("event_id", ev.id),
        supabase.from("assets").select("id", { count: "exact", head: true }).eq("event_id", ev.id).eq("status", "ready"),
      ]);
      c[ev.id] = { guests: gc || 0, assets: ac || 0 };
    }));
    setCounts(c);
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
    const totalGuests = Object.values(counts).reduce((n, c) => n + c.guests, 0);
    const totalAssets = Object.values(counts).reduce((n, c) => n + c.assets, 0);
    return {
      events: events.length,
      live: events.filter((e) => e.status === "live").length,
      dryrun: events.filter((e) => e.status === "dryrun").length,
      guests: totalGuests,
      assets: totalAssets,
    };
  }, [events, counts]);

  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-[color:var(--warning)] font-black text-primary-foreground">L</div>
            <div>
              <div className="code-display text-sm font-black tracking-[0.18em] text-foreground">LAQTA</div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">admin console</div>
            </div>
          </div>
          <button onClick={signOut} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">{pick(T.signOut, "en")}</button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* KPI strip */}
        <div className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi label="Events" value={stats.events} />
          <Kpi label="Live" value={stats.live} tone="success" />
          <Kpi label="Dry run" value={stats.dryrun} tone="warning" />
          <Kpi label="Guests" value={stats.guests} />
          <Kpi label="Photos ready" value={stats.assets} />
        </div>

        {/* Toolbar */}
        <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
          <input
            placeholder="Search by name or slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full min-w-0 rounded-xl border border-border bg-input px-4 py-2.5 text-sm outline-none focus:border-primary"
          />
          <div className="flex shrink-0 gap-1 rounded-xl border border-border bg-card p-1">
            {(["all", "live", "dryrun", "draft", "archived"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${filter === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {s}
              </button>
            ))}
          </div>
          <button onClick={() => setCreating(true)} className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition hover:opacity-90">
            + New event
          </button>
        </div>

        {/* Events */}
        <div className="grid gap-3">
          {loading && <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
              <div className="text-4xl">📷</div>
              <h3 className="mt-3 text-lg font-bold">No events {filter !== "all" ? `in ${filter}` : "yet"}</h3>
              <p className="mt-1 text-sm text-muted-foreground">Create one to share a guest form, gallery and staff console.</p>
              <button onClick={() => setCreating(true)} className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">+ New event</button>
            </div>
          )}
          {!loading && filtered.map((ev) => (
            <EventRowView key={ev.id} ev={ev} count={counts[ev.id]} onChange={load} />
          ))}
        </div>
      </div>
      {creating && <EventEditor onClose={() => { setCreating(false); load(); }} />}
    </main>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "success" | "warning" }) {
  const dot = tone === "success" ? "bg-[color:var(--success)]" : tone === "warning" ? "bg-[color:var(--warning)]" : "bg-primary";
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </div>
      <div className="mt-1 text-2xl font-black tabular-nums">{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Event card                                                          */
/* ------------------------------------------------------------------ */

function EventRowView({ ev, count, onChange }: { ev: EventRow; count?: { guests: number; assets: number }; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [showRegs, setShowRegs] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const formUrl = `${origin}/e/${ev.slug}`;
  const staffUrl = `${origin}/staff/${ev.slug}`;
  const galleryUrl = `${origin}/e/${ev.slug}/gallery`;

  async function quickStatus(next: EventRow["status"]) {
    await supabase.from("events").update({ status: next }).eq("id", ev.id);
    onChange();
  }
  async function del() {
    await supabase.from("events").delete().eq("id", ev.id);
    setConfirmDel(false); onChange();
  }

  const statusTone =
    ev.status === "live" ? "bg-[color:var(--success)]/20 text-[color:var(--success)] border-[color:var(--success)]/40"
    : ev.status === "dryrun" ? "bg-[color:var(--warning)]/20 text-[color:var(--warning)] border-[color:var(--warning)]/40"
    : ev.status === "archived" ? "bg-muted text-muted-foreground border-border"
    : "bg-muted text-muted-foreground border-border";

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card transition hover:border-primary/40">
      <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-bold">{ev.name}</h2>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusTone}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {ev.status}
            </span>
            {ev.config.gallery?.mode === "public" && (
              <span className="rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">public wall</span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground" dir="ltr">/{ev.slug} · PIN <span className="code-display text-foreground">{ev.staff_pin || "not set"}</span></div>

          {/* Inline KPIs */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="Guests" value={count?.guests ?? "·"} />
            <MiniStat label="Photos" value={count?.assets ?? "·"} />
            <MiniStat label="Selfie" value={ev.config.selfie || "optional"} small />
            <MiniStat label="Locale" value={ev.config.locale} small />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          <button onClick={() => setShowPhotos(true)} className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20">📷 Photos{count?.assets ? ` · ${count.assets}` : ""}</button>
          <button onClick={() => setShowRegs(true)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted">Registrations</button>
          <button onClick={() => setShowQr(true)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted">QR</button>
          <button onClick={() => setEditing(true)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted">Edit</button>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
            {(["draft", "dryrun", "live"] as const).map((s) => (
              <button
                key={s}
                onClick={() => quickStatus(s)}
                className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition ${ev.status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >{s}</button>
            ))}
          </div>
          <button onClick={() => setConfirmDel(true)} className="rounded-lg border border-border px-2 py-1.5 text-xs text-destructive transition hover:bg-destructive/10" title="Delete event">✕</button>
        </div>
      </div>

      {/* Quick-share rail */}
      <div className="grid gap-px border-t border-border bg-border sm:grid-cols-3">
        <CopyLink label="Guest form" url={formUrl} />
        <CopyLink label="Staff console" url={staffUrl} />
        <CopyLink label={ev.config.gallery?.mode === "public" ? "Public wall" : "Gallery (private)"} url={galleryUrl} disabled={ev.config.gallery?.mode !== "public"} />
      </div>

      {editing && <EventEditor event={ev} onClose={() => { setEditing(false); onChange(); }} />}
      {showRegs && <RegistrationsModal event={ev} onClose={() => setShowRegs(false)} />}
      {showQr && <QrModal url={formUrl} title={ev.name} onClose={() => setShowQr(false)} />}
      {showPhotos && <PhotosModal event={ev} onClose={() => setShowPhotos(false)} />}
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

function MiniStat({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={small ? "mt-0.5 truncate text-sm font-semibold capitalize" : "mt-0.5 text-xl font-black tabular-nums"}>{value}</div>
    </div>
  );
}

function CopyLink({ label, url, disabled }: { label: string; url: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (disabled) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* noop */ }
  }
  return (
    <div className={`flex items-center gap-2 bg-card px-3 py-2 ${disabled ? "opacity-50" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="truncate text-xs text-foreground/80" dir="ltr">{url}</div>
      </div>
      <button onClick={copy} disabled={disabled} className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition hover:bg-muted disabled:cursor-not-allowed">
        {copied ? "✓" : "copy"}
      </button>
      {!disabled && (
        <a href={url} target="_blank" rel="noreferrer" className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition hover:bg-muted">↗</a>
      )}
    </div>
  );
}

function QrModal({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const [sheet, setSheet] = useState<number | null>(null);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div className="grid w-full max-w-sm gap-3 rounded-2xl border border-border bg-card p-5 text-center" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{title}</h3>
        <div className="mx-auto rounded-xl bg-white p-3">
          <img src={qrUrl(url, 280)} alt="QR code" className="block h-[260px] w-[260px]" />
        </div>
        <div className="break-all rounded-lg border border-border bg-background px-3 py-2 text-xs" dir="ltr">{url}</div>
        <div className="grid grid-cols-3 gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <button onClick={() => setSheet(12)} className="rounded-lg border border-border py-2 hover:bg-muted">12 / page</button>
          <button onClick={() => setSheet(24)} className="rounded-lg border border-border py-2 hover:bg-muted">24 cards</button>
          <button onClick={() => setSheet(48)} className="rounded-lg border border-border py-2 hover:bg-muted">48 cards</button>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={() => navigator.clipboard.writeText(url)} className="rounded-lg border border-border px-3 py-1.5 text-sm">Copy link</button>
          <button onClick={onClose} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-bold text-primary-foreground">Close</button>
        </div>
      </div>
      {sheet !== null && <QrSheet eventName={title} url={url} count={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}

function ConfirmModal({ title, body, confirmLabel, onCancel, onConfirm }: { title: string; body: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function go() { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-border px-3 py-1.5 text-sm">Cancel</button>
          <button onClick={go} disabled={busy} className="rounded-lg bg-destructive px-4 py-1.5 text-sm font-bold text-destructive-foreground disabled:opacity-60">{busy ? "…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Registrations                                                       */
/* ------------------------------------------------------------------ */

function RegistrationsModal({ event, onClose }: { event: EventRow; onClose: () => void }) {
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [query, setQuery] = useState("");
  const [liveOn, setLiveOn] = useState(false);
  const [active, setActive] = useState<GuestRow | null>(null);
  const [confirmDel, setConfirmDel] = useState<GuestRow | null>(null);

  async function load() {
    const { data } = await supabase
      .from("guests").select("*").eq("event_id", event.id)
      .order("created_at", { ascending: false }).limit(1000);
    setGuests((data || []) as GuestRow[]);
  }
  useEffect(() => {
    load();
    const ch = supabase
      .channel(`admin-regs-${event.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "guests", filter: `event_id=eq.${event.id}` },
        () => load())
      .subscribe((s) => setLiveOn(s === "SUBSCRIBED"));
    const i = setInterval(load, 8000);
    return () => { supabase.removeChannel(ch); clearInterval(i); };
  }, [event.id]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? guests.filter((g) =>
        (g.form_data.name || "").toLowerCase().includes(q) ||
        (g.form_data.phone || "").toLowerCase().includes(q) ||
        g.code.toLowerCase().includes(q))
    : guests;

  function exportCsv() {
    const cols = new Set<string>(["code", "created_at"]);
    guests.forEach((g) => Object.keys(g.form_data).forEach((k) => cols.add(k)));
    const headers = Array.from(cols);
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = guests.map((g) => headers.map((h) => esc(h === "code" ? g.code : h === "created_at" ? g.created_at : (g.form_data as Record<string, string>)[h])).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${event.slug}-guests.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  async function deleteGuest(g: GuestRow) {
    await supabase.from("guests").delete().eq("id", g.id);
    setConfirmDel(null);
    if (active?.id === g.id) setActive(null);
    load();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div className="grid w-full max-w-5xl gap-3 rounded-2xl border border-border bg-card p-5 max-h-[92vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold">Registrations — {event.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
              <span className={`inline-flex items-center gap-1 ${liveOn ? "text-[color:var(--success)]" : "text-muted-foreground"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${liveOn ? "bg-[color:var(--success)] animate-pulse" : "bg-muted-foreground"}`} />
                {liveOn ? "live" : "polling"}
              </span>
              <span className="text-muted-foreground">{filtered.length} of {guests.length}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={exportCsv} className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition hover:bg-muted">Export CSV</button>
            <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm">Close</button>
          </div>
        </div>
        <input
          placeholder="Search name, phone, or code…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-xl border border-border bg-input px-4 py-2 text-foreground outline-none focus:border-primary"
        />
        <div className="grid gap-3 overflow-hidden md:grid-cols-[2fr_1fr]">
          <ul className="space-y-2 overflow-auto pr-1" style={{ maxHeight: "70vh" }}>
            {filtered.map((g) => (
              <li key={g.id}>
                <button
                  onClick={() => setActive(g)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-start transition ${active?.id === g.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                >
                  <SelfieAvatar path={g.selfie_path} name={g.form_data.name || ""} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{g.form_data.name || "—"}</span>
                    <span className="block text-xs text-muted-foreground" dir="ltr">
                      <span className="code-display">{g.code}</span>
                      {g.form_data.phone && <span className="ms-2">{g.form_data.phone}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{timeAgo(g.created_at)}</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="py-10 text-center text-sm text-muted-foreground">No registrations yet.</li>}
          </ul>
          <aside className="overflow-auto rounded-xl border border-border bg-background p-3" style={{ maxHeight: "70vh" }}>
            {active ? (
              <GuestDetail guest={active} onDelete={() => setConfirmDel(active)} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Select a guest to view details.</p>
            )}
          </aside>
        </div>
      </div>
      {confirmDel && (
        <ConfirmModal
          title="Delete registration?"
          body={`Remove ${confirmDel.form_data.name || confirmDel.code}? Their assets remain but become orphaned.`}
          confirmLabel="Delete"
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => deleteGuest(confirmDel)}
        />
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function GuestDetail({ guest, onDelete }: { guest: GuestRow; onDelete: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col items-center">
        <SelfieAvatar path={guest.selfie_path} name={guest.form_data.name || ""} size={120} />
        <div className="mt-3 text-lg font-bold">{guest.form_data.name || "—"}</div>
        <div className="code-display text-sm text-primary" dir="ltr">{guest.code}</div>
        <div className="mt-1 flex gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${guest.consent ? "bg-[color:var(--success)]/20 text-[color:var(--success)]" : "bg-destructive/20 text-destructive"}`}>{guest.consent ? "consented" : "no consent"}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{guest.source}</span>
        </div>
      </div>
      <dl className="grid gap-1 text-sm">
        {Object.entries(guest.form_data).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-border/50 py-1">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
            <dd className="truncate text-end">{String(v)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-2 py-1 text-xs text-muted-foreground">
          <dt>created</dt>
          <dd dir="ltr">{new Date(guest.created_at).toLocaleString()}</dd>
        </div>
      </dl>
      <button onClick={onDelete} className="w-full rounded-lg border border-destructive/30 px-3 py-2 text-xs font-bold uppercase tracking-wider text-destructive transition hover:bg-destructive/10">Delete registration</button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Event editor                                                        */
/* ------------------------------------------------------------------ */

function genPin() { return Math.floor(100000 + Math.random() * 900000).toString(); }
function slugify(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40); }

type Tab = "basics" | "branding" | "form" | "messages" | "advanced";

function EventEditor({ event, onClose }: { event?: EventRow; onClose: () => void }) {
  const [name, setName] = useState(event?.name || "");
  const [slug, setSlug] = useState(event?.slug || "");
  const [status, setStatus] = useState<EventRow["status"]>(event?.status || "draft");
  const [pin, setPin] = useState(event?.staff_pin || genPin());
  const [config, setConfig] = useState<EventConfig>(event?.config || DEFAULT_CONFIG);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("basics");

  async function save() {
    setErr(null);
    if (!pin || pin.length !== 6) { setErr("Staff PIN must be 6 digits"); return; }
    setBusy(true);
    const payload = { name, slug: slug || slugify(name), status, config: config as unknown as never, staff_pin: pin };
    const q = event
      ? supabase.from("events").update(payload as never).eq("id", event.id)
      : supabase.from("events").insert(payload as never);
    const { error } = await q;
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onClose();
  }

  async function clone() {
    if (!event) return;
    setBusy(true);
    await supabase.from("events").insert({
      name: event.name + " (dry run)", slug: event.slug + "-dryrun-" + Math.random().toString(36).slice(2, 5),
      status: "dryrun", config: event.config as unknown as never, staff_pin: genPin(),
    });
    setBusy(false); onClose();
  }

  function updateField(idx: number, patch: Partial<EventConfig["fields"][number]>) {
    const fields = config.fields.slice();
    fields[idx] = { ...fields[idx], ...patch };
    setConfig({ ...config, fields });
  }
  function addField() {
    setConfig({ ...config, fields: [...config.fields, { key: `field_${config.fields.length + 1}`, type: "text", required: false, label: { ar: "", en: "" } }] });
  }
  function removeField(idx: number) {
    setConfig({ ...config, fields: config.fields.filter((_, i) => i !== idx) });
  }
  function moveField(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= config.fields.length) return;
    const fields = config.fields.slice();
    [fields[idx], fields[j]] = [fields[j], fields[idx]];
    setConfig({ ...config, fields });
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "basics", label: "Basics" },
    { id: "branding", label: "Branding" },
    { id: "form", label: "Form" },
    { id: "messages", label: "Messages" },
    { id: "advanced", label: "Advanced" },
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div className="grid w-full max-w-5xl gap-0 overflow-hidden rounded-2xl border border-border bg-card lg:grid-cols-[2fr_1fr] max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col overflow-hidden">
          {/* Sticky header */}
          <div className="flex items-center justify-between border-b border-border bg-card/95 px-5 py-3 backdrop-blur">
            <h2 className="truncate text-lg font-bold">{event ? `Edit · ${event.name}` : "New event"}</h2>
            <button onClick={onClose} className="rounded-lg border border-border px-2 py-1 text-xs">✕</button>
          </div>
          {/* Tabs */}
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-background px-3 py-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >{t.label}</button>
            ))}
          </div>

          <div className="flex-1 space-y-4 overflow-auto p-5">
            {tab === "basics" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className="input" /></Field>
                <Field label="Slug"><input dir="ltr" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder={slugify(name)} className="input" /></Field>
                <Field label="Status">
                  <select value={status} onChange={(e) => setStatus(e.target.value as EventRow["status"])} className="input">
                    {["draft", "dryrun", "live", "archived"].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Staff PIN (6 digits)">
                  <div className="flex gap-2">
                    <input dir="ltr" value={pin} maxLength={6} inputMode="numeric" onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="input flex-1 code-display" />
                    <button type="button" onClick={() => setPin(genPin())} className="rounded-lg border border-border px-3 text-sm" title="Generate new PIN">↻</button>
                  </div>
                </Field>
                <Field label="Locale">
                  <select value={config.locale} onChange={(e) => setConfig({ ...config, locale: e.target.value as EventConfig["locale"] })} className="input">
                    <option value="both">Both (toggle)</option><option value="ar">Arabic only</option><option value="en">English only</option>
                  </select>
                </Field>
                <Field label="Selfie at registration">
                  <select value={config.selfie || "optional"} onChange={(e) => setConfig({ ...config, selfie: e.target.value as EventConfig["selfie"] })} className="input">
                    <option value="optional">Optional</option>
                    <option value="required">Required</option>
                    <option value="off">Off</option>
                  </select>
                </Field>
                <Field label="Gallery mode">
                  <select value={config.gallery?.mode || "private"} onChange={(e) => setConfig({ ...config, gallery: { ...config.gallery, mode: e.target.value as "private" | "public" } })} className="input">
                    <option value="private">Private (per-code)</option>
                    <option value="public">Public wall</option>
                  </select>
                </Field>
                {config.gallery?.mode === "public" && (
                  <div className="sm:col-span-2 rounded-lg border border-[color:var(--warning)]/50 bg-[color:var(--warning)]/10 px-3 py-2 text-xs text-[color:var(--warning)]">
                    <span className="font-arabic">كل صور الفعالية رح تكون مرئية للجميع — للفعاليات العامة فقط</span>
                    <br />All event photos become visible to everyone — for open public events only.
                  </div>
                )}
              </div>
            )}

            {tab === "branding" && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Primary"><input type="color" value={config.theme.primary} onChange={(e) => setConfig({ ...config, theme: { ...config.theme, primary: e.target.value } })} className="h-10 w-full rounded" /></Field>
                  <Field label="Background"><input type="color" value={config.theme.background} onChange={(e) => setConfig({ ...config, theme: { ...config.theme, background: e.target.value } })} className="h-10 w-full rounded" /></Field>
                  <Field label="Text"><input type="color" value={config.theme.text} onChange={(e) => setConfig({ ...config, theme: { ...config.theme, text: e.target.value } })} className="h-10 w-full rounded" /></Field>
                </div>
                <Field label="Logo URL"><input dir="ltr" value={config.theme.logoUrl} onChange={(e) => setConfig({ ...config, theme: { ...config.theme, logoUrl: e.target.value } })} placeholder="https://…" className="input" /></Field>
              </div>
            )}

            {tab === "form" && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Form fields</h3>
                  <button type="button" onClick={addField} className="rounded-lg bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">+ Add field</button>
                </div>
                <div className="space-y-2">
                  {config.fields.map((f, i) => (
                    <div key={i} className="rounded-lg border border-border bg-background p-2">
                      <div className="grid items-end gap-2 md:grid-cols-[100px_100px_1fr_1fr_70px_auto_auto_auto]">
                        <input value={f.key} onChange={(e) => updateField(i, { key: e.target.value })} placeholder="key" className="input" />
                        <select value={f.type} onChange={(e) => updateField(i, { type: e.target.value as EventField["type"] })} className="input">
                          {["text", "tel", "email", "number"].map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <input value={f.label.ar} onChange={(e) => updateField(i, { label: { ...f.label, ar: e.target.value } })} placeholder="عربي" className="input font-arabic" dir="rtl" />
                        <input value={f.label.en} onChange={(e) => updateField(i, { label: { ...f.label, en: e.target.value } })} placeholder="English" className="input" dir="ltr" />
                        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={f.required} onChange={(e) => updateField(i, { required: e.target.checked })} /> req</label>
                        <button type="button" onClick={() => moveField(i, -1)} className="rounded border border-border px-2 text-xs">↑</button>
                        <button type="button" onClick={() => moveField(i, 1)} className="rounded border border-border px-2 text-xs">↓</button>
                        <button type="button" onClick={() => removeField(i)} className="text-destructive">✕</button>
                      </div>
                    </div>
                  ))}
                  {config.fields.length === 0 && <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No fields. Add one to start.</p>}
                </div>
              </div>
            )}

            {tab === "messages" && (
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Consent (AR)"><input value={config.consentText.ar} dir="rtl" onChange={(e) => setConfig({ ...config, consentText: { ...config.consentText, ar: e.target.value } })} className="input font-arabic" /></Field>
                <Field label="Consent (EN)"><input value={config.consentText.en} dir="ltr" onChange={(e) => setConfig({ ...config, consentText: { ...config.consentText, en: e.target.value } })} className="input" /></Field>
                <Field label="Success (AR)"><input value={config.successMessage.ar} dir="rtl" onChange={(e) => setConfig({ ...config, successMessage: { ...config.successMessage, ar: e.target.value } })} className="input font-arabic" /></Field>
                <Field label="Success (EN)"><input value={config.successMessage.en} dir="ltr" onChange={(e) => setConfig({ ...config, successMessage: { ...config.successMessage, en: e.target.value } })} className="input" /></Field>
              </div>
            )}

            {tab === "advanced" && (
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Max photo MB"><input type="number" value={config.limits.maxPhotoMB} onChange={(e) => setConfig({ ...config, limits: { ...config.limits, maxPhotoMB: +e.target.value } })} className="input" /></Field>
                <Field label="Max video MB"><input type="number" value={config.limits.maxVideoMB} onChange={(e) => setConfig({ ...config, limits: { ...config.limits, maxVideoMB: +e.target.value } })} className="input" /></Field>
                <Field label="Allow download all">
                  <select value={String(config.gallery.allowDownloadAll)} onChange={(e) => setConfig({ ...config, gallery: { ...config.gallery, allowDownloadAll: e.target.value === "true" } })} className="input">
                    <option value="true">Yes</option><option value="false">No</option>
                  </select>
                </Field>
                <Field label="Show videos">
                  <select value={String(config.gallery.showVideos)} onChange={(e) => setConfig({ ...config, gallery: { ...config.gallery, showVideos: e.target.value === "true" } })} className="input">
                    <option value="true">Yes</option><option value="false">No</option>
                  </select>
                </Field>
              </div>
            )}
          </div>

          {/* Sticky footer */}
          <div className="flex items-center justify-between gap-2 border-t border-border bg-card/95 px-5 py-3 backdrop-blur">
            {err ? <p className="truncate text-sm text-destructive">{err}</p> : <span className="text-xs text-muted-foreground">Changes save when you click {event ? "Save" : "Create"}</span>}
            <div className="flex gap-2">
              {event && <button onClick={clone} disabled={busy} className="rounded-xl border border-border px-4 py-2 text-sm">Clone as dry run</button>}
              <button onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm">Cancel</button>
              <button onClick={save} disabled={busy || !name} className="rounded-xl bg-primary px-5 py-2 text-sm font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-60">{busy ? "…" : event ? "Save" : "Create"}</button>
            </div>
          </div>
        </div>

        <PhonePreview config={config} name={name || "Event"} />
      </div>
      <style>{`.input{width:100%;border-radius:8px;border:1px solid var(--border);background:var(--input);padding:0.5rem 0.75rem;color:var(--foreground);outline:none}.input:focus{border-color:var(--primary)}`}</style>
    </div>
  );
}

type EventField = EventConfig["fields"][number];
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>{children}</label>;
}

function PhonePreview({ config, name }: { config: EventConfig; name: string }) {
  return (
    <div className="hidden border-l border-border bg-background p-5 lg:block">
      <div className="sticky top-5">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Live preview</div>
        <div className="mx-auto w-[260px] overflow-hidden rounded-[2rem] border-4 border-border bg-black p-3 shadow-2xl">
          <div className="rounded-[1.5rem] p-4" style={{ background: config.theme.background, color: config.theme.text }}>
            {config.theme.logoUrl ? <img src={config.theme.logoUrl} alt="" className="mx-auto h-10 object-contain" /> : <div className="text-center text-lg font-bold" style={{ color: config.theme.primary }}>{name}</div>}
            <div className="mt-4 space-y-2">
              {config.fields.map((f) => (
                <div key={f.key}>
                  <div className="text-xs opacity-70">{f.label.ar || f.label.en}{f.required ? " *" : ""}</div>
                  <div className="mt-0.5 h-7 rounded border border-white/20 bg-white/5"></div>
                </div>
              ))}
              {config.selfie !== "off" && (
                <div className="mt-2 grid h-16 place-items-center rounded border border-dashed border-white/20 text-[10px] opacity-60">
                  selfie · {config.selfie}
                </div>
              )}
            </div>
            <button className="mt-4 w-full rounded-lg py-2 text-sm font-bold" style={{ background: config.theme.primary, color: config.theme.background }}>تسجيل</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */

type EnrichedAsset = AssetRow & { url?: string; thumbUrl?: string; guestName?: string; guestCode?: string };

function PhotosModal({ event, onClose }: { event: EventRow; onClose: () => void }) {
  const [assets, setAssets] = useState<EnrichedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "linked" | "orphan">("all");
  const [query, setQuery] = useState("");
  const [liveOn, setLiveOn] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: rows }, { data: gs }] = await Promise.all([
      supabase.from("assets").select("*").eq("event_id", event.id).order("created_at", { ascending: false }).limit(1000),
      supabase.from("guests").select("id,code,form_data").eq("event_id", event.id).limit(2000),
    ]);
    const guestMap = new Map<string, { code: string; name: string }>();
    (gs || []).forEach((g) => guestMap.set(g.id, { code: g.code, name: (g.form_data as { name?: string })?.name || "" }));

    const all = (rows || []) as AssetRow[];
    const originals = all.filter((r) => r.variant === "original" || (!all.some((x) => x.parent_asset_id === r.id) && r.variant !== "thumb"));
    const webs = all.filter((r) => r.variant === "web");
    const thumbs = all.filter((r) => r.variant === "thumb");
    const display = (originals.length ? originals : webs.length ? webs : all);

    const enriched = await Promise.all(display.map(async (r) => {
      const web = webs.find((w) => w.parent_asset_id === r.id) || r;
      const thumb = thumbs.find((t) => t.parent_asset_id === r.id) || web;
      const [{ data: u1 }, { data: u2 }] = await Promise.all([
        supabase.storage.from("media").createSignedUrl(web.storage_path, 3600),
        supabase.storage.from("media").createSignedUrl(thumb.storage_path, 3600),
      ]);
      const g = r.guest_id ? guestMap.get(r.guest_id) : undefined;
      return { ...r, url: u1?.signedUrl, thumbUrl: u2?.signedUrl, guestName: g?.name, guestCode: g?.code };
    }));
    setAssets(enriched);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`admin-photos-${event.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "assets", filter: `event_id=eq.${event.id}` }, () => load())
      .subscribe((s) => setLiveOn(s === "SUBSCRIBED"));
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id]);

  const q = query.trim().toLowerCase();
  const filtered = assets.filter((a) => {
    if (filter === "linked" && !a.guest_id) return false;
    if (filter === "orphan" && a.guest_id) return false;
    if (q && !(a.guestName || "").toLowerCase().includes(q) && !(a.guestCode || "").toLowerCase().includes(q)) return false;
    return true;
  });

  const items: LightboxItem[] = filtered.map((a) => ({ id: a.id, kind: a.kind === "video" ? "video" : "photo", url: a.url, thumbUrl: a.thumbUrl }));

  async function downloadAll() {
    for (const a of filtered) {
      if (!a.url) continue;
      const link = document.createElement("a");
      link.href = a.url;
      link.download = `${event.slug}-${a.guestCode || a.id.slice(0, 6)}.jpg`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div className="grid w-full max-w-6xl gap-3 rounded-2xl border border-border bg-card p-5 max-h-[92vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold">📷 Photos — {event.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
              <span className={`inline-flex items-center gap-1 ${liveOn ? "text-[color:var(--success)]" : "text-muted-foreground"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${liveOn ? "bg-[color:var(--success)] animate-pulse" : "bg-muted-foreground"}`} />
                {liveOn ? "live" : "idle"}
              </span>
              <span className="text-muted-foreground">{filtered.length} of {assets.length}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={downloadAll} disabled={!filtered.length} className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition hover:bg-muted disabled:opacity-50">Download all</button>
            <button onClick={load} className="rounded-lg border border-border px-3 py-1.5 text-sm">Refresh</button>
            <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm">Close</button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-border bg-background p-0.5">
            {(["all", "linked", "orphan"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{f}</button>
            ))}
          </div>
          <input placeholder="Search guest name or code…" value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 min-w-[180px] rounded-xl border border-border bg-input px-3 py-1.5 text-sm outline-none focus:border-primary" />
        </div>

        <div className="overflow-auto" style={{ maxHeight: "70vh" }}>
          {loading ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {Array.from({ length: 12 }).map((_, i) => <div key={i} className="aspect-square animate-pulse rounded-lg bg-muted" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="grid place-items-center py-20 text-center">
              <div className="text-6xl opacity-30">📷</div>
              <p className="mt-3 text-sm text-muted-foreground">No photos yet. They'll appear here as staff or guests upload.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {filtered.map((a, i) => (
                <button key={a.id} onClick={() => setLightbox(i)} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted transition hover:border-primary">
                  {a.thumbUrl ? (
                    <img src={a.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-2xl opacity-40">{a.kind === "video" ? "🎬" : "📷"}</div>
                  )}
                  {a.kind === "video" && <span className="absolute top-1 right-1 rounded bg-black/70 px-1 text-[9px] font-bold text-white">VIDEO</span>}
                  {a.guestCode && (
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-start text-[10px] font-bold text-white">
                      <span className="code-display block truncate" dir="ltr">{a.guestCode}</span>
                      {a.guestName && <span className="block truncate font-normal opacity-80">{a.guestName}</span>}
                    </span>
                  )}
                  {!a.guest_id && <span className="absolute top-1 left-1 rounded bg-[color:var(--warning)]/90 px-1 text-[9px] font-bold text-black">orphan</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {lightbox !== null && (
        <Lightbox
          items={items}
          index={lightbox}
          onClose={() => setLightbox(null)}
          onIndexChange={setLightbox}
          shareTitle={event.name}
        />
      )}
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_CONFIG, type EventConfig, type EventRow, type GuestRow } from "@/lib/types";
import { T, pick } from "@/lib/i18n";
import { SelfieAvatar } from "@/components/SelfieAvatar";
import { QrCode } from "@/components/QrCode";
import { checkAdminExists } from "@/lib/admin.functions";
import { QrSheet } from "@/components/QrSheet";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import type { AssetRow } from "@/lib/types";
import { resizeImage, logoDataUrl, videoPoster } from "@/lib/media";
import { testTemplate, reprocessAsset, sweepEventProcessing } from "@/lib/template.functions";
import { toast } from "sonner";
import { backdropOf, renderBackdrop } from "@/lib/backdrop";
import { wallOf } from "@/lib/wall";

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

export function NotAuthorized() {
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

export function AuthForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adminExists, setAdminExists] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { exists } = await checkAdminExists().catch(() => ({ exists: false }));
      if (!alive) return;
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
        // Count distinct photos/videos, not their web/thumb variants — each
        // upload makes 3 rows (original + web + thumb); only the original is
        // top-level (parent_asset_id is null).
        supabase.from("assets").select("id", { count: "exact", head: true }).eq("event_id", ev.id).eq("status", "ready").is("parent_asset_id", null),
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
  const [showDiag, setShowDiag] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const formUrl = `${origin}/e/${ev.slug}`;
  const staffUrl = `${origin}/staff/${ev.slug}`;
  const galleryUrl = `${origin}/e/${ev.slug}/gallery`;
  const wallUrl = `${origin}/wall/${ev.slug}`;

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
      <div className="p-4">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto min-w-0 truncate text-lg font-bold">{ev.name}</h2>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusTone}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {ev.status}
          </span>
          {ev.config.gallery?.mode === "public" && (
            <span className="rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">public wall</span>
          )}
        </div>
        <div className="mt-1 text-xs text-muted-foreground" dir="ltr">/{ev.slug} · PIN <span className="code-display text-foreground">{ev.staff_pin || "not set"}</span></div>

        {/* Stats */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniStat label="Guests" value={count?.guests ?? "·"} />
          <MiniStat label="Photos" value={count?.assets ?? "·"} />
          <MiniStat label="Selfie" value={ev.config.selfie || "optional"} small />
          <MiniStat label="Locale" value={ev.config.locale} small />
        </div>

        {ev.template_mode === "ai" && (
          <div className="mt-3 rounded-lg border border-border bg-background p-2.5">
            <GenerationMeter used={ev.generations_used ?? 0} max={ev.max_generations ?? 150} />
          </div>
        )}

        {/* Primary actions */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <button onClick={() => setShowPhotos(true)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition hover:bg-primary/20">📷 Photos{count?.assets ? ` · ${count.assets}` : ""}</button>
          <button onClick={() => setShowRegs(true)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-muted">Registrations</button>
          <button onClick={() => setShowDiag(true)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-muted" title="AI pipeline diagnostics">🩺 Diagnostics</button>
          <button onClick={() => setShowQr(true)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-muted">QR code</button>
          <button onClick={() => setEditing(true)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-muted">Edit</button>
          <a href={wallUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition hover:opacity-90" title="Open venue wall in a new tab">▦ Live wall ↗</a>
        </div>

        {/* Status + delete */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
              {(["draft", "dryrun", "live"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => quickStatus(s)}
                  className={`rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition ${ev.status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >{s}</button>
              ))}
            </div>
          </div>
          <button onClick={() => setConfirmDel(true)} className="inline-flex items-center gap-1 rounded-lg border border-destructive/30 px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10" title="Delete event">✕ Delete</button>
        </div>
      </div>

      {/* Quick-share rail */}
      <div className="grid gap-px border-t border-border bg-border sm:grid-cols-3">
        <CopyLink label="Guest form" url={formUrl} />
        <CopyLink label="Staff console" url={staffUrl} />
        <CopyLink label={ev.config.gallery?.mode === "public" ? "Public wall" : "Gallery (private)"} url={galleryUrl} disabled={ev.config.gallery?.mode !== "public"} />
        <CopyLink label="Live wall display" url={wallUrl} />
      </div>

      {editing && <EventEditor event={ev} onClose={() => { setEditing(false); onChange(); }} />}
      {showRegs && <RegistrationsModal event={ev} onClose={() => setShowRegs(false)} />}
      {showQr && <QrModal url={ev.config.registration === "none" || ev.config.gallery?.mode === "public" ? galleryUrl : formUrl} title={ev.name} onClose={() => setShowQr(false)} />}
      {showPhotos && <PhotosModal event={ev} onClose={() => setShowPhotos(false)} />}
      {showDiag && <DiagnosticsModal event={ev} onClose={() => setShowDiag(false)} />}
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

export function QrModal({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const [sheet, setSheet] = useState<number | null>(null);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div className="grid w-full max-w-sm gap-3 rounded-2xl border border-border bg-card p-5 text-center" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{title}</h3>
        <div className="mx-auto rounded-xl bg-white p-3">
          <QrCode value={url} size={280} alt="QR code" className="block h-[260px] w-[260px]" />
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

export function ConfirmModal({ title, body, confirmLabel, onCancel, onConfirm }: { title: string; body: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void | Promise<void> }) {
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

export function RegistrationsModal({ event, onClose }: { event: EventRow; onClose: () => void }) {
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

type Tab = "basics" | "branding" | "template" | "form" | "messages" | "advanced";

async function fileToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

export function EventEditor({ event, onClose }: { event?: EventRow; onClose: () => void }) {
  const [name, setName] = useState(event?.name || "");
  const [slug, setSlug] = useState(event?.slug || "");
  const [status, setStatus] = useState<EventRow["status"]>(event?.status || "draft");
  const [pin, setPin] = useState(event?.staff_pin || genPin());
  const [config, setConfig] = useState<EventConfig>(event?.config || DEFAULT_CONFIG);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("basics");
  const [templateMode, setTemplateMode] = useState<"none" | "frame" | "ai" | "backdrop">(event?.template_mode || "none");
  const [templatePrompt, setTemplatePrompt] = useState(event?.template_prompt || "");
  const [referenceUrl, setReferenceUrl] = useState(event?.template_reference_url || "");
  const [frameUrl, setFrameUrl] = useState(event?.template_frame_url || "");
  const [quality, setQuality] = useState<"low" | "medium" | "high">(event?.template_quality || "medium");
  const [aspect, setAspect] = useState(event?.template_aspect_ratio || "1024x1024");
  const [maxGenerations, setMaxGenerations] = useState<number>(event?.max_generations ?? 150);

  async function save() {
    setErr(null);
    if (!pin || pin.length !== 6) { setErr("Staff PIN must be 6 digits"); return; }
    if (templateMode === "ai" && !frameUrl) {
      setTab("template");
      setErr("AI mode needs a frame PNG — it is the fallback branding when a generation fails. / وضع الذكاء الاصطناعي يحتاج إطار PNG");
      return;
    }
    setBusy(true);
    const payload = {
      name, slug: slug || slugify(name), status, config: config as unknown as never, staff_pin: pin,
      template_mode: templateMode,
      template_prompt: templatePrompt || null,
      template_reference_url: referenceUrl || null,
      template_frame_url: frameUrl || null,
      template_quality: quality,
      template_aspect_ratio: aspect,
      max_generations: Math.max(0, Math.min(100000, Number(maxGenerations) || 0)),
    };
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
    { id: "template", label: "Template" },
    { id: "form", label: "Form" },
    { id: "messages", label: "Messages" },
    { id: "advanced", label: "Advanced" },
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-0 sm:p-4" onClick={onClose}>
      <div className="grid h-[100dvh] max-h-[100dvh] w-full max-w-5xl gap-0 overflow-hidden border border-border bg-card sm:h-auto sm:max-h-[92vh] sm:rounded-2xl lg:grid-cols-[2fr_1fr]" onClick={(e) => e.stopPropagation()}>
        <div className="flex min-h-0 flex-col overflow-hidden">

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

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5" style={{ WebkitOverflowScrolling: "touch" }}>
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
                <Field label="Registration">
                  <select value={config.registration || "open"} onChange={(e) => setConfig({ ...config, registration: e.target.value as "open" | "none" })} className="input">
                    <option value="open">Open (guests register on /e/&hellip;)</option>
                    <option value="none">None (QR opens gallery directly)</option>
                  </select>
                </Field>
                <Field label="Require approval before public">
                  <select value={String(Boolean(config.gallery?.requireApproval))} onChange={(e) => setConfig({ ...config, gallery: { ...config.gallery, requireApproval: e.target.value === "true" } })} className="input">
                    <option value="false">No (publish immediately)</option>
                    <option value="true">Yes (admin must approve)</option>
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
                <Field label="Logo">
                  <div className="space-y-2">
                    {config.theme.logoUrl && (
                      <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-2">
                        <img src={config.theme.logoUrl} alt="logo preview" className="h-12 max-w-[160px] object-contain" />
                        <button type="button" onClick={() => setConfig({ ...config, theme: { ...config.theme, logoUrl: "" } })} className="text-xs font-semibold text-destructive underline">Remove</button>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="cursor-pointer rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition hover:opacity-90">
                        {config.theme.logoUrl ? "Replace logo" : "Upload logo"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            e.currentTarget.value = "";
                            if (!f) return;
                            try {
                              const url = await logoDataUrl(f);
                              setConfig({ ...config, theme: { ...config.theme, logoUrl: url } });
                            } catch {
                              alert("Couldn't read that image — try a PNG or JPG.");
                            }
                          }}
                        />
                      </label>
                      <span className="text-[10px] text-muted-foreground">PNG/JPG — resized & embedded automatically</span>
                    </div>
                    <input
                      dir="ltr"
                      value={config.theme.logoUrl.startsWith("data:") ? "" : config.theme.logoUrl}
                      onChange={(e) => setConfig({ ...config, theme: { ...config.theme, logoUrl: e.target.value } })}
                      placeholder="…or paste an image URL"
                      className="input"
                    />
                  </div>
                </Field>
              </div>
            )}

            {tab === "template" && (
              <TemplatePanel
                eventId={event?.id}
                generationsUsed={event?.generations_used ?? 0}
                maxGenerations={maxGenerations} setMaxGenerations={setMaxGenerations}
                mode={templateMode} setMode={setTemplateMode}
                config={config} setConfig={setConfig}
                prompt={templatePrompt} setPrompt={setTemplatePrompt}
                referenceUrl={referenceUrl} setReferenceUrl={setReferenceUrl}
                frameUrl={frameUrl} setFrameUrl={setFrameUrl}
                quality={quality} setQuality={setQuality}
                aspect={aspect} setAspect={setAspect}
              />
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
          <div className="shrink-0 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:px-5" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
            {err ? <p className="mb-2 text-sm text-destructive">{err}</p> : <p className="mb-2 hidden text-xs text-muted-foreground sm:block">Changes save when you click {event ? "Save" : "Create"}</p>}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {event && <button onClick={clone} disabled={busy} className="rounded-xl border border-border px-4 py-2 text-sm">Clone as dry run</button>}
              <button onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm">Cancel</button>
              <button onClick={save} disabled={busy || !name} className="flex-1 rounded-xl bg-primary px-5 py-2 text-sm font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-60 sm:flex-none">{busy ? "…" : event ? "Save" : "Create"}</button>
            </div>
          </div>

        </div>

        <PhonePreview config={config} name={name || "Event"} />
      </div>
      <style>{`.input{width:100%;border-radius:8px;border:1px solid var(--border);background:var(--input);padding:0.5rem 0.75rem;color:var(--foreground);outline:none}.input:focus{border-color:var(--primary)}`}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Generation cap meter                                                */
/* ------------------------------------------------------------------ */

export function GenerationMeter({ used, max }: { used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  const color = pct >= 100 ? "var(--destructive)" : pct >= 80 ? "var(--warning)" : "var(--primary)";
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-bold tabular-nums text-muted-foreground">
        <span>AI generations · التوليدات</span>
        <span style={{ color }}>{used} / {max}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Photo template (frame overlay / AI restyle) + test panel            */
/* ------------------------------------------------------------------ */

function TemplatePanel(props: {
  eventId?: string;
  generationsUsed: number;
  maxGenerations: number; setMaxGenerations: (n: number) => void;
  mode: "none" | "frame" | "ai" | "backdrop"; setMode: (m: "none" | "frame" | "ai" | "backdrop") => void;
  config: EventConfig; setConfig: (c: EventConfig) => void;
  prompt: string; setPrompt: (v: string) => void;
  referenceUrl: string; setReferenceUrl: (v: string) => void;
  frameUrl: string; setFrameUrl: (v: string) => void;
  quality: "low" | "medium" | "high"; setQuality: (q: "low" | "medium" | "high") => void;
  aspect: string; setAspect: (v: string) => void;
}) {
  const { eventId, generationsUsed, maxGenerations, setMaxGenerations, mode, setMode, config, setConfig, prompt, setPrompt, referenceUrl, setReferenceUrl, frameUrl, setFrameUrl, quality, setQuality, aspect, setAspect } = props;
  const [sample, setSample] = useState<string | null>(null);
  const [result, setResult] = useState<{ dataUrl?: string; ms?: number; cost?: number; costIsActual?: boolean; model?: string; error?: string; attempts?: unknown[] } | null>(null);
  const [testSpend, setTestSpend] = useState<{ runs: number; total: number } | null>(null);
  // The evidence blob embeds full base64 request/response bodies (MBs) —
  // stringify it once per result, not on every keystroke re-render.
  const evidenceJson = useMemo(
    () => (Array.isArray(result?.attempts) && result.attempts.length > 0 ? JSON.stringify(result.attempts, null, 2) : null),
    [result],
  );

  // Total spend on Template test runs (never counted against the event cap).
  async function loadTestSpend() {
    const q = supabase.from("template_test_runs").select("cost");
    const { data } = eventId ? await q.eq("event_id", eventId) : await q;
    if (data) setTestSpend({ runs: data.length, total: data.reduce((t, r) => t + Number((r as { cost: number | null }).cost || 0), 0) });
  }
  useEffect(() => { loadTestSpend(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [eventId]);
  const [testing, setTesting] = useState(false);

  async function pickImage(file: File, maxSide: number, setter: (v: string) => void) {
    try {
      const blob = await resizeImage(file, maxSide, 0.9);
      setter(await fileToDataUrl(blob));
    } catch {
      alert("Couldn't read that image — try a PNG or JPG.");
    }
  }

  async function runTest() {
    if (!sample || !prompt.trim()) return;
    setTesting(true); setResult(null);
    try {
      const r = await testTemplate({
        data: { prompt, imageDataUrl: sample, referenceDataUrl: referenceUrl || null, quality, aspectRatio: aspect, eventId: eventId ?? null },
      });
      setResult(r.ok
        ? { dataUrl: r.dataUrl, ms: r.ms, cost: r.cost, costIsActual: r.costIsActual, model: r.model, attempts: r.attempts }
        : { error: r.error, attempts: r.attempts });
      loadTestSpend();
    } catch (e) {
      setResult({ error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-5">
      <Field label="Photo template mode">
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-background p-1 sm:grid-cols-4">
          {([["none", "None"], ["frame", "Frame overlay"], ["backdrop", "Backdrop ($0, no AI)"], ["ai", "AI style"]] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setMode(v)}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold transition ${mode === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>
      </Field>

      {(mode === "frame" || mode === "ai") && (
        <Field label={mode === "ai" ? "Frame PNG — REQUIRED fallback branding (used when a generation fails)" : "Frame PNG (transparent, laid over every photo)"}>
          <div className="space-y-2">
            {frameUrl && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-[repeating-conic-gradient(#e5e5e5_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-2">
                <img src={frameUrl} alt="frame preview" className="h-24 object-contain" />
                <button type="button" onClick={() => setFrameUrl("")} className="text-xs font-semibold text-destructive underline">Remove</button>
              </div>
            )}
            <label className="inline-block cursor-pointer rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground">
              {frameUrl ? "Replace frame" : "Upload frame"}
              <input type="file" accept="image/png" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0]; e.currentTarget.value = "";
                if (f) await pickImage(f, 1600, setFrameUrl);
              }} />
            </label>
          </div>
        </Field>
      )}

      {mode === "backdrop" && <BackdropPanel config={config} setConfig={setConfig} />}

      {mode === "ai" && (
        <div className="space-y-4">
          <Field label="Style prompt">
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4}
              placeholder="e.g. Turn this into a cinematic golden-hour editorial portrait with warm film grain, keep the face unchanged."
              className="input resize-y" />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Quality">
              <select value={quality} onChange={(e) => setQuality(e.target.value as "low" | "medium" | "high")} className="input">
                <option value="low">Low (fastest, cheapest)</option>
                <option value="medium">Medium</option>
                <option value="high">High (slowest, priciest)</option>
              </select>
            </Field>
            <Field label="Output size">
              <select value={aspect} onChange={(e) => setAspect(e.target.value)} className="input">
                <option value="1024x1024">Square · 1024×1024</option>
                <option value="1024x1536">Portrait · 1024×1536</option>
                <option value="1536x1024">Landscape · 1536×1024</option>
              </select>
            </Field>
          </div>

          <Field label="Max generations · الحد الأقصى للتوليد">
            <input type="number" min={0} value={maxGenerations}
              onChange={(e) => setMaxGenerations(Number(e.target.value))} className="input" />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Hard cap on AI generations for this event. At roughly $0.08–0.13 per photo, 150 generations is about $12–20.
              <span className="block font-arabic" dir="rtl">حد أقصى صارم لعدد الصور المولّدة لهذه الفعالية.</span>
            </p>
            <div className="mt-2">
              <GenerationMeter used={generationsUsed} max={maxGenerations} />
            </div>
            {testSpend && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Test runs (not counted against the cap): <b className="text-foreground tabular-nums">{testSpend.runs}</b> · total ${testSpend.total.toFixed(4)}
              </p>
            )}
          </Field>

          <Field label="Reference image (e.g. the branded shirt)">
            <div className="space-y-2">
              {referenceUrl && (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-2">
                  <img src={referenceUrl} alt="reference" className="h-20 rounded object-cover" />
                  <button type="button" onClick={() => setReferenceUrl("")} className="text-xs font-semibold text-destructive underline">Remove</button>
                </div>
              )}
              <label className="inline-block cursor-pointer rounded-lg border border-border px-3 py-2 text-xs font-bold">
                {referenceUrl ? "Replace reference" : "Upload reference"}
                <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                  const f = e.target.files?.[0]; e.currentTarget.value = "";
                  if (f) await pickImage(f, 1024, setReferenceUrl);
                }} />
              </label>
              <p className="text-[11px] text-muted-foreground">
                Sent to the model as a second reference. Use a flat, front-on, evenly lit photo with the logo unwrinkled.
                <span className="block font-arabic" dir="rtl">تُرسل للنموذج كمرجع ثانٍ — صورة مسطّحة وأمامية وإضاءة متساوية والشعار غير مجعّد.</span>
              </p>
            </div>
          </Field>

          {/* Test panel */}
          <div className="rounded-xl border border-border bg-background p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="mr-auto text-sm font-bold uppercase tracking-wider text-muted-foreground">Test the style</h3>
              <label className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">
                {sample ? "Change sample" : "Pick sample photo"}
                <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                  const f = e.target.files?.[0]; e.currentTarget.value = "";
                  if (f) { setResult(null); await pickImage(f, 1024, (v) => setSample(v)); }
                }} />
              </label>
              <button type="button" onClick={runTest} disabled={!sample || !prompt.trim() || testing}
                className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50">
                {testing ? "Generating…" : "Run test"}
              </button>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Before</div>
                <div className="grid aspect-square place-items-center overflow-hidden rounded-lg border border-border bg-muted">
                  {sample ? <img src={sample} alt="sample" className="h-full w-full object-cover" /> : <span className="text-xs text-muted-foreground">No sample yet</span>}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">After</div>
                <div className="grid aspect-square place-items-center overflow-hidden rounded-lg border border-border bg-muted">
                  {testing ? <span className="animate-pulse text-xs text-muted-foreground">Applying style…</span>
                    : result?.dataUrl ? <img src={result.dataUrl} alt="styled result" className="h-full w-full object-cover" />
                    : <span className="text-xs text-muted-foreground">Run a test to preview</span>}
                </div>
              </div>
            </div>

            {result?.error && <p className="mt-3 whitespace-pre-wrap break-all rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{result.error}</p>}
            {evidenceJson && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-primary">Provider evidence ({result?.attempts?.length}) — exact request body + raw response</summary>
                <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-background p-2 text-[10px]">{evidenceJson}</pre>
              </details>
            )}
            {result?.dataUrl && (
              <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
                <span><b className="text-foreground tabular-nums">{((result.ms || 0) / 1000).toFixed(1)}s</b> generation time · زمن التوليد</span>
                <span><b className="text-foreground tabular-nums">${(result.cost || 0).toFixed(4)}</b> {result.costIsActual ? "actual cost · التكلفة الفعلية" : "estimated cost (provider reported none)"}</span>
                <span className="truncate">model <b className="text-foreground">{result.model}</b></span>
              </div>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">
              Every staff upload for this event is restyled automatically. Guests see “applying event style…” until the render is ready; if it fails, they still get the original photo.
            </p>
          </div>
        </div>
      )}

      {mode === "none" && <p className="text-sm text-muted-foreground">Photos are delivered exactly as shot.</p>}
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Backdrop treatment ($0 — browser cutout + brand gradient)           */
/* ------------------------------------------------------------------ */

function BackdropPanel({ config, setConfig }: { config: EventConfig; setConfig: (c: EventConfig) => void }) {
  const settings = backdropOf(config);
  const wall = wallOf(config);
  const [sample, setSample] = useState<string | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function patch(p: Partial<typeof settings>) {
    setConfig({ ...config, backdrop: { ...settings, ...p } });
  }
  function patchWall(p: Partial<typeof wall>) {
    setConfig({ ...config, wall: { ...wall, ...p } });
  }

  async function run(file: File) {
    setErr(null); setBusy(true); setOut(null);
    const url = URL.createObjectURL(file);
    setSample(url);
    try {
      const blob = await renderBackdrop(file, settings, "preview-seed");
      setOut(URL.createObjectURL(blob));
    } catch (e) {
      setErr((e as Error).message || "render failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        The subject is cut out in the guest's browser and placed on a brand gradient — no AI, no provider calls,
        <b className="text-foreground"> $0 per photo</b>. Photos land on the wall at <code>/wall/{"{slug}"}</code>.
      </p>

      <Field label="Gradient palette (one tile colour per pair)">
        <div className="space-y-2">
          {settings.palette.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-8 w-16 rounded" style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }} />
              <input type="color" value={p.from} onChange={(e) => {
                const palette = settings.palette.slice(); palette[i] = { ...p, from: e.target.value }; patch({ palette });
              }} className="h-8 w-10 rounded border border-border bg-transparent" />
              <input type="color" value={p.to} onChange={(e) => {
                const palette = settings.palette.slice(); palette[i] = { ...p, to: e.target.value }; patch({ palette });
              }} className="h-8 w-10 rounded border border-border bg-transparent" />
              <button type="button" onClick={() => patch({ palette: settings.palette.filter((_, j) => j !== i) })}
                disabled={settings.palette.length <= 1}
                className="text-xs font-semibold text-destructive underline disabled:opacity-30">Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => patch({ palette: [...settings.palette, { from: "#111827", to: "#4B5563" }] })}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold">+ Add colour</button>
        </div>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tile shape">
          <select value={settings.aspect} onChange={(e) => patch({ aspect: e.target.value as "1:1" | "4:5" })} className="input">
            <option value="4:5">Portrait · 4:5</option>
            <option value="1:1">Square · 1:1</option>
          </select>
        </Field>
        <Field label={`Halftone texture · ${settings.halftoneOpacity}%`}>
          <div className="flex items-center gap-3">
            <input type="checkbox" checked={settings.halftone} onChange={(e) => patch({ halftone: e.target.checked })} className="h-5 w-5" />
            <input type="range" min={0} max={40} value={settings.halftoneOpacity} disabled={!settings.halftone}
              onChange={(e) => patch({ halftoneOpacity: Number(e.target.value) })} className="w-full" />
          </div>
        </Field>
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="cursor-pointer rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground">
            {sample ? "Try another photo" : "Test on a photo"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) run(f);
            }} />
          </label>
          <span className="text-[11px] text-muted-foreground">Renders locally · cost $0.00</span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Before</div>
            <div className="grid aspect-[4/5] place-items-center overflow-hidden rounded-lg border border-border bg-muted">
              {sample ? <img src={sample} alt="sample" className="h-full w-full object-cover" /> : <span className="text-xs text-muted-foreground">No sample yet</span>}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Wall tile</div>
            <div className="grid aspect-[4/5] place-items-center overflow-hidden rounded-lg border border-border bg-muted">
              {busy ? <span className="animate-pulse text-xs text-muted-foreground">Cutting out…</span>
                : out ? <img src={out} alt="backdrop result" className="h-full w-full object-cover" />
                : <span className="text-xs text-muted-foreground">Run a test to preview</span>}
            </div>
          </div>
        </div>
        {err && <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{err}</p>}
      </div>

      <Field label="Wall display">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">Columns
            <input type="number" min={1} max={6} value={wall.columns} onChange={(e) => patchWall({ columns: Math.max(1, Math.min(6, Number(e.target.value) || 3)) })} className="input" />
          </label>
          <label className="text-xs text-muted-foreground">Refresh every (sec)
            <input type="number" min={3} max={120} value={wall.intervalSec} onChange={(e) => patchWall({ intervalSec: Math.max(3, Math.min(120, Number(e.target.value) || 8)) })} className="input" />
          </label>
        </div>
        <div className="mt-3 space-y-2">
          {wall.tiles.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={t.text} onChange={(e) => {
                const tiles = wall.tiles.slice(); tiles[i] = { ...t, text: e.target.value }; patchWall({ tiles });
              }} className="input flex-1" placeholder="CHANGING MOBILITY FOREVER" />
              <input type="color" value={t.background} onChange={(e) => {
                const tiles = wall.tiles.slice(); tiles[i] = { ...t, background: e.target.value }; patchWall({ tiles });
              }} className="h-8 w-10 rounded border border-border bg-transparent" />
              <input type="color" value={t.color} onChange={(e) => {
                const tiles = wall.tiles.slice(); tiles[i] = { ...t, color: e.target.value }; patchWall({ tiles });
              }} className="h-8 w-10 rounded border border-border bg-transparent" />
              <button type="button" onClick={() => patchWall({ tiles: wall.tiles.filter((_, j) => j !== i) })}
                className="text-xs font-semibold text-destructive underline">Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => patchWall({ tiles: [...wall.tiles, { text: "WHY NOT", background: "#0A0A0A", color: "#FFFFFF" }] })}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold">+ Add brand tile</button>
        </div>
      </Field>
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

export function PhotosModal({ event, onClose }: { event: EventRow; onClose: () => void }) {
  const [assets, setAssets] = useState<EnrichedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "linked" | "orphan">("all");
  const [approval, setApproval] = useState<"all" | "pending" | "approved">("all");
  const [query, setQuery] = useState("");
  const [liveOn, setLiveOn] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<EnrichedAsset | null>(null);
  const [album, setAlbum] = useState<string>("all");
  const [uploadAlbum, setUploadAlbum] = useState<string>("");
  const [createdAlbums, setCreatedAlbums] = useState<string[]>([]);
  const folderRef = useRef<HTMLInputElement>(null);

  // <input webkitdirectory> isn't a typed React prop — set it on the element so
  // the picker lets the admin choose a whole folder (desktop browsers).
  useEffect(() => {
    if (folderRef.current) {
      folderRef.current.setAttribute("webkitdirectory", "");
      folderRef.current.setAttribute("directory", "");
    }
  }, []);

  const albumOf = (a: EnrichedAsset) => ((a.meta as { album?: string })?.album) || "";

  async function load() {
    setLoading(true);
    const [{ data: rows }, { data: gs }] = await Promise.all([
      supabase.from("assets").select("*").eq("event_id", event.id).order("created_at", { ascending: false }).limit(1000),
      supabase.from("guests").select("id,code,form_data").eq("event_id", event.id).limit(2000),
    ]);
    const guestMap = new Map<string, { code: string; name: string }>();
    (gs || []).forEach((g) => guestMap.set(g.id, { code: g.code, name: (g.form_data as { name?: string })?.name || "" }));

    const all = (rows || []) as AssetRow[];
    // One tile per photo: only top-level assets (no parent). The old filter also
    // matched `web` variants (no children, not a thumb), so every photo rendered
    // twice — once as its thumbnail and once as a stray full-res web tile.
    const originals = all.filter((r) => r.parent_asset_id == null && r.variant !== "thumb");
    const webs = all.filter((r) => r.variant === "web");
    const thumbs = all.filter((r) => r.variant === "thumb" || r.variant === "poster");
    const display = (originals.length ? originals : webs.length ? webs : all);

    const enriched = await Promise.all(display.map(async (r) => {
      const isVideo = r.kind === "video";
      const web = webs.find((w) => w.parent_asset_id === r.id) || r;
      const thumbChild = thumbs.find((t) => t.parent_asset_id === r.id);
      const { data: webU } = await supabase.storage.from("media").createSignedUrl(web.storage_path, 3600);
      let thumbSigned = webU;
      if (thumbChild && thumbChild.storage_path !== web.storage_path) {
        thumbSigned = (await supabase.storage.from("media").createSignedUrl(thumbChild.storage_path, 3600)).data;
      } else if (!thumbChild && isVideo) {
        thumbSigned = null; // a video with no poster has no image thumbnail
      }
      const g = r.guest_id ? guestMap.get(r.guest_id) : undefined;
      return { ...r, url: webU?.signedUrl, thumbUrl: thumbSigned?.signedUrl, guestName: g?.name, guestCode: g?.code };
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
    if (approval === "pending" && a.approved !== false) return false;
    if (approval === "approved" && a.approved === false) return false;
    if (album !== "all" && albumOf(a) !== album) return false;
    if (q && !(a.guestName || "").toLowerCase().includes(q) && !(a.guestCode || "").toLowerCase().includes(q) && !albumOf(a).toLowerCase().includes(q)) return false;
    return true;
  });

  const pendingCount = assets.filter((a) => a.approved === false).length;
  // Folders that exist in the data (from uploaded photos) plus any just created
  // this session — so a new, still-empty folder is selectable right away.
  const albums = useMemo(
    () => Array.from(new Set([...createdAlbums, ...assets.map(albumOf).filter(Boolean)])).sort(),
    [assets, createdAlbums],
  );

  // Create an empty folder, select it as the upload target, and focus it.
  function createFolder() {
    const n = window.prompt("New folder / album name");
    const name = (n || "").trim();
    if (!name) return;
    setCreatedAlbums((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setUploadAlbum(name);
    setAlbum(name);
  }

  // Rename an album: rewrite the album label on every matching asset row.
  async function renameAlbum(oldName: string, newName: string) {
    await supabase.from("assets").update({ meta: { album: newName } }).eq("event_id", event.id).filter("meta->>album", "eq", oldName);
    setCreatedAlbums((prev) => prev.map((a) => (a === oldName ? newName : a)));
    if (uploadAlbum === oldName) setUploadAlbum(newName);
    setAlbum(newName);
    load();
  }

  const items: LightboxItem[] = filtered.map((a) => ({ id: a.id, kind: a.kind === "video" ? "video" : "photo", url: a.url, thumbUrl: a.thumbUrl }));

  async function downloadAll() {
    for (const a of filtered) {
      if (!a.url) continue;
      try {
        // Signed storage URLs are cross-origin, so the <a download> attribute is
        // ignored and the file just opens. Fetch the bytes and download a blob.
        const res = await fetch(a.url);
        const blob = await res.blob();
        const ext = a.kind === "video" ? "mp4" : "jpg";
        const objUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objUrl;
        link.download = `${event.slug}-${a.guestCode || a.id.slice(0, 6)}.${ext}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objUrl);
      } catch { /* skip files that fail to fetch */ }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async function setApproved(a: EnrichedAsset, approved: boolean) {
    await supabase.from("assets").update({ approved }).eq("event_id", event.id).or(`id.eq.${a.id},parent_asset_id.eq.${a.id}`);
    load();
  }

  // Re-run the event's AI style on a photo whose first attempt failed.
  async function retryStyle(a: EnrichedAsset) {
    try {
      await reprocessAsset({ data: { assetId: a.id } });
    } finally {
      load();
    }
  }



  // Permanently delete a photo: its original + all variants (rows AND files).
  async function deletePhoto(a: EnrichedAsset) {
    const { data: related } = await supabase
      .from("assets")
      .select("storage_path")
      .eq("event_id", event.id)
      .or(`id.eq.${a.id},parent_asset_id.eq.${a.id}`);
    const paths = (related || []).map((r) => r.storage_path).filter(Boolean) as string[];
    if (paths.length) await supabase.storage.from("media").remove(paths);
    await supabase.from("assets").delete().eq("event_id", event.id).or(`id.eq.${a.id},parent_asset_id.eq.${a.id}`);
    setConfirmDel(null);
    if (lightbox !== null) setLightbox(null);
    load();
  }

  async function handleUpload(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true); setUploadMsg(null);
    let ok = 0, fail = 0;
    for (const file of Array.from(files)) {
      try {
        const lowerName = file.name.toLowerCase();
        const isImg = file.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/.test(lowerName);
        const isVideo = file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv)$/.test(lowerName);
        if (!isImg && !isVideo) continue; // folders can contain non-media files — skip them
        // Folder uploads carry a relative path like "Album/photo.jpg" — use the
        // file's immediate folder name as its album label.
        const rel = (file as { webkitRelativePath?: string }).webkitRelativePath || "";
        const relParts = rel.split("/").filter(Boolean);
        // Folder name wins; otherwise use the album typed in the toolbar.
        const album = (relParts.length > 1 ? relParts[relParts.length - 2] : "") || uploadAlbum.trim();
        const meta = album ? { album } : {};
        const ext = (file.name.split(".").pop() || (isVideo ? "mp4" : "jpg")).toLowerCase();
        const id = crypto.randomUUID();
        const basePath = `${event.id}/admin/${id}`;
        // Upload original
        const { error: upErr } = await supabase.storage.from("media").upload(`${basePath}.${ext}`, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
        const requireApproval = Boolean(event.config.gallery?.requireApproval);
        const { error: insErr } = await supabase.from("assets").insert({
          id, event_id: event.id, guest_id: null, parent_asset_id: null,
          kind: isVideo ? "video" : "photo", variant: "original",
          storage_path: `${basePath}.${ext}`, content_type: file.type || (isVideo ? "video/mp4" : "image/jpeg"),
          bytes: file.size, status: "ready", approved: !requireApproval, meta,
        });
        if (insErr) throw insErr;
        // Web variant for photos (snappier gallery)
        if (!isVideo) {
          try {
            const web = await resizeImage(file, 1600, 0.85);
            const webId = crypto.randomUUID();
            const webPath = `${event.id}/admin/${webId}.jpg`;
            const { error: webUpErr } = await supabase.storage.from("media").upload(webPath, web, { contentType: "image/jpeg", upsert: false });
            if (!webUpErr) {
              await supabase.from("assets").insert({
                id: webId, event_id: event.id, guest_id: null, parent_asset_id: id,
                kind: "photo", variant: "web", storage_path: webPath, content_type: "image/jpeg",
                bytes: web.size, status: "ready", approved: !requireApproval, meta,
              });
            }
            const thumb = await resizeImage(file, 600, 0.8);
            const thumbId = crypto.randomUUID();
            const thumbPath = `${event.id}/admin/${thumbId}.jpg`;
            const { error: thUpErr } = await supabase.storage.from("media").upload(thumbPath, thumb, { contentType: "image/jpeg", upsert: false });
            if (!thUpErr) {
              await supabase.from("assets").insert({
                id: thumbId, event_id: event.id, guest_id: null, parent_asset_id: id,
                kind: "photo", variant: "thumb", storage_path: thumbPath, content_type: "image/jpeg",
                bytes: thumb.size, status: "ready", approved: !requireApproval, meta,
              });
            }
          } catch { /* variants are best-effort */ }
        } else {
          // Generate a poster (first frame) so videos show a thumbnail.
          try {
            const poster = await videoPoster(file);
            if (poster) {
              const posterId = crypto.randomUUID();
              const posterPath = `${event.id}/admin/${posterId}.jpg`;
              const { error: pErr } = await supabase.storage.from("media").upload(posterPath, poster, { contentType: "image/jpeg", upsert: false });
              if (!pErr) {
                await supabase.from("assets").insert({
                  id: posterId, event_id: event.id, guest_id: null, parent_asset_id: id,
                  kind: "video", variant: "poster", storage_path: posterPath, content_type: "image/jpeg",
                  bytes: poster.size, status: "ready", approved: !requireApproval, meta,
                });
              }
            }
          } catch { /* poster is best-effort */ }
        }
        ok++;
      } catch (e) {
        console.error("upload failed", e);
        fail++;
      }
    }
    setUploading(false);
    setUploadMsg(`${ok} uploaded${fail ? `, ${fail} failed` : ""}${event.config.gallery?.requireApproval ? " — pending your approval" : ""}`);
    load();
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
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={createFolder}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition hover:bg-muted"
              title="Create a folder, then upload photos into it"
            >📁 New folder</button>
            <input
              list="album-list"
              value={uploadAlbum}
              onChange={(e) => setUploadAlbum(e.target.value)}
              placeholder="Album (optional)"
              title="Type a new album or pick an existing one — uploads go into it and show as a section on the wall"
              className="w-36 rounded-lg border border-border bg-input px-2.5 py-1.5 text-sm outline-none focus:border-primary"
            />
            <datalist id="album-list">{albums.map((al) => <option key={al} value={al} />)}</datalist>
            <label className={`cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground transition hover:opacity-90 ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
              {uploading ? "Uploading…" : "+ Upload"}
              <input type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => { handleUpload(e.target.files); e.currentTarget.value = ""; }} />
            </label>
            <label className={`hidden cursor-pointer rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-bold text-primary transition hover:bg-primary/20 sm:inline-block ${uploading ? "opacity-60 pointer-events-none" : ""}`} title="Pick a folder; each sub-folder name becomes an album (desktop only)">
              📁 Upload folder
              <input ref={folderRef} type="file" multiple className="hidden" onChange={(e) => { handleUpload(e.target.files); e.currentTarget.value = ""; }} />
            </label>
            <button onClick={downloadAll} disabled={!filtered.length} className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition hover:bg-muted disabled:opacity-50">Download all</button>
            <button onClick={load} className="rounded-lg border border-border px-3 py-1.5 text-sm">Refresh</button>
            <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm">Close</button>
          </div>
        </div>
        {uploadMsg && <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">{uploadMsg}</div>}

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-border bg-background p-0.5">
            {(["all", "linked", "orphan"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{f}</button>
            ))}
          </div>
          <div className="flex gap-1 rounded-lg border border-border bg-background p-0.5">
            {(["all", "pending", "approved"] as const).map((f) => (
              <button key={f} onClick={() => setApproval(f)} className={`rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition ${approval === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {f}{f === "pending" && pendingCount ? ` · ${pendingCount}` : ""}
              </button>
            ))}
          </div>
          {albums.length > 0 && (
            <div className="flex items-center gap-1">
              <select value={album} onChange={(e) => setAlbum(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground outline-none">
                <option value="all">📁 All albums</option>
                {albums.map((al) => <option key={al} value={al}>{al}</option>)}
              </select>
              {album !== "all" && (
                <button
                  onClick={() => { const n = window.prompt("Rename album", album); if (n && n.trim() && n.trim() !== album) renameAlbum(album, n.trim()); }}
                  className="rounded-md border border-border px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider transition hover:bg-muted"
                >Rename</button>
              )}
            </div>
          )}
          <input placeholder="Search album, guest name or code…" value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 min-w-[180px] rounded-xl border border-border bg-input px-3 py-1.5 text-sm outline-none focus:border-primary" />
        </div>

        <div className="overflow-auto" style={{ maxHeight: "70vh" }}>
          {loading ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {Array.from({ length: 12 }).map((_, i) => <div key={i} className="aspect-square animate-pulse rounded-lg bg-muted" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="grid place-items-center py-20 text-center">
              <div className="text-6xl opacity-30">📷</div>
              <p className="mt-3 text-sm text-muted-foreground">No photos yet. Click <span className="font-bold text-primary">+ Upload</span> or wait for staff to upload.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {filtered.map((a, i) => (
                <div key={a.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted transition hover:border-primary">
                  <button onClick={() => setLightbox(i)} className="absolute inset-0 h-full w-full">
                    {a.thumbUrl ? (
                      <img src={a.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-2xl opacity-40">{a.kind === "video" ? "🎬" : "📷"}</div>
                    )}
                  </button>
                  {a.kind === "video" && <span className="pointer-events-none absolute top-1 right-1 rounded bg-black/70 px-1 text-[9px] font-bold text-white">VIDEO</span>}
                  {a.approved === false && <span className="pointer-events-none absolute top-1 left-1 rounded bg-[color:var(--warning)]/90 px-1 text-[9px] font-bold text-black">PENDING</span>}
                  {(a.process_status === "pending" || a.process_status === "processing") && (
                    <span className="pointer-events-none absolute inset-x-1 top-6 rounded bg-primary/90 px-1 text-center text-[9px] font-bold text-primary-foreground">STYLING…</span>
                  )}
                  {a.process_status === "done" && a.generation_model && (
                    <span className="pointer-events-none absolute inset-x-1 top-6 truncate rounded bg-black/70 px-1 text-center text-[8px] font-bold text-white" title={`model ${a.generation_model}`}>
                      {a.generation_model}
                    </span>
                  )}
                  {a.process_status === "failed" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); retryStyle(a); }}
                      title={a.error_message || "Style failed — retry"}
                      className="absolute inset-x-1 top-6 rounded bg-destructive px-1 text-center text-[9px] font-bold text-destructive-foreground"
                    >STYLE FAILED · RETRY</button>
                  )}
                  {(a.guestCode || albumOf(a)) && (
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-start text-[10px] font-bold text-white">
                      {albumOf(a) && <span className="block truncate opacity-90">📁 {albumOf(a)}</span>}
                      {a.guestCode && <span className="code-display block truncate" dir="ltr">{a.guestCode}</span>}
                      {a.guestName && <span className="block truncate font-normal opacity-80">{a.guestName}</span>}
                    </span>
                  )}
                  <div className="absolute right-1 bottom-1 z-10 flex gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                    {a.approved === false ? (
                      <button onClick={(e) => { e.stopPropagation(); setApproved(a, true); }} title="Approve" className="rounded bg-[color:var(--success)] px-1.5 py-0.5 text-[10px] font-bold text-black">✓</button>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); setApproved(a, false); }} title="Unpublish" className="rounded bg-[color:var(--warning)] px-1.5 py-0.5 text-[10px] font-bold text-black">↩</button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); setConfirmDel(a); }} title="Delete" className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">🗑</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {lightbox !== null && (
        // Isolate the lightbox from the modal's click-to-close backdrop so its
        // X / backdrop only closes the lightbox, not the whole Photos panel.
        <div onClick={(e) => e.stopPropagation()}>
          <Lightbox
            items={items}
            index={lightbox}
            onClose={() => setLightbox(null)}
            onIndexChange={setLightbox}
            shareTitle={event.name}
          />
        </div>
      )}
      {confirmDel && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmModal
            title="Delete photo?"
            body={`This permanently removes the ${confirmDel.kind === "video" ? "video" : "photo"} and all its variants — the file and database record. This cannot be undone.`}
            confirmLabel="Delete"
            onCancel={() => setConfirmDel(null)}
            onConfirm={() => deletePhoto(confirmDel)}
          />
        </div>
      )}
    </div>
  );
}

// ---------------- AI pipeline diagnostics ----------------
// Raw, unfiltered view of what the processing pipeline recorded per photo row.
// Nothing is inferred here: every column is read straight from the database so
// a stuck row can be diagnosed without guessing.
type DiagRow = {
  id: string;
  kind: string;
  variant: string;
  guest_id: string | null;
  storage_path: string;
  original_url: string | null;
  processed_url: string | null;
  process_status: string | null;
  generation_model: string | null;
  generation_cost: number | null;
  error_message: string | null;
  processing_started_at: string | null;
  processing_finished_at: string | null;
  created_at: string;
  meta: Record<string, unknown>;
};

export function DiagnosticsModal({ event, onClose }: { event: EventRow; onClose: () => void }) {
  const [rows, setRows] = useState<DiagRow[]>([]);
  const [ev, setEv] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    await sweepEventProcessing({ data: { eventId: event.id } });
    const [{ data: a }, { data: e }] = await Promise.all([
      supabase
        .from("assets")
        .select("id,kind,variant,guest_id,storage_path,original_url,processed_url,process_status,generation_model,generation_cost,error_message,processing_started_at,processing_finished_at,created_at,meta")
        .eq("event_id", event.id)
        .eq("kind", "photo")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("events")
        .select("template_mode,template_prompt,template_quality,template_aspect_ratio,template_frame_url,template_reference_url,max_generations,generations_used")
        .eq("id", event.id)
        .maybeSingle(),
    ]);
    setRows((a || []) as DiagRow[]);
    setEv((e || null) as Record<string, unknown> | null);
    setLoading(false);
  }
  useEffect(() => { load(); }, [event.id]);

  const mode = String(ev?.["template_mode"] ?? "none");
  const prompt = String(ev?.["template_prompt"] ?? "");

  async function retry(id: string) {
    setBusy(id);
    try {
      // Admin-authenticated path into the exact same processing function the
      // public endpoint calls, so the result is directly comparable.
      const r = await reprocessAsset({ data: { assetId: id } });
      toast[r.ok ? "success" : "error"](`${r.status}${r.model ? ` · ${r.model}` : ""}${r.error ? ` · ${r.error}` : ""}`);
      await load();
    } catch (err) {
      toast.error(`call failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const fmt = (v: string | null) => (v ? new Date(v).toLocaleTimeString() : "—");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-3" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl border border-border bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Pipeline diagnostics · {event.name}</h3>
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-1 text-xs font-semibold">Close</button>
        </div>

        <div className="mt-3 grid gap-1 rounded-xl border border-border bg-muted/40 p-3 text-xs">
          <div><b>template_mode</b>: {mode} {mode !== "ai" && <span className="text-muted-foreground">— photos will be recorded as “done” and never sent to the AI provider</span>}</div>
          <div><b>prompt</b>: {prompt ? `${prompt.slice(0, 120)}${prompt.length > 120 ? "…" : ""}` : <span className="text-destructive">missing — AI is skipped without one</span>}</div>
          <div><b>reference image</b>: {ev?.["template_reference_url"] ? "set" : "none"} · <b>frame</b>: {ev?.["template_frame_url"] ? "set" : "none"}</div>
          <div><b>quality</b>: {String(ev?.["template_quality"] ?? "")} · <b>size</b>: {String(ev?.["template_aspect_ratio"] ?? "")}</div>
          <div><b>generations</b>: {String(ev?.["generations_used"] ?? 0)} / {String(ev?.["max_generations"] ?? 0)}</div>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No photo rows for this event yet — nothing has been uploaded, so the pipeline has never run.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-muted-foreground">
                <tr>
                  {["id", "status", "model", "started", "finished", "cost", "original_url", "processed_url", "error_message", ""].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-1 font-semibold uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-2 py-1 font-mono">{r.id.slice(0, 8)}</td>
                    <td className="px-2 py-1 font-bold">{r.process_status || "—"}</td>
                    <td className="px-2 py-1">{r.generation_model || "—"}</td>
                    <td className="px-2 py-1">{fmt(r.processing_started_at)}</td>
                    <td className="px-2 py-1">{fmt(r.processing_finished_at)}</td>
                    <td className="px-2 py-1">{r.generation_cost != null ? `$${Number(r.generation_cost).toFixed(3)}` : "—"}</td>
                    <td className="px-2 py-1 font-mono">{r.original_url ? "set" : <span className="text-destructive">null</span>}</td>
                    <td className="px-2 py-1 font-mono">{r.processed_url ? "set" : "—"}</td>
                    <td className="min-w-[320px] max-w-[560px] whitespace-pre-wrap break-all px-2 py-1 font-mono text-destructive">{r.error_message || "—"}</td>
                    <td className="px-2 py-1">
                      <button disabled={busy === r.id} onClick={() => retry(r.id)} className="rounded-md border border-border px-2 py-1 font-semibold disabled:opacity-50">
                        {busy === r.id ? "…" : "Run"}
                      </button>
                      {Array.isArray(r.meta?.ai_provider_attempts) && r.meta.ai_provider_attempts.length > 0 && (
                        <details className="mt-2 min-w-[640px] max-w-[900px]">
                          <summary className="cursor-pointer font-semibold text-primary">Provider evidence ({r.meta.ai_provider_attempts.length})</summary>
                          <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-background p-2 text-[10px] text-foreground">{JSON.stringify(r.meta.ai_provider_attempts, null, 2)}</pre>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              “Run” executes the processing function synchronously as admin and shows its exact result or provider error — use it to see where a row stops. It costs a generation only if the event is in AI mode and the row is claimable.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

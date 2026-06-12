import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_CONFIG, type EventConfig, type EventRow, type GuestRow } from "@/lib/types";
import { T, pick } from "@/lib/i18n";
import { SelfieAvatar } from "@/components/SelfieAvatar";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "LAQTA · Admin" }] }),
  component: Admin,
});

function Admin() {
  const [session, setSession] = useState<unknown>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <main className="grid min-h-screen place-items-center bg-background"><div className="text-muted-foreground">···</div></main>;
  if (!session) return <AuthForm />;
  return <AdminDashboard />;
}

function AuthForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/admin" } });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <div className="code-display text-2xl text-primary">LAQTA · ADMIN</div>
          <p className="mt-2 text-xs text-muted-foreground">{mode === "signup" ? "First user becomes admin" : ""}</p>
        </div>
        <input dir="ltr" type="email" placeholder={pick(T.email, "en")} value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl border border-border bg-input px-4 py-3 text-foreground outline-none focus:border-primary" required />
        <input dir="ltr" type="password" placeholder={pick(T.password, "en")} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-border bg-input px-4 py-3 text-foreground outline-none focus:border-primary" required minLength={6} />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-primary px-6 py-3 font-bold text-primary-foreground disabled:opacity-60">
          {mode === "signup" ? pick(T.signUp, "en") : pick(T.signIn, "en")}
        </button>
        <button type="button" onClick={() => setMode(mode === "signup" ? "signin" : "signup")} className="w-full text-center text-xs text-muted-foreground underline">
          {mode === "signup" ? "Have an account? Sign in" : "Need an account? Sign up"}
        </button>
      </form>
    </main>
  );
}

function AdminDashboard() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [counts, setCounts] = useState<Record<string, { guests: number; assets: number }>>({});
  const [creating, setCreating] = useState(false);

  async function load() {
    const { data } = await supabase.from("events").select("*").order("created_at", { ascending: false });
    const rows = (data || []).map((d) => ({ ...d, status: d.status as EventRow["status"], config: { ...DEFAULT_CONFIG, ...(d.config as Partial<EventConfig>) } })) as EventRow[];
    setEvents(rows);
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

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="code-display text-xl text-primary">LAQTA · ADMIN</div>
          <button onClick={signOut} className="text-sm text-muted-foreground hover:text-foreground">{pick(T.signOut, "en")}</button>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">{pick(T.events, "en")}</h1>
          <button onClick={() => setCreating(true)} className="rounded-xl bg-primary px-4 py-2 font-bold text-primary-foreground">+ {pick(T.newEvent, "en")}</button>
        </div>
        <div className="grid gap-3">
          {events.length === 0 && <p className="text-muted-foreground">No events yet.</p>}
          {events.map((ev) => (
            <EventRowView key={ev.id} ev={ev} count={counts[ev.id]} onChange={load} />
          ))}
        </div>
      </div>
      {creating && <EventEditor onClose={() => { setCreating(false); load(); }} />}
    </main>
  );
}

function EventRowView({ ev, count, onChange }: { ev: EventRow; count?: { guests: number; assets: number }; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [showRegs, setShowRegs] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-bold">{ev.name}</div>
          <div className="text-xs text-muted-foreground" dir="ltr">/{ev.slug} · PIN {ev.staff_pin}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            ev.status === "live" ? "bg-[color:var(--success)] text-black"
              : ev.status === "dryrun" ? "bg-[color:var(--warning)] text-black"
              : "bg-muted text-muted-foreground"
          }`}>{ev.status}</span>
          {ev.config.gallery?.mode === "public" && (
            <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">public wall</span>
          )}
          <span className="text-sm text-muted-foreground">{count?.guests ?? "·"} guests · {count?.assets ?? "·"} ready</span>
          <button onClick={() => setShowRegs(true)} className="rounded-lg border border-border px-3 py-1 text-sm">Registrations</button>
          <button onClick={() => setEditing(true)} className="rounded-lg border border-border px-3 py-1 text-sm">Edit</button>
        </div>
      </div>
      <div className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-4" dir="ltr">
        <a className="hover:text-primary" href={`${origin}/e/${ev.slug}`} target="_blank" rel="noreferrer">Guest form ↗</a>
        <a className="hover:text-primary" href={`${origin}/staff/${ev.slug}`} target="_blank" rel="noreferrer">Staff console ↗</a>
        {ev.config.gallery?.mode === "public" && (
          <a className="hover:text-primary" href={`${origin}/e/${ev.slug}/gallery`} target="_blank" rel="noreferrer">Public wall ↗</a>
        )}
        <a className="hover:text-primary" href={`${origin}/admin`}>Admin</a>
      </div>
      {editing && <EventEditor event={ev} onClose={() => { setEditing(false); onChange(); }} />}
      {showRegs && <RegistrationsModal event={ev} onClose={() => setShowRegs(false)} />}
    </div>
  );
}

function RegistrationsModal({ event, onClose }: { event: EventRow; onClose: () => void }) {
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [query, setQuery] = useState("");
  const [liveOn, setLiveOn] = useState(false);
  const [active, setActive] = useState<GuestRow | null>(null);

  async function load() {
    const { data } = await supabase
      .from("guests").select("*").eq("event_id", event.id)
      .order("created_at", { ascending: false }).limit(500);
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
    const i = setInterval(load, 5000);
    return () => { supabase.removeChannel(ch); clearInterval(i); };
  }, [event.id]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? guests.filter((g) =>
        (g.form_data.name || "").toLowerCase().includes(q) ||
        (g.form_data.phone || "").toLowerCase().includes(q) ||
        g.code.toLowerCase().includes(q))
    : guests;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div className="grid w-full max-w-4xl gap-3 rounded-2xl border border-border bg-card p-5 max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Registrations — {event.name}</h2>
            <div className="mt-1 flex items-center gap-3 text-xs">
              <span className={liveOn ? "text-[color:var(--success)]" : "text-muted-foreground"}>
                {liveOn ? "● live" : "○ refreshing"}
              </span>
              <span className="text-muted-foreground">{guests.length} total</span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-1 text-sm">Close</button>
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
                  className={`flex w-full items-center gap-3 rounded-lg border p-2 text-start transition ${active?.id === g.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                >
                  <SelfieAvatar path={g.selfie_path} name={g.form_data.name || ""} size={48} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{g.form_data.name || "—"}</span>
                    <span className="block text-xs text-muted-foreground" dir="ltr">
                      <span className="code-display">{g.code}</span>
                      {g.form_data.phone && <span className="ms-2">{g.form_data.phone}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{new Date(g.created_at).toLocaleString()}</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="py-8 text-center text-sm text-muted-foreground">No registrations yet.</li>}
          </ul>
          <aside className="rounded-xl border border-border bg-background p-3">
            {active ? (
              <GuestDetail guest={active} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Select a guest to view details.</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function GuestDetail({ guest }: { guest: GuestRow }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col items-center">
        <SelfieAvatar path={guest.selfie_path} name={guest.form_data.name || ""} size={120} />
        <div className="mt-3 text-lg font-bold">{guest.form_data.name || "—"}</div>
        <div className="code-display text-sm text-primary" dir="ltr">{guest.code}</div>
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
    </div>
  );
}

function genPin() { return Math.floor(100000 + Math.random() * 900000).toString(); }
function slugify(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40); }

function EventEditor({ event, onClose }: { event?: EventRow; onClose: () => void }) {
  const [name, setName] = useState(event?.name || "");
  const [slug, setSlug] = useState(event?.slug || "");
  const [status, setStatus] = useState<EventRow["status"]>(event?.status || "draft");
  const [pin, setPin] = useState(event?.staff_pin || genPin());
  const [config, setConfig] = useState<EventConfig>(event?.config || DEFAULT_CONFIG);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr(null); setBusy(true);
    const payload = { name, slug: slug || slugify(name), status, config: config as unknown as never, staff_pin: pin };
    const q = event
      ? supabase.from("events").update(payload).eq("id", event.id)
      : supabase.from("events").insert(payload);
    const { error } = await q;
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onClose();
  }

  async function clone() {
    if (!event) return;
    setBusy(true);
    await supabase.from("events").insert({
      name: event.name + " (dry run)", slug: event.slug + "-dryrun",
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

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div className="grid w-full max-w-5xl gap-4 rounded-2xl border border-border bg-card p-5 lg:grid-cols-[2fr_1fr] max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-4">
          <h2 className="text-xl font-bold">{event ? "Edit event" : "New event"}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className="input" /></Field>
            <Field label="Slug"><input dir="ltr" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder={slugify(name)} className="input" /></Field>
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value as EventRow["status"])} className="input">
                {["draft", "dryrun", "live", "archived"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Staff PIN (6)">
              <div className="flex gap-2">
                <input dir="ltr" value={pin} maxLength={6} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="input flex-1 code-display" />
                <button type="button" onClick={() => setPin(genPin())} className="rounded-lg border border-border px-3 text-sm">↻</button>
              </div>
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Primary"><input type="color" value={config.theme.primary} onChange={(e) => setConfig({ ...config, theme: { ...config.theme, primary: e.target.value } })} className="h-10 w-full rounded" /></Field>
            <Field label="Background"><input type="color" value={config.theme.background} onChange={(e) => setConfig({ ...config, theme: { ...config.theme, background: e.target.value } })} className="h-10 w-full rounded" /></Field>
            <Field label="Text"><input type="color" value={config.theme.text} onChange={(e) => setConfig({ ...config, theme: { ...config.theme, text: e.target.value } })} className="h-10 w-full rounded" /></Field>
          </div>

          <Field label="Logo URL"><input dir="ltr" value={config.theme.logoUrl} onChange={(e) => setConfig({ ...config, theme: { ...config.theme, logoUrl: e.target.value } })} placeholder="https://…" className="input" /></Field>

          <Field label="Locale">
            <select value={config.locale} onChange={(e) => setConfig({ ...config, locale: e.target.value as EventConfig["locale"] })} className="input">
              <option value="both">Both (toggle)</option><option value="ar">Arabic only</option><option value="en">English only</option>
            </select>
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">Form fields</h3>
              <button type="button" onClick={addField} className="text-sm text-primary">+ Add field</button>
            </div>
            <div className="space-y-2">
              {config.fields.map((f, i) => (
                <div key={i} className="grid items-end gap-2 rounded-lg border border-border p-2 md:grid-cols-[100px_100px_1fr_1fr_70px_30px]">
                  <input value={f.key} onChange={(e) => updateField(i, { key: e.target.value })} placeholder="key" className="input" />
                  <select value={f.type} onChange={(e) => updateField(i, { type: e.target.value as EventField["type"] })} className="input">
                    {["text", "tel", "email", "number"].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input value={f.label.ar} onChange={(e) => updateField(i, { label: { ...f.label, ar: e.target.value } })} placeholder="عربي" className="input font-arabic" dir="rtl" />
                  <input value={f.label.en} onChange={(e) => updateField(i, { label: { ...f.label, en: e.target.value } })} placeholder="English" className="input" dir="ltr" />
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={f.required} onChange={(e) => updateField(i, { required: e.target.checked })} /> req</label>
                  <button type="button" onClick={() => removeField(i)} className="text-destructive">✕</button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Consent (AR)"><input value={config.consentText.ar} dir="rtl" onChange={(e) => setConfig({ ...config, consentText: { ...config.consentText, ar: e.target.value } })} className="input font-arabic" /></Field>
            <Field label="Consent (EN)"><input value={config.consentText.en} dir="ltr" onChange={(e) => setConfig({ ...config, consentText: { ...config.consentText, en: e.target.value } })} className="input" /></Field>
            <Field label="Success (AR)"><input value={config.successMessage.ar} dir="rtl" onChange={(e) => setConfig({ ...config, successMessage: { ...config.successMessage, ar: e.target.value } })} className="input font-arabic" /></Field>
            <Field label="Success (EN)"><input value={config.successMessage.en} dir="ltr" onChange={(e) => setConfig({ ...config, successMessage: { ...config.successMessage, en: e.target.value } })} className="input" /></Field>
            <Field label="Max photo MB"><input type="number" value={config.limits.maxPhotoMB} onChange={(e) => setConfig({ ...config, limits: { ...config.limits, maxPhotoMB: +e.target.value } })} className="input" /></Field>
            <Field label="Max video MB"><input type="number" value={config.limits.maxVideoMB} onChange={(e) => setConfig({ ...config, limits: { ...config.limits, maxVideoMB: +e.target.value } })} className="input" /></Field>
          </div>

          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="rounded-xl bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-60">{event ? "Save" : "Create"}</button>
            {event && <button onClick={clone} disabled={busy} className="rounded-xl border border-border px-4 py-2 text-sm">Clone as dry run</button>}
            <button onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>

        <PhonePreview config={config} name={name || "Event"} />
      </div>
      <style>{`.input{width:100%;border-radius:8px;border:1px solid var(--border);background:var(--input);padding:0.5rem 0.75rem;color:var(--foreground);outline:none}`}</style>
    </div>
  );
}

type EventField = EventConfig["fields"][number];
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>{children}</label>;
}

function PhonePreview({ config, name }: { config: EventConfig; name: string }) {
  return (
    <div className="sticky top-0">
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
          </div>
          <button className="mt-4 w-full rounded-lg py-2 text-sm font-bold" style={{ background: config.theme.primary, color: config.theme.background }}>تسجيل</button>
        </div>
      </div>
    </div>
  );
}

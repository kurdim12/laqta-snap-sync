import { createFileRoute, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_CONFIG, type EventConfig, type EventRow, type GuestRow } from "@/lib/types";
import { T, pick } from "@/lib/i18n";
import { newId } from "@/lib/code";
import { resizeImage, videoPoster } from "@/lib/media";

export const Route = createFileRoute("/staff/$slug")({
  head: () => ({ meta: [{ title: "LAQTA · Staff" }] }),
  component: StaffConsole,
});

const PIN_KEY = (slug: string) => `laqta:staff:${slug}`;

function StaffConsole() {
  const { slug } = useParams({ from: "/staff/$slug" });
  const [event, setEvent] = useState<EventRow | null>(null);
  const [pinOk, setPinOk] = useState(false);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("events").select("*").eq("slug", slug).maybeSingle();
      if (data) setEvent({ ...data, status: data.status as EventRow["status"], config: { ...DEFAULT_CONFIG, ...(data.config as Partial<EventConfig>) } });
      const stored = typeof window !== "undefined" ? sessionStorage.getItem(PIN_KEY(slug)) : null;
      if (stored && data) {
        const { data: ev } = await supabase.rpc("verify_staff_pin", { _slug: slug, _pin: stored });
        if (ev) setPinOk(true);
      }
    })();
  }, [slug]);

  async function submitPin() {
    setPinErr(null);
    const { data, error } = await supabase.rpc("verify_staff_pin", { _slug: slug, _pin: pin });
    if (error || !data) { setPinErr("Wrong PIN / رمز خاطئ"); return; }
    sessionStorage.setItem(PIN_KEY(slug), pin);
    setPinOk(true);
  }

  if (!event) {
    return <main className="grid min-h-screen place-items-center bg-background"><div className="text-muted-foreground">···</div></main>;
  }
  if (!pinOk) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-6">
        <div className="w-full max-w-sm text-center">
          <div className="code-display text-2xl text-primary">LAQTA · STAFF</div>
          <div className="mt-2 text-sm text-muted-foreground">{event.name}</div>
          <p className="mt-6 text-sm font-arabic">{pick(T.staffPin, "ar")}</p>
          <p className="text-xs text-muted-foreground">{pick(T.staffPin, "en")}</p>
          <input
            inputMode="numeric"
            maxLength={6}
            value={pin}
            dir="ltr"
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className="code-display mt-6 w-full rounded-xl border border-border bg-input px-4 py-5 text-center text-3xl text-foreground outline-none focus:border-primary"
          />
          {pinErr && <p className="mt-2 text-sm text-destructive">{pinErr}</p>}
          <button onClick={submitPin} className="mt-6 w-full rounded-xl bg-primary px-6 py-4 text-lg font-bold text-primary-foreground">
            ✓
          </button>
        </div>
      </main>
    );
  }
  return <StaffMain event={event} />;
}

interface QueueItem {
  id: string;            // local
  file: File;
  guestId: string | null;
  state: "queued" | "uploading" | "done" | "retrying" | "paused";
  progress: number;
  attempts: number;
  error?: string;
  assetId?: string;
}

function StaffMain({ event }: { event: EventRow }) {
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [active, setActive] = useState<GuestRow | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [liveOn, setLiveOn] = useState(false);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  async function loadGuests() {
    const { data } = await supabase
      .from("guests").select("*").eq("event_id", event.id)
      .order("created_at", { ascending: false }).limit(50);
    setGuests((data || []) as GuestRow[]);
  }
  useEffect(() => {
    loadGuests();
    // realtime
    const ch = supabase
      .channel(`staff-guests-${event.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guests", filter: `event_id=eq.${event.id}` },
        () => loadGuests(),
      )
      .subscribe((status) => setLiveOn(status === "SUBSCRIBED"));
    // polling fallback (also keeps photo counts fresh)
    const i = setInterval(loadGuests, 5000);
    return () => { supabase.removeChannel(ch); clearInterval(i); };
  }, [event.id]);

  function update(id: string, patch: Partial<QueueItem>) {
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function uploadOne(item: QueueItem) {
    update(item.id, { state: "uploading", progress: 5 });
    const isVideo = item.file.type.startsWith("video/");
    const kind: "photo" | "video" = isVideo ? "video" : "photo";
    const assetId = item.assetId || newId();
    const ext = item.file.name.split(".").pop() || (isVideo ? "mp4" : "jpg");
    const basePath = `${event.id}/${assetId}`;
    try {
      // upload original
      const origPath = `${basePath}/original.${ext}`;
      const { error: upErr } = await supabase.storage.from("media").upload(origPath, item.file, { upsert: true, contentType: item.file.type });
      if (upErr) throw upErr;
      update(item.id, { progress: 40, assetId });

      // create asset row (parent)
      const parent = { id: assetId, event_id: event.id, guest_id: item.guestId, parent_asset_id: null,
        kind, variant: "original" as const, storage_path: origPath, content_type: item.file.type,
        bytes: item.file.size, status: "ready" as const, meta: {} };
      const { error: aErr } = await supabase.from("assets").upsert(parent, { onConflict: "id" });
      if (aErr) throw aErr;
      update(item.id, { progress: 55 });

      // variants
      if (kind === "photo") {
        const webBlob = await resizeImage(item.file, 1920, 0.85);
        const thumbBlob = await resizeImage(item.file, 400, 0.8);
        const webPath = `${basePath}/web.jpg`;
        const thumbPath = `${basePath}/thumb.jpg`;
        await supabase.storage.from("media").upload(webPath, webBlob, { upsert: true, contentType: "image/jpeg" });
        update(item.id, { progress: 75 });
        await supabase.storage.from("media").upload(thumbPath, thumbBlob, { upsert: true, contentType: "image/jpeg" });
        await supabase.from("assets").upsert([
          { id: newId(), event_id: event.id, guest_id: item.guestId, parent_asset_id: assetId, kind, variant: "web", storage_path: webPath, content_type: "image/jpeg", bytes: webBlob.size, status: "ready", meta: {} },
          { id: newId(), event_id: event.id, guest_id: item.guestId, parent_asset_id: assetId, kind, variant: "thumb", storage_path: thumbPath, content_type: "image/jpeg", bytes: thumbBlob.size, status: "ready", meta: {} },
        ]);
      } else {
        const poster = await videoPoster(item.file);
        if (poster) {
          const posterPath = `${basePath}/poster.jpg`;
          await supabase.storage.from("media").upload(posterPath, poster, { upsert: true, contentType: "image/jpeg" });
          await supabase.from("assets").upsert([{
            id: newId(), event_id: event.id, guest_id: item.guestId, parent_asset_id: assetId,
            kind, variant: "poster", storage_path: posterPath, content_type: "image/jpeg",
            bytes: poster.size, status: "ready", meta: {},
          }]);
        }
      }
      update(item.id, { state: "done", progress: 100 });
    } catch (e) {
      const attempts = item.attempts + 1;
      const msg = (e as Error).message || "upload failed";
      if (attempts >= 5) {
        update(item.id, { state: "paused", attempts, error: msg });
      } else {
        update(item.id, { state: "retrying", attempts, error: msg });
        const delay = [2000, 4000, 8000, 16000, 30000][Math.min(attempts - 1, 4)];
        setTimeout(() => {
          const cur = queueRef.current.find((q) => q.id === item.id);
          if (cur && (cur.state === "retrying")) uploadOne({ ...cur });
        }, delay);
      }
    }
  }

  const drain = useCallback(() => {
    const items = queueRef.current;
    const uploading = items.filter((i) => i.state === "uploading").length;
    let slots = 3 - uploading;
    for (const it of items) {
      if (slots <= 0) break;
      if (it.state === "queued") { slots--; uploadOne({ ...it }); }
    }
  }, []);

  useEffect(() => { drain(); }, [queue.length, drain]);

  function onFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    const lim = event.config.limits;
    const next: QueueItem[] = [];
    for (const f of arr) {
      const isVideo = f.type.startsWith("video/");
      const maxMB = isVideo ? lim.maxVideoMB : lim.maxPhotoMB;
      if (f.size > maxMB * 1024 * 1024) {
        alert(`${f.name}: exceeds ${maxMB}MB limit`);
        continue;
      }
      next.push({ id: newId(), file: f, guestId: active?.id || null, state: "queued", progress: 0, attempts: 0 });
    }
    setQueue((q) => [...q, ...next]);
  }

  const summary = {
    done: queue.filter((q) => q.state === "done").length,
    uploading: queue.filter((q) => q.state === "uploading").length,
    retrying: queue.filter((q) => q.state === "retrying" || q.state === "paused").length,
  };

  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="text-sm text-muted-foreground">LAQTA · STAFF</div>
            <div className="text-lg font-bold">{event.name}</div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className={`inline-flex items-center gap-1 ${online ? "text-[color:var(--success)]" : "text-[color:var(--warning)]"}`}>
              <span className="inline-block h-2 w-2 rounded-full bg-current" /> {online ? "online" : "offline"}
            </span>
            <span className="text-muted-foreground">{summary.done} {pick(T.done, "en")} · {summary.uploading} {pick(T.uploading, "en")} · {summary.retrying} {pick(T.retrying, "en")}</span>
          </div>
        </div>
        {active ? (
          <div className="border-t border-primary/40 bg-primary px-4 py-2 text-center text-sm font-bold text-primary-foreground">
            {pick(T.uploadingFor, "en")}: {active.form_data.name || "—"} · <span className="code-display" dir="ltr">{active.code}</span>
            <button onClick={() => setActive(null)} className="ms-3 underline">clear</button>
          </div>
        ) : (
          <div className="border-t border-border bg-muted/50 px-4 py-2 text-center text-sm text-muted-foreground">
            {pick(T.unpaired, "en")} — pick a guest to pair uploads
          </div>
        )}
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-6 md:grid-cols-[1fr_2fr]">
        <section className="rounded-xl border border-border bg-card p-3">
          <h2 className="mb-3 text-sm font-bold text-muted-foreground">{pick(T.guests, "en")} ({guests.length})</h2>
          <ul className="max-h-[60vh] space-y-1 overflow-auto">
            {guests.map((g) => (
              <li key={g.id}>
                <button
                  onClick={() => setActive(g)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-start transition ${active?.id === g.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  <span className="truncate">
                    <span className="font-semibold">{g.form_data.name || "—"}</span>
                    <span className="ms-2 code-display text-xs opacity-75" dir="ltr">{g.code}</span>
                  </span>
                  <span className="text-xs opacity-70">{new Date(g.created_at).toLocaleTimeString()}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-4">
          <Dropzone onFiles={onFiles} />
          <div className="rounded-xl border border-border bg-card p-3">
            <h2 className="mb-3 text-sm font-bold text-muted-foreground">{pick(T.queue, "en")}</h2>
            {queue.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">—</p>
            ) : (
              <ul className="space-y-2">
                {queue.slice().reverse().map((it) => (
                  <li key={it.id} className="rounded-lg border border-border bg-background p-3">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-mono">{it.file.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{(it.file.size / 1024 / 1024).toFixed(1)} MB</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full transition-all ${it.state === "done" ? "bg-[color:var(--success)]" : it.state === "paused" ? "bg-destructive" : "bg-primary"}`} style={{ width: `${it.progress}%` }} />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {it.state === "done" && "✓ done"}
                        {it.state === "uploading" && `${it.progress}%`}
                        {it.state === "queued" && "queued"}
                        {it.state === "retrying" && `retrying (${it.attempts})…`}
                        {it.state === "paused" && `paused — ${it.error || "failed"}`}
                      </span>
                      {it.state === "paused" && (
                        <button onClick={() => { update(it.id, { state: "queued", attempts: 0 }); setTimeout(drain, 0); }}
                          className="rounded-full bg-primary px-3 py-0.5 font-semibold text-primary-foreground">{pick(T.retry, "en")}</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function Dropzone({ onFiles }: { onFiles: (f: FileList | File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); }}
      className={`block cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition ${over ? "border-primary bg-primary/10" : "border-border bg-card"}`}
    >
      <input ref={inputRef} type="file" multiple accept="image/*,video/*" className="hidden"
        onChange={(e) => e.target.files && onFiles(e.target.files)} />
      <div className="text-4xl">📷</div>
      <p className="mt-3 text-base font-semibold">{pick(T.dropFiles, "en")}</p>
      <p className="text-sm text-muted-foreground font-arabic">{pick(T.dropFiles, "ar")}</p>
    </label>
  );
}

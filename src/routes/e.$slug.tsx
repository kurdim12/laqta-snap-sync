import { createFileRoute, useParams, useChildMatches, Outlet } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_CONFIG, type EventConfig, type EventRow } from "@/lib/types";
import { T, pick, useLang } from "@/lib/i18n";
import { generateCode, newId } from "@/lib/code";
import { addOutbox, queueState, startSyncEngine, trySync } from "@/lib/outbox";
import { QrCode } from "@/components/QrCode";
import { resizeImage } from "@/lib/media";
import { getPublicEventBySlug } from "@/lib/gallery.functions";
import { FaceGuideCamera } from "@/components/FaceGuideCamera";

export const Route = createFileRoute("/e/$slug")({
  head: () => ({ meta: [{ title: "LAQTA · Register" }] }),
  component: GuestForm,
});

type LoadState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; event: EventRow };

import { applyEventTheme } from "@/lib/theme";

function GuestForm() {
  const { slug } = useParams({ from: "/e/$slug" });
  // /e/$slug/gallery is a CHILD of this route, so this component also renders
  // for the gallery. When a child route is active we must hand off to it via
  // <Outlet/> and skip the form/redirect logic below — otherwise the
  // registration:"none" redirect points back at the gallery and loops forever.
  const onChild = useChildMatches().length > 0;
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (onChild) return;
    let alive = true;
    let cleanupTheme: (() => void) | null = null;
    (async () => {
      const { event: data } = await getPublicEventBySlug({ data: { slug } }).catch(() => ({ event: null }));
      if (!alive) return;
      if (!data || !data.id || !data.slug || !data.name || (data.status !== "live" && data.status !== "dryrun")) {
        setState({ kind: "unavailable" });
        return;
      }
      const event: EventRow = {
        id: data.id,
        slug: data.slug,
        name: data.name,
        created_at: data.created_at ?? "",
        status: data.status as EventRow["status"],
        config: { ...DEFAULT_CONFIG, ...(data.config as Partial<EventConfig>) } as EventConfig,
        template_mode: (data.template_mode as EventRow["template_mode"]) ?? "none",
      };
      // If this event doesn't collect registrations, send guests straight to the public gallery
      if (event.config.registration === "none") {
        window.location.replace(`/e/${event.slug}/gallery`);
        return;
      }
      cleanupTheme = applyEventTheme(event.config.theme);
      setState({ kind: "ready", event });
    })();
    return () => { alive = false; if (cleanupTheme) cleanupTheme(); };
  }, [slug, onChild]);

  if (onChild) return <Outlet />;

  if (state.kind === "loading") {
    return <main className="grid min-h-screen place-items-center bg-background"><div className="text-muted-foreground">···</div></main>;
  }
  if (state.kind === "unavailable") {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-6 text-center">
        <div>
          <div className="code-display text-5xl text-primary">LAQTA</div>
          <p className="mt-6 text-lg text-muted-foreground font-arabic">هذه الفعالية غير متاحة</p>
          <p className="text-sm text-muted-foreground">This event is not available</p>
        </div>
      </main>
    );
  }
  return <ReadyForm event={state.event} />;
}

function ReadyForm({ event }: { event: EventRow }) {
  const config = event.config;
  const [lang, setLang, toggleable] = useLang(config.locale);
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [selfie, setSelfie] = useState<Blob | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<{ code: string } | null>(null);
  const [statusDot, setStatusDot] = useState<"green" | "amber">("green");
  const [bottomBar, setBottomBar] = useState<string | null>(null);
  const selfieMode = config.selfie ?? "optional";

  useEffect(() => {
    const stop = startSyncEngine();
    const i = setInterval(async () => {
      const q = await queueState();
      setStatusDot(q.pending > 0 ? "amber" : "green");
      if (q.pending > 0 && q.oldestAgeMs > 60_000) {
        const mins = Math.floor(q.oldestAgeMs / 60_000);
        setBottomBar(`${pick(T.lastSync, lang)} ${mins}${lang === "ar" ? " " : ""}${pick(T.minutes, lang)} — ${pick(T.dataSafe, lang)}`);
      } else {
        setBottomBar(null);
      }
    }, 2000);
    return () => { stop(); clearInterval(i); };
  }, [lang]);

  useEffect(() => {
    if (!selfie) { setSelfiePreview(null); return; }
    const url = URL.createObjectURL(selfie);
    setSelfiePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selfie]);

  async function onPickSelfie(file: File) {
    try {
      // create a temp File so resizeImage can read it
      const blob = await resizeImage(file, 800, 0.8);
      setSelfie(blob);
    } catch {
      setSelfie(file);
    }
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    for (const f of config.fields) {
      const v = (values[f.key] || "").trim();
      if (f.required && !v) { errs[f.key] = pick(T.required, lang); continue; }
      if (v && f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errs[f.key] = pick(T.invalidEmail, lang);
      if (v && f.type === "tel" && !/^[+0-9\s\-()]{6,}$/.test(v)) errs[f.key] = pick(T.invalidPhone, lang);
    }
    if (selfieMode === "required" && !selfie) {
      errs.__selfie = lang === "ar" ? "الرجاء التقاط صورة" : "Please take a selfie";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    const id = newId();
    const code = generateCode();
    await addOutbox({
      id, eventSlug: event.slug, eventId: event.id, code,
      payload: { form_data: values, consent, source: "primary" },
      selfie: selfie ?? null,
      selfieUploaded: !selfie,
      rowSynced: false,
      state: "queued", attempts: 0, createdAt: Date.now(), lastTriedAt: 0,
    });
    setSuccess({ code });
    setStatusDot("amber");
    trySync();
  }

  function reset() {
    setValues({}); setConsent(false); setSelfie(null); setErrors({}); setSuccess(null);
  }

  if (success) {
    const url = `${typeof window !== "undefined" ? window.location.origin : ""}/g/${success.code}`;
    return (
      <main className="relative min-h-screen bg-background px-6 py-10">
        <StatusDot color={statusDot} />
        <div className="mx-auto flex max-w-md flex-col items-center text-center">
          <CheckMark />
          <p className="mt-6 text-xl text-foreground">{pick(config.successMessage, lang)}</p>
          <div className="mt-8 text-sm uppercase tracking-widest text-muted-foreground">{pick(T.yourCode, lang)}</div>
          <div className="code-display mt-3 text-6xl text-primary md:text-7xl" dir="ltr">{success.code}</div>
          <QrCode value={url} size={240} alt="QR" className="mt-8 rounded-lg bg-white p-3" />
          <p className="mt-6 text-lg font-semibold text-primary">{pick(T.screenshot, lang)}</p>
          <p className="mt-2 text-xs text-muted-foreground" dir="ltr">{url}</p>
          <p className="mt-2 text-sm text-muted-foreground">{pick(T.galleryHint, lang)}</p>
          <button onClick={reset} className="mt-10 w-full rounded-xl bg-primary px-6 py-4 text-lg font-bold text-primary-foreground">
            {pick(T.next, lang)}
          </button>
        </div>
        {bottomBar && <BottomBar text={bottomBar} />}
      </main>
    );
  }

  return (
    <main className="relative min-h-screen bg-background px-6 py-8">
      <StatusDot color={statusDot} />
      {toggleable && (
        <button
          onClick={() => setLang(lang === "ar" ? "en" : "ar")}
          className="absolute end-4 top-4 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground"
        >
          {lang === "ar" ? "EN" : "ع"}
        </button>
      )}
      <div className="mx-auto max-w-md">
        {config.theme.logoUrl ? (
          <img src={config.theme.logoUrl} alt={event.name} className="mx-auto mt-4 h-16 object-contain" />
        ) : (
          <div className="mt-4 text-center text-3xl font-bold text-primary">{event.name}</div>
        )}
        <form onSubmit={onSubmit} className="mt-10 space-y-5">
          {selfieMode !== "off" && (
            <SelfieCapture
              guided={event.template_mode === "backdrop"}
              preview={selfiePreview}
              required={selfieMode === "required"}
              lang={lang}
              error={errors.__selfie}
              onPick={onPickSelfie}
              onClear={() => setSelfie(null)}
            />
          )}
          {config.fields.map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-sm font-semibold text-foreground">
                {pick(f.label, lang)}
                {f.required && <span className="ms-1 text-primary">*</span>}
              </label>
              <input
                type={f.type}
                value={values[f.key] || ""}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                dir={f.type === "tel" || f.type === "email" || f.type === "number" ? "ltr" : "auto"}
                className={`w-full rounded-xl border bg-input px-4 py-3 text-lg text-foreground outline-none transition focus:border-primary ${
                  f.type === "tel" || f.type === "email" || f.type === "number" ? "text-start" : ""
                } ${errors[f.key] ? "border-destructive" : "border-border"}`}
              />
              {errors[f.key] && <p className="mt-1 text-sm text-destructive">{errors[f.key]}</p>}
            </div>
          ))}
          <label className="flex items-start gap-3 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1 h-5 w-5 accent-[color:var(--primary)]"
            />
            <span>{pick(config.consentText, lang)}</span>
          </label>
          <button
            type="submit"
            className="w-full rounded-xl bg-primary px-6 py-4 text-lg font-bold text-primary-foreground transition active:scale-[0.98]"
          >
            {pick(T.submit, lang)}
          </button>
        </form>
      </div>
      {bottomBar && <BottomBar text={bottomBar} />}
    </main>
  );
}

function SelfieCapture({
  preview, required, lang, error, onPick, onClear, guided = false,
}: {
  preview: string | null;
  required: boolean;
  /** backdrop events: open the in-app camera with an oval face guide */
  guided?: boolean;
  lang: "ar" | "en";
  error?: string;
  onPick: (f: File) => void;
  onClear: () => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [camOpen, setCamOpen] = useState(false);
  const label = lang === "ar" ? "صورة شخصية" : "Selfie";
  const tap = guided
    ? (lang === "ar" ? "لوّح للكاميرا!" : "Wave at the camera!")
    : (lang === "ar" ? "اضغط لالتقاط صورة" : "Tap to take a selfie");
  const choose = lang === "ar" ? "اختر من المعرض" : "Choose from gallery";
  return (
    <div className="flex flex-col items-center">
      <label className="mb-2 block text-sm font-semibold text-foreground">
        {label}{required && <span className="ms-1 text-primary">*</span>}
      </label>
      <button
        type="button"
        onClick={() => (guided ? setCamOpen(true) : cameraRef.current?.click())}
        className={`relative grid h-32 w-32 place-items-center overflow-hidden rounded-full border-2 ${error ? "border-destructive" : "border-primary/40"} bg-card transition hover:border-primary`}
      >
        {preview ? (
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="text-center">
            <div className="text-3xl">📸</div>
            <div className="mt-1 px-2 text-[10px] leading-tight text-muted-foreground">{tap}</div>
          </div>
        )}
      </button>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }}
      />
      <div className="mt-2 flex gap-3 text-xs">
        <button type="button" onClick={() => galleryRef.current?.click()} className="text-muted-foreground underline">
          {choose}
        </button>
        {preview && (
          <button type="button" onClick={onClear} className="text-destructive underline">
            {lang === "ar" ? "حذف" : "Remove"}
          </button>
        )}
      </div>
      {guided && (
        <p className="mt-2 max-w-xs text-center text-[11px] leading-snug text-muted-foreground">
          👋 لوّح للكاميرا وضع رأسك وكتفيك داخل البيضاوي
          <span className="block">Wave at the camera — fit your head and shoulders in the oval</span>
        </p>
      )}
      {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
      {camOpen && (
        <FaceGuideCamera
          onClose={() => setCamOpen(false)}
          onCapture={(f) => { setCamOpen(false); onPick(f); }}
        />
      )}
    </div>
  );
}

function StatusDot({ color }: { color: "green" | "amber" }) {
  return (
    <span
      aria-hidden
      className={`absolute end-4 bottom-4 inline-block h-2 w-2 rounded-full ${color === "green" ? "bg-[color:var(--success)]" : "bg-[color:var(--warning)]"}`}
    />
  );
}
function BottomBar({ text }: { text: string }) {
  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-border bg-card/80 px-4 py-1 text-center text-xs text-muted-foreground backdrop-blur">
      {text}
    </div>
  );
}
function CheckMark() {
  return (
    <div className="grid h-24 w-24 place-items-center rounded-full bg-primary text-primary-foreground animate-in zoom-in duration-300">
      <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5L20 7" />
      </svg>
    </div>
  );
}

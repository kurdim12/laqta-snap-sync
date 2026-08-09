import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getPublicEventBySlug } from "@/lib/gallery.functions";
import { FaceGuideCamera } from "@/components/FaceGuideCamera";
import { SHIRT_VARIANTS, randomShirt, type ShirtVariant } from "@/lib/shirts";
import { addOutbox, trySync } from "@/lib/outbox";
import { generateCode, newId } from "@/lib/code";
import { resizeImage } from "@/lib/media";
import { backdropOf, renderBackdrop } from "@/lib/backdrop";

export const Route = createFileRoute("/k/$slug")({
  head: () => ({
    meta: [
      { title: "LAQTA · Take Your Shot" },
      { name: "description", content: "Kiosk capture: take a portrait, pick your LAQTA fit, and land on the live wall." },
      { property: "og:title", content: "LAQTA · Take Your Shot" },
      { property: "og:description", content: "Take a portrait, pick your fit, and land on the live wall." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Kiosk,
});

type Step = "start" | "name" | "capture" | "shirt" | "preview" | "done";

function Kiosk() {
  const { slug } = useParams({ from: "/k/$slug" });
  const [event, setEvent] = useState<{ id: string; slug: string; name: string; config: unknown } | null>(null);
  const [missing, setMissing] = useState(false);
  const [step, setStep] = useState<Step>("start");
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [shirt, setShirt] = useState<ShirtVariant>(SHIRT_VARIANTS[0]);
  const [busy, setBusy] = useState(false);
  const [styled, setStyled] = useState<Blob | null>(null);
  const [styledUrl, setStyledUrl] = useState<string | null>(null);
  const [styling, setStyling] = useState(false);
  const [styleErr, setStyleErr] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { event: ev } = await getPublicEventBySlug({ data: { slug } }).catch(() => ({ event: null }));
      if (!alive) return;
      if (!ev) { setMissing(true); return; }
      setEvent({ id: ev.id, slug: ev.slug, name: ev.name, config: ev.config });
    })();
    return () => { alive = false; };
  }, [slug]);

  useEffect(() => {
    if (!photo) { setPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    if (!styled) { setStyledUrl(null); return; }
    const url = URL.createObjectURL(styled);
    setStyledUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [styled]);

  // Render the real wall treatment (cutout + brand gradient) in the browser so
  // the preview shows exactly what lands on the wall. $0, no AI.
  async function buildStyled(source: Blob) {
    if (!event) return;
    setStyling(true);
    setStyleErr(false);
    setStyled(null);
    try {
      const out = await renderBackdrop(source, backdropOf(event.config), `${Date.now()}-${shirt.id}`);
      setStyled(out);
    } catch {
      setStyleErr(true);
    } finally {
      setStyling(false);
    }
  }

  async function onCapture(file: File) {
    const blob = await resizeImage(file, 2160, 0.94).catch(() => file as Blob);
    setPhoto(blob);
    setStep("shirt");
  }

  async function submit() {
    if (!event || !photo || busy) return;
    setBusy(true);
    const id = newId();
    const code = generateCode();
    await addOutbox({
      id, eventSlug: event.slug, eventId: event.id, code,
      payload: { form_data: { name: name.trim() || "Guest" }, consent: true, source: "kiosk" },
      selfie: photo,
      shirtVariant: shirt.id,
      selfieUploaded: false,
      rowSynced: false,
      state: "queued", attempts: 0, createdAt: Date.now(), lastTriedAt: 0,
    });
    trySync();
    setBusy(false);
    setStep("done");
  }

  function restart() {
    setName(""); setPhoto(null); setStyled(null); setStyleErr(false); setShirt(SHIRT_VARIANTS[0]); setStep("start");
  }

  if (missing) {
    return (
      <main className="grid min-h-screen place-items-center bg-black text-center text-white">
        <div>
          <div className="text-5xl font-black tracking-[0.35em]">LAQTA</div>
          <p className="mt-4 text-white/50">This experience is not available</p>
        </div>
      </main>
    );
  }

  if (step === "capture") {
    return <FaceGuideCamera onCapture={onCapture} onClose={() => setStep("name")} />;
  }

  return (
    <main className="relative min-h-screen bg-black text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(70% 50% at 50% 0%, rgba(56,189,248,0.14), transparent 70%)" }}
      />
      <div className="relative mx-auto flex min-h-screen max-w-xl flex-col px-6 py-10">
        <header className="mb-8 flex items-center justify-between">
          <span className="text-lg font-black uppercase tracking-[0.4em]">LAQTA</span>
          <span className="truncate text-xs font-semibold uppercase tracking-[0.25em] text-white/35">{event?.name}</span>
        </header>

        {step === "start" && (
          <section key={step} className="rise-in flex flex-1 flex-col justify-center">
            <h1 className="text-[clamp(2.5rem,9vw,4.5rem)] font-black uppercase leading-[0.9] tracking-tight">
              Take your<br />shot
            </h1>
            <p className="mt-5 max-w-sm text-white/55">
              Your portrait goes live on the wall in seconds. Pick your fit, strike a pose, wave at the camera.
            </p>
            <button
              onClick={() => setStep("name")}
              className="mt-10 rounded-full bg-white px-8 py-5 text-lg font-black uppercase tracking-widest text-black transition hover:-translate-y-0.5 hover:opacity-90 hover:shadow-[0_12px_40px_-12px_rgba(255,255,255,0.45)]"
            >
              Start
            </button>
          </section>
        )}

        {step === "name" && (
          <section key={step} className="rise-in flex flex-1 flex-col justify-center">
            <h2 className="text-3xl font-black uppercase tracking-tight">Your name</h2>
            <p className="mt-2 text-sm text-white/45">Optional — it stays with your portrait.</p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nickname"
              className="mt-6 w-full rounded-2xl border border-white/15 bg-white/5 px-5 py-5 text-xl text-white outline-none placeholder:text-white/25 focus:border-white/40"
            />
            <button
              onClick={() => setStep("capture")}
              className="mt-8 rounded-full bg-white px-8 py-5 text-lg font-black uppercase tracking-widest text-black transition hover:-translate-y-0.5 hover:opacity-90 hover:shadow-[0_12px_40px_-12px_rgba(255,255,255,0.45)]"
            >
              Take photo
            </button>
            <label className="mt-3 cursor-pointer rounded-full border border-white/20 px-8 py-4 text-center text-sm font-bold uppercase tracking-widest text-white/70">
              Upload instead
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onCapture(f); }}
              />
            </label>
          </section>
        )}

        {step === "shirt" && (
          <section key={step} className="rise-in flex flex-1 flex-col justify-center">
            <h2 className="text-3xl font-black uppercase tracking-tight">Pick your fit</h2>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {SHIRT_VARIANTS.filter((s) => s.active).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setShirt(s)}
                  className={`overflow-hidden rounded-2xl border p-2 transition ${shirt.id === s.id ? "border-white bg-white/10" : "border-white/15 hover:-translate-y-0.5 hover:border-white/40"}`}
                >
                  <img src={s.imageUrl} alt={`${s.name} LYNK & CO shirt`} className="aspect-[3/4] w-full rounded-lg object-cover" />
                  <span className="mt-2 block text-xs font-bold uppercase tracking-widest text-white/70">{s.name}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShirt(randomShirt())}
              className="mt-4 self-start text-xs font-bold uppercase tracking-widest text-white/45 underline underline-offset-4"
            >
              Surprise me
            </button>
            <button
              onClick={() => { setStep("preview"); if (photo) void buildStyled(photo); }}
              className="mt-8 rounded-full bg-white px-8 py-5 text-lg font-black uppercase tracking-widest text-black transition hover:-translate-y-0.5 hover:opacity-90 hover:shadow-[0_12px_40px_-12px_rgba(255,255,255,0.45)]"
            >
              Preview
            </button>
          </section>
        )}

        {step === "preview" && (
          <section key={step} className="rise-in flex flex-1 flex-col justify-center">
            <h2 className="text-3xl font-black uppercase tracking-tight">Looking good?</h2>
            <div className="mt-6 overflow-hidden rounded-3xl bg-white/5 ring-1 ring-white/15">
              <div className="relative aspect-[4/5] w-full bg-black">
                {(styledUrl || preview) && (
                  <img
                    src={styledUrl || preview!}
                    alt="Your portrait"
                    className={`h-full w-full ${styledUrl ? "object-cover" : "object-contain"}`}
                  />
                )}
                {styling && (
                  <div className="absolute inset-0 grid place-items-center bg-black/65 text-center">
                    <div>
                      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                      <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.3em] text-white/70">
                        Styling your shot
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/12 bg-white/5 p-3">
              <img
                src={shirt.imageUrl}
                alt={`${shirt.name} LYNK & CO shirt`}
                className="h-14 w-14 rounded-xl object-cover"
              />
              <div className="min-w-0">
                <p className="text-sm font-black uppercase tracking-widest">{shirt.name} fit</p>
                <p className="truncate text-xs text-white/45">
                  {styleErr ? "Preview unavailable — your shot still goes on the wall" : styled ? "Wall treatment applied" : "Applied when your portrait is processed"}
                </p>
              </div>
              <button
                onClick={() => { setStyled(null); setStep("shirt"); }}
                className="ms-auto shrink-0 rounded-full border border-white/25 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-white/70 transition hover:border-white/50"
              >
                Change
              </button>
            </div>
            <button
              disabled={busy}
              onClick={submit}
              className="mt-8 rounded-full bg-white px-8 py-5 text-lg font-black uppercase tracking-widest text-black transition hover:-translate-y-0.5 hover:opacity-90 hover:shadow-[0_12px_40px_-12px_rgba(255,255,255,0.45)] disabled:translate-y-0 disabled:opacity-50"
            >
              {busy ? "Sending…" : "Put me on the wall"}
            </button>
            <button onClick={() => setStep("capture")} className="mt-3 text-xs font-bold uppercase tracking-widest text-white/45">
              Retake
            </button>
          </section>
        )}

        {step === "done" && (
          <section className="flex flex-1 flex-col justify-center text-center">
            <div className="text-[clamp(2.5rem,9vw,4rem)] font-black uppercase leading-[0.9]">You're on<br />the wall</div>
            <p className="mt-5 text-white/55">Your portrait appears once it clears approval. Look up.</p>
            <button
              onClick={restart}
              className="mx-auto mt-10 rounded-full border border-white/25 px-8 py-4 text-sm font-bold uppercase tracking-widest text-white/80"
            >
              Next guest
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaceGuideCamera } from "@/components/FaceGuideCamera";
import {
  getVogueEvent,
  mintVogueUpload,
  registerVogueCover,
  getVogueCover,
  publishVogueCover,
  MAX_SESSION_ATTEMPTS,
  type VogueEventInfo,
} from "@/lib/vogue.functions";
import { resizeImage } from "@/lib/media";

export const Route = createFileRoute("/event/$slug/")({
  head: () => ({
    meta: [
      { title: "LYNK & CO 900 — Vogue Cover Experience" },
      {
        name: "description",
        content:
          "Step in front of the LYNK & CO 900 and walk away with your own luxury magazine cover portrait, generated on the spot.",
      },
      { property: "og:title", content: "LYNK & CO 900 — Vogue Cover Experience" },
      {
        property: "og:description",
        content: "Your own luxury magazine cover portrait with the LYNK & CO 900, generated on the spot.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VogueExperience,
});

const SESSION_KEY = "laqta-vogue-session";

function sessionIdFor(slug: string): string {
  const key = `${SESSION_KEY}:${slug}`;
  let v = "";
  try {
    v = localStorage.getItem(key) || "";
  } catch {
    /* private mode */
  }
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(v)) {
    v = crypto.randomUUID().replace(/-/g, "");
    try {
      localStorage.setItem(key, v);
    } catch {
      /* ignore */
    }
  }
  return v;
}

type Step = "intro" | "capture" | "review" | "working" | "result";

function VogueExperience() {
  const { slug } = useParams({ from: "/event/$slug/" });
  const [event, setEvent] = useState<VogueEventInfo | null | "loading">("loading");
  const [session, setSession] = useState("");
  const [step, setStep] = useState<Step>("intro");
  const [shot, setShot] = useState<{ file: File; preview: string } | null>(null);
  const [consent, setConsent] = useState(true);
  const [attemptsUsed, setAttemptsUsed] = useState(0);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [onWall, setOnWall] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    setSession(sessionIdFor(slug));
    getVogueEvent({ data: { slug } })
      .then((e) => setEvent(e))
      .catch(() => setEvent(null));
  }, [slug]);

  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);

  const startPolling = useCallback(
    (id: string, sid: string) => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      const started = Date.now();
      pollRef.current = window.setInterval(async () => {
        try {
          const s = await getVogueCover({ data: { assetId: id, sessionId: sid } });
          if (s.status === "done" && s.url) {
            if (pollRef.current) window.clearInterval(pollRef.current);
            setCover(s.url);
            setStep("result");
          } else if (s.status === "failed") {
            if (pollRef.current) window.clearInterval(pollRef.current);
            setErr(s.error || "The cover could not be generated.");
            setStep("review");
          } else if (Date.now() - started > 180_000) {
            if (pollRef.current) window.clearInterval(pollRef.current);
            setErr("This is taking longer than expected. Please try again.");
            setStep("review");
          }
        } catch {
          /* transient — keep polling */
        }
      }, 3000);
    },
    [],
  );

  async function submit() {
    if (!shot || !session) return;
    setErr(null);
    setStep("working");
    try {
      const blob = await resizeImage(shot.file, 1536, 0.92);
      const minted = await mintVogueUpload({
        data: { slug, sessionId: session, contentType: "image/jpeg", bytes: blob.size },
      });
      const put = await fetch(minted.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg", "x-upsert": "true" },
        body: blob,
      });
      if (!put.ok) throw new Error("Upload failed — check your connection.");

      const reg = await registerVogueCover({
        data: { slug, sessionId: session, storagePath: minted.path, bytes: blob.size, consent },
      });
      setAssetId(reg.assetId);
      setAttemptsUsed(reg.attemptsUsed);
      setOnWall(false);

      await fetch("/api/public/process-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: reg.assetId, sessionId: session }),
      });
      startPolling(reg.assetId, session);
    } catch (e) {
      setErr((e as Error).message || "Something went wrong.");
      setStep("review");
    }
  }

  async function toggleWall(next: boolean) {
    if (!assetId || !session) return;
    setOnWall(next);
    try {
      await publishVogueCover({ data: { assetId, sessionId: session, publish: next } });
    } catch (e) {
      setOnWall(!next);
      setErr((e as Error).message);
    }
  }

  function retake() {
    setErr(null);
    setCover(null);
    setAssetId(null);
    if (shot) URL.revokeObjectURL(shot.preview);
    setShot(null);
    setStep("capture");
  }

  const attemptsLeft = Math.max(0, MAX_SESSION_ATTEMPTS - attemptsUsed);

  return (
    <main className="min-h-dvh bg-[#0B0B0C] text-[#F5F1E8]">
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-5 py-8">
        <header className="mb-8 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-[#C9A227]">LYNK &amp; CO 900</p>
          <h1 className="mt-3 font-display text-4xl leading-none tracking-tight sm:text-5xl">VOGUE EXPERIENCE</h1>
          <p className="mt-3 text-sm text-[#F5F1E8]/60">
            Your own editorial cover, shot on location with the 900.
            <span className="mt-1 block font-arabic" dir="rtl">غلاف مجلة خاص بك مع لينك آند كو ٩٠٠</span>
          </p>
        </header>

        {event === "loading" && <p className="text-center text-sm text-[#F5F1E8]/50">Loading…</p>}
        {event === null && <p className="text-center text-sm text-[#F5F1E8]/60">This experience isn’t available.</p>}

        {event && event !== "loading" && !event.open && (
          <p className="rounded-2xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-5 text-center text-sm">
            The experience isn’t open yet. Please come back shortly.
          </p>
        )}

        {event && event !== "loading" && event.open && !event.ready && (
          <p className="rounded-2xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-5 text-center text-sm">
            We’re still setting up this station. Please ask a host.
          </p>
        )}

        {event && event !== "loading" && event.open && event.ready && (
          <div className="flex-1">
            {step === "intro" && (
              <div className="space-y-6">
                <ol className="space-y-3 text-sm text-[#F5F1E8]/70">
                  <li><span className="me-2 text-[#C9A227]">01</span> Take one portrait inside the guide.</li>
                  <li><span className="me-2 text-[#C9A227]">02</span> We compose your cover with the 900.</li>
                  <li><span className="me-2 text-[#C9A227]">03</span> Save it, or send it to the wall.</li>
                </ol>
                <button
                  onClick={() => setStep("capture")}
                  className="w-full rounded-full bg-[#C9A227] py-4 text-sm font-bold uppercase tracking-[0.2em] text-black"
                >
                  Start · ابدأ
                </button>
              </div>
            )}

            {step === "capture" && (
              <FaceGuideCamera
                facing="user"
                onClose={() => setStep("intro")}
                onCapture={(file) => {
                  setShot({ file, preview: URL.createObjectURL(file) });
                  setStep("review");
                }}
              />
            )}

            {step === "review" && shot && (
              <div className="space-y-5">
                <div className="overflow-hidden rounded-2xl border border-[#F5F1E8]/10">
                  <img src={shot.preview} alt="Your portrait" className="aspect-[2/3] w-full object-cover" />
                </div>
                <label className="flex items-start gap-3 text-sm text-[#F5F1E8]/75">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 h-5 w-5 accent-[#C9A227]"
                  />
                  <span>
                    Show my cover on the event wall.
                    <span className="block font-arabic" dir="rtl">أوافق على عرض صورتي على شاشة الفعالية</span>
                  </span>
                </label>
                {err && <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">{err}</p>}
                <div className="flex gap-3">
                  <button onClick={retake} className="flex-1 rounded-full border border-[#F5F1E8]/25 py-4 text-sm font-semibold">
                    Retake
                  </button>
                  <button
                    onClick={submit}
                    disabled={attemptsUsed >= MAX_SESSION_ATTEMPTS}
                    className="flex-[2] rounded-full bg-[#C9A227] py-4 text-sm font-bold uppercase tracking-[0.2em] text-black disabled:opacity-40"
                  >
                    {attemptsUsed >= MAX_SESSION_ATTEMPTS ? "No tries left" : "Create my cover"}
                  </button>
                </div>
                {attemptsUsed > 0 && (
                  <p className="text-center text-[11px] text-[#F5F1E8]/45">{attemptsLeft} of {MAX_SESSION_ATTEMPTS} tries left</p>
                )}
              </div>
            )}

            {step === "working" && (
              <div className="grid place-items-center gap-4 py-20 text-center">
                <div className="h-12 w-12 animate-spin rounded-full border-2 border-[#C9A227] border-t-transparent" />
                <p className="text-sm text-[#F5F1E8]/70">
                  Styling your cover…
                  <span className="block font-arabic" dir="rtl">جاري تجهيز غلافك…</span>
                </p>
              </div>
            )}

            {step === "result" && cover && (
              <div className="space-y-5">
                <div className="overflow-hidden rounded-2xl border border-[#C9A227]/40 shadow-[0_30px_80px_-30px_rgba(201,162,39,0.5)]">
                  <img src={cover} alt="Your Vogue-style cover" className="aspect-[2/3] w-full object-cover" />
                </div>
                <div className="flex gap-3">
                  <a
                    href={cover}
                    download="lynkco-900-cover.jpg"
                    className="flex-1 rounded-full bg-[#C9A227] py-4 text-center text-sm font-bold uppercase tracking-[0.2em] text-black"
                  >
                    Save
                  </a>
                  <button
                    onClick={() => toggleWall(!onWall)}
                    className={`flex-1 rounded-full border py-4 text-sm font-semibold ${onWall ? "border-[#C9A227] text-[#C9A227]" : "border-[#F5F1E8]/25"}`}
                  >
                    {onWall ? "On the wall ✓" : "Send to wall"}
                  </button>
                </div>
                {attemptsLeft > 0 && (
                  <button onClick={retake} className="w-full text-center text-xs uppercase tracking-[0.2em] text-[#F5F1E8]/50">
                    Try again · {attemptsLeft} left
                  </button>
                )}
                {err && <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">{err}</p>}
              </div>
            )}
          </div>
        )}

        <footer className="mt-10 text-center text-[11px] uppercase tracking-[0.3em] text-[#F5F1E8]/30">
          <Link to="/event/$slug/wall" params={{ slug }}>View the wall</Link>
        </footer>
      </div>
    </main>
  );
}

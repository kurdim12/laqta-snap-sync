import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LAQTA · لقطة — Event Photos & Videos" },
      {
        name: "description",
        content: "Find your event photos & videos. Enter your code or pick an event.",
      },
      { property: "og:title", content: "LAQTA · لقطة" },
      { property: "og:description", content: "Premium event photo & video delivery." },
    ],
  }),
  component: Landing,
});

type LiveEvent = { slug: string; name: string };

function Landing() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("events_public")
        .select("slug,name,status")
        .in("status", ["live", "dryrun"])
        .order("created_at", { ascending: false });
      setEvents(
        (data ?? [])
          .filter(
            (e): e is { slug: string; name: string; status: string | null } => !!e.slug && !!e.name,
          )
          .map((e) => ({ slug: e.slug, name: e.name })),
      );
    })();
  }, []);

  const onSubmitCode = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(c)) {
      setErr("Enter a valid gallery code");
      return;
    }
    setErr(null);
    navigate({ to: "/g/$code", params: { code: c } });
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* ambient gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, color-mix(in oklab, var(--primary) 25%, transparent), transparent 70%)",
        }}
      />

      <section className="relative mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="code-display text-6xl tracking-tight text-primary md:text-7xl">LAQTA</div>
        <div className="mt-2 font-arabic text-3xl text-muted-foreground">لقطة</div>
        <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Find your event photos & videos. Enter the code you received, or pick your event below.
          <br />
          <span className="font-arabic">أدخل رمز معرضك أو اختر فعاليتك بالأسفل</span>
        </p>

        {/* Gallery code entry */}
        <form
          onSubmit={onSubmitCode}
          className="mt-10 w-full rounded-2xl border border-border bg-card p-5 text-start shadow-[0_10px_40px_-20px_color-mix(in_oklab,var(--primary)_40%,transparent)]"
        >
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Gallery code
          </label>
          <div className="mt-2 flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={8}
              className="code-display flex-1 rounded-lg border border-border bg-background px-4 py-3 text-2xl tracking-[0.3em] text-foreground outline-none focus:border-primary"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className="rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              Open
            </button>
          </div>
          {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
        </form>

        {/* Events list */}
        <div className="mt-8 w-full">
          <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
            <span>Live events</span>
            <span className="font-arabic">الفعاليات</span>
          </div>
          {events.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-6 text-sm text-muted-foreground">
              No live events right now.
            </div>
          ) : (
            <ul className="grid gap-2">
              {events.map((ev) => (
                <li key={ev.slug}>
                  <Link
                    to="/e/$slug"
                    params={{ slug: ev.slug }}
                    className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-start transition hover:border-primary"
                  >
                    <span className="text-sm font-semibold text-foreground">{ev.name}</span>
                    <span className="code-display text-xs text-primary">/{ev.slug}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-12 text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60">
          LAQTA · Event Media Delivery
        </p>
      </section>
    </main>
  );
}

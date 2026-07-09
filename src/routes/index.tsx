import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LAQTA · لقطة — Event Photos & Videos" },
      { name: "description", content: "Find your event photos & videos. Enter your code or pick your event." },
      { property: "og:title", content: "LAQTA · لقطة" },
      { property: "og:description", content: "Premium event photo & video delivery." },
    ],
  }),
  component: Landing,
});

type LiveEvent = { slug: string; name: string; status: string | null };

function Landing() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("events_public")
        .select("slug,name,status")
        .in("status", ["live", "dryrun"])
        .order("created_at", { ascending: false });
      const rows = (data ?? []).filter(
        (e): e is { slug: string; name: string; status: string | null } => !!e.slug && !!e.name,
      );
      setEvents(rows);
      setLoading(false);
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

  const featured = events[0];
  const rest = events.slice(1);
  const issue = String(events.length || 1).padStart(3, "0");

  return (
    <main className="min-h-screen bg-[color:var(--paper-2)] px-3 py-4 sm:px-6 sm:py-10">
      <div
        className="mx-auto flex w-full max-w-[480px] flex-col overflow-hidden bg-[color:var(--paper)] text-[color:var(--ink)]"
        style={{ boxShadow: "var(--shadow-elegant)" }}
      >
        {/* Masthead */}
        <header className="flex items-end justify-between border-b hairline px-6 pb-4 pt-8">
          <div className="flex flex-col">
            <span className="font-display text-4xl leading-none tracking-tight text-[color:var(--ink-deep)]">
              LAQTA
            </span>
            <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-[color:var(--ink)]/60">
              Visual Delivery
            </span>
          </div>
          <span className="font-arabic text-3xl leading-none text-[color:var(--ink-deep)]/90">لقطة</span>
        </header>

        <div className="flex flex-col gap-10 p-6">
          {/* Gallery code entry */}
          <section>
            <form onSubmit={onSubmitCode} className="relative">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ENTER ACCESS CODE"
                maxLength={8}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Gallery code"
                className="w-full border-b-2 border-[color:var(--ink)] bg-transparent px-1 py-3 pr-10 font-display text-2xl tracking-[0.25em] text-[color:var(--ink-deep)] placeholder:text-[color:var(--ink)]/25 focus:border-[color:var(--ink-deep)] focus:outline-none"
              />
              <button
                type="submit"
                aria-label="Open gallery"
                className="absolute right-0 bottom-3 grid h-7 w-7 place-items-center text-[color:var(--ink-deep)] transition-transform hover:translate-x-1"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </form>
            <p className="mt-3 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-[color:var(--ink)]/40">
              <span>Private Archive Access</span>
              <span className="font-arabic">وصول خاص</span>
            </p>
            {err && <p className="mt-2 text-xs font-semibold text-[color:var(--destructive)]">{err}</p>}
          </section>

          {/* Featured event — cover story */}
          <section aria-labelledby="cover-heading">
            {loading ? (
              <div className="aspect-[3/4] w-full shimmer" />
            ) : featured ? (
              <Link
                to="/e/$slug"
                params={{ slug: featured.slug }}
                className="group relative block"
              >
                <div className="relative aspect-[3/4] w-full overflow-hidden bg-[color:var(--paper-2)]">
                  <div
                    aria-hidden
                    className="absolute inset-0 opacity-90 transition-transform duration-700 group-hover:scale-[1.03]"
                    style={{ background: "linear-gradient(135deg, #2d2d2d 0%, #4a4a4a 40%, #1a1a1a 100%)" }}
                  />
                  <div
                    aria-hidden
                    className="absolute inset-0 opacity-30 mix-blend-overlay"
                    style={{
                      backgroundImage:
                        "radial-gradient(1px 1px at 20% 30%, white, transparent), radial-gradient(1px 1px at 70% 60%, white, transparent), radial-gradient(1px 1px at 40% 80%, white, transparent)",
                      backgroundSize: "80px 80px, 120px 120px, 60px 60px",
                    }}
                  />
                  <div aria-hidden className="absolute inset-0" style={{ background: "var(--gradient-hero)" }} />
                  <div className="absolute inset-x-6 bottom-6">
                    <span className="mb-3 inline-block bg-[color:var(--paper)] px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[color:var(--ink-deep)]">
                      {featured.status === "live" ? "Live Issue" : "Dry Run"}
                    </span>
                    <h2
                      id="cover-heading"
                      className="font-display text-5xl uppercase leading-[0.85] tracking-tight text-white"
                    >
                      {featured.name}
                    </h2>
                  </div>
                </div>
                <div className="mt-4 flex items-start justify-between">
                  <p className="max-w-[70%] text-sm font-medium italic leading-tight text-[color:var(--ink)]">
                    Captured by the official production team. Available for instant download.
                  </p>
                  <div className="flex flex-col items-end">
                    <span className="font-display text-xl text-[color:var(--ink-deep)]">VOL. {issue}</span>
                    <span className="code-display text-[9px] uppercase tracking-tighter text-[color:var(--ink)]/50">
                      /{featured.slug}
                    </span>
                  </div>
                </div>
              </Link>
            ) : (
              <div className="border hairline px-4 py-10 text-center text-sm text-[color:var(--ink)]/60">
                No live events right now.
                <br />
                <span className="font-arabic">لا توجد فعاليات مباشرة الآن.</span>
              </div>
            )}
          </section>

          {/* Latest issues */}
          {rest.length > 0 && (
            <section>
              <div className="mb-6 flex items-center gap-4">
                <h3 className="font-display text-2xl uppercase tracking-wide text-[color:var(--ink-deep)]">
                  Latest Issues
                </h3>
                <div className="h-px flex-1 bg-[color:var(--paper-2)]" />
                <span className="font-arabic text-sm text-[color:var(--ink)]/60">الأعداد</span>
              </div>
              <ul className="grid grid-cols-2 gap-x-6 gap-y-6">
                {rest.map((ev, i) => (
                  <li key={ev.slug}>
                    <Link to="/e/$slug" params={{ slug: ev.slug }} className="group block space-y-3">
                      <div
                        className="aspect-square overflow-hidden bg-[color:var(--paper-2)]"
                        style={{
                          background:
                            i % 2 === 0
                              ? "linear-gradient(160deg, #e8e4dd, #2d2d2d)"
                              : "linear-gradient(200deg, #2d2d2d, #e8e4dd)",
                        }}
                      />
                      <div>
                        <p className="font-display text-lg uppercase leading-tight text-[color:var(--ink-deep)] group-hover:underline">
                          {ev.name}
                        </p>
                        <p className="code-display text-[10px] uppercase text-[color:var(--ink)]/60">
                          /{ev.slug}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* How it works cue */}
          <section className="border-t-2 border-[color:var(--ink-deep)] pb-4 pt-8">
            <div className="group flex items-center justify-between">
              <div className="space-y-1">
                <h4 className="font-display text-2xl uppercase text-[color:var(--ink-deep)]">How LAQTA Works</h4>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[color:var(--ink)]/60">
                  Find code · Scan face · Get visuals
                </p>
                <p className="font-arabic text-xs text-[color:var(--ink)]/60">
                  أدخل الرمز · التقط · شارك
                </p>
              </div>
              <div className="grid h-12 w-12 place-items-center rounded-full border border-[color:var(--ink)] transition-all duration-300 group-hover:bg-[color:var(--ink-deep)] group-hover:text-[color:var(--paper)]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12l7 7 7-7" />
                </svg>
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer className="-mx-6 -mb-6 border-t hairline bg-[color:var(--paper-2)] px-6 py-6">
            <div className="flex items-start justify-between text-[9px] font-bold uppercase tracking-[0.2em] text-[color:var(--ink)]/50">
              <span>© LAQTA Archive {new Date().getFullYear()}</span>
              <span className="font-arabic">جميع الحقوق محفوظة</span>
            </div>
          </footer>
        </div>
      </div>
    </main>
  );
}

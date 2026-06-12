import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LAQTA · لقطة" },
      { name: "description", content: "Premium event photo & video delivery." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <div>
        <div className="code-display text-6xl text-primary md:text-8xl">LAQTA</div>
        <div className="mt-3 font-arabic text-2xl text-muted-foreground">لقطة</div>
        <p className="mt-6 max-w-sm text-sm text-muted-foreground">
          Premium event photo &amp; video delivery platform. Guest · Staff · Admin.
        </p>
      </div>

      <nav className="mt-10 grid w-full max-w-sm gap-3">
        <Link
          to="/admin"
          className="rounded-xl border border-border bg-card px-6 py-4 text-lg font-semibold text-foreground transition hover:border-primary hover:text-primary"
        >
          Admin Panel
        </Link>
        <div className="rounded-xl border border-border bg-card px-6 py-4 text-left">
          <div className="text-sm font-semibold text-foreground">Guest Form</div>
          <div className="mt-1 text-xs text-muted-foreground">
            <code className="rounded bg-muted px-1 py-0.5">/e/{

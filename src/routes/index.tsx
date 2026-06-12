import { createFileRoute } from "@tanstack/react-router";

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
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="text-center">
        <div className="code-display text-6xl text-primary md:text-8xl">LAQTA</div>
        <div className="mt-3 font-arabic text-2xl text-muted-foreground">لقطة</div>
      </div>
    </main>
  );
}

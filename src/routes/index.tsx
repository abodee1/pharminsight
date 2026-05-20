import { createFileRoute, Link } from "@tanstack/react-router";
import { Trophy, BarChart2, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "PharmIQ — NHS pharmacy analytics & smart insights" },
      {
        name: "description",
        content:
          "Benchmark your pharmacy, understand your performance, and unlock insights from open NHS data — in seconds.",
      },
    ],
  }),
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight text-primary">PharmIQ</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="text-sm font-medium text-foreground hover:text-primary"
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="py-24 text-center">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-foreground">
            Pharmacy analytics,{" "}
            <span className="text-gold">made simple.</span>
          </h1>
          <div className="mt-10 flex items-center justify-center gap-3">
            <Link
              to="/register"
              className="rounded-md bg-primary text-primary-foreground px-6 py-3 text-sm font-semibold hover:opacity-90"
            >
              Get Started Free
            </Link>
            <Link
              to="/login"
              className="rounded-md border border-border bg-card px-6 py-3 text-sm font-semibold hover:bg-secondary"
            >
              Sign In
            </Link>
          </div>
        </section>

        <section className="grid md:grid-cols-3 gap-6 pb-24">
          {[
            {
              icon: Trophy,
              title: "Leaderboards",
              body: "See where your pharmacy ranks nationally and locally across items, NMS, Pharmacy First, flu and EPS.",
            },
            {
              icon: BarChart2,
              title: "Benchmarking",
              body: "Compare yourself against the local average, national average, and top 10% — with a gap analysis in plain English.",
            },
            {
              icon: Sparkles,
              title: "Smart Insights",
              body: "Generate SWOT analyses, performance commentary, and acquisition assessments grounded in your real NHS data.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-lg bg-card border border-border p-6 shadow-sm"
            >
              <div className="h-10 w-10 rounded-md bg-secondary flex items-center justify-center text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-foreground">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-muted-foreground">
          NHS data sourced from NHSBSA, Public Health Scotland, NHS Wales, and HSC Business
          Services Organisation under the Open Government Licence v3.0.
        </div>
      </footer>
    </div>
  );
}

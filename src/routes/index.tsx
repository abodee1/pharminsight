import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, BarChart2, Map, TrendingUp, Pill, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "PharmInsight — UK pharmacy data" },
      { name: "description", content: "Monthly NHS dispensing data, benchmarking and Companies House intelligence for every UK community pharmacy." },
      { property: "og:title", content: "PharmInsight" },
      { property: "og:description", content: "Monthly NHS dispensing data and benchmarking for UK community pharmacy." },
      { property: "og:url", content: "https://pharmacy8.com/" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://pharmacy8.com/" }],
  }),
});

type LeaderRow = { ods: string; name: string; region: string | null; country: string | null; value: number };
type TrendRow = { year: number; month: number; items: number; eps: number; pf: number; nms: number };
type CountryRow = { country: string; value: number; pf: number; nms: number; pharmacies: number };
type RegionRow = { region: string; country: string; value: number; pharmacies: number };
type Dashboard = {
  period: { year: number; month: number } | null;
  totals_now: { items: number; pf: number; nms: number; eps: number; pharmacies: number };
  top_items: LeaderRow[];
  top_pf: LeaderRow[];
  top_nms: LeaderRow[];
  top_eps: LeaderRow[];
  totals_trend: TrendRow[];
  top_regions: RegionRow[];
  by_country: CountryRow[];
};

const fmt = (n: number) => n.toLocaleString("en-GB");
const fmtCompact = (n: number) => {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "bn";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "m";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "k";
  return String(n);
};
const monthName = (y: number, m: number) =>
  new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" });
const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bUk\b/g, "UK").replace(/\bNhs\b/g, "NHS");

function Landing() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.rpc("public_landing_data");
      if (!alive) return;
      if (error) setError(error.message);
      else setData(data as unknown as Dashboard);
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <Hero data={data} />
      <SocialProof />
      <Features />
      <Boards data={data} error={error} />
      <CTA />
      <Footer />
    </div>
  );
}

function Header() {
  const { user, loading } = useAuth();
  return (
    <header className="sticky top-0 z-30 bg-background/85 backdrop-blur border-b border-border">
      <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Pill className="h-3.5 w-3.5" />
          </span>
          <span className="font-semibold tracking-tight">PharmInsight</span>
        </Link>
        <div className="flex items-center gap-2">
          {loading ? null : user ? (
            <Button asChild size="sm"><Link to="/dashboard">Dashboard</Link></Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm"><Link to="/login">Sign in</Link></Button>
              <Button asChild size="sm"><Link to="/register">Get started</Link></Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Hero({ data }: { data: Dashboard | null }) {
  const period = data?.period;
  const t = data?.totals_now;

  const stats = [
    { label: "Pharmacies tracked", value: t ? fmt(t.pharmacies) : "—" },
    { label: "Items dispensed", value: t ? fmtCompact(t.items) : "—" },
    { label: "Pharmacy First consultations", value: t ? fmtCompact(t.pf) : "—" },
  ];

  return (
    <section className="mx-auto max-w-5xl px-6 pt-24 pb-20 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {period ? `Data through ${monthName(period.year, period.month)}` : "Latest data"}
      </p>

      <h1 className="mt-5 text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.04]">
        Every UK pharmacy.<br />Every month.<br />One platform.
      </h1>

      <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
        NHS dispensing data, benchmarking, and competitive intelligence for pharmacy owners, buyers, and prescribers — updated monthly from official sources across all four nations.
      </p>

      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Button asChild size="lg" className="w-full sm:w-auto px-8">
          <Link to="/register">Get started free <ArrowRight className="h-4 w-4 ml-2" /></Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="w-full sm:w-auto px-8">
          <Link to="/leaderboards">Explore data</Link>
        </Button>
      </div>

      <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border border border-border rounded-xl bg-card shadow-sm overflow-hidden">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col items-center px-8 py-8">
            <span className="text-4xl font-bold tabular-nums tracking-tight">{s.value}</span>
            <span className="mt-2 text-[11px] uppercase tracking-widest text-muted-foreground text-center">{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SocialProof() {
  return (
    <div className="border-y border-border bg-secondary/30">
      <div className="mx-auto max-w-6xl px-6 py-3 text-center">
        <p className="text-xs text-muted-foreground">
          Covering{" "}
          <span className="font-semibold text-foreground">England, Scotland, Wales and Northern Ireland</span>
          {" "}— updated monthly from{" "}
          <span className="font-semibold text-foreground">NHS BSA, PHS, and HSC BSO</span>
          {" "}official sources.
        </p>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: BarChart2,
    title: "Benchmarking",
    desc: "See exactly where you rank against every pharmacy in your region, cohort, and the UK.",
  },
  {
    icon: Map,
    title: "Competitive Intelligence",
    desc: "Map your local landscape, identify GP feeder dependencies, and spot acquisition targets.",
  },
  {
    icon: TrendingUp,
    title: "Performance Tracking",
    desc: "Monitor dispensing trends, Pharmacy First growth, and revenue over time.",
  },
] as const;

function Features() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="grid md:grid-cols-3 gap-6">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="rounded-xl border border-border bg-card p-7 shadow-sm"
          >
            <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-secondary border border-border">
              <f.icon className="h-5 w-5 text-foreground" />
            </div>
            <h3 className="text-base font-bold tracking-tight">{f.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Boards({ data, error }: { data: Dashboard | null; error: string | null }) {
  const boards = [
    { key: "items", title: "Items dispensed", rows: data?.top_items },
    { key: "pf",    title: "Pharmacy First",  rows: data?.top_pf },
    { key: "nms",   title: "NMS",             rows: data?.top_nms },
    { key: "eps",   title: "EPS Items",       rows: data?.top_eps },
  ];

  return (
    <section className="border-t border-border bg-card">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-bold tracking-tight">Leaderboards</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live · Updated monthly
            </span>
          </div>
          <Link
            to="/leaderboards"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            View all →
          </Link>
        </div>

        {error && <p className="text-sm text-destructive mb-6">{error}</p>}

        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
          {boards.map((b) => (
            <Card key={b.key} className="overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-secondary/30">
                <span className="text-sm font-semibold">{b.title}</span>
                <Trophy className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <ol>
                {(b.rows?.slice(0, 5) || Array.from({ length: 5 })).map((r: any, i: number) => (
                  <li
                    key={i}
                    className={[
                      "flex items-center gap-3 px-4 py-2.5 text-sm",
                      i === 0
                        ? "bg-gold/8 border-b border-gold/15"
                        : "border-t border-border",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "tabular-nums w-5 text-xs font-bold shrink-0",
                        i === 0 ? "text-gold" : "text-muted-foreground",
                      ].join(" ")}
                    >
                      {i + 1}
                    </span>
                    {r ? (
                      <>
                        <span className={["flex-1 truncate", i === 0 ? "font-semibold" : ""].join(" ")}>
                          {titleCase(r.name)}
                        </span>
                        <span
                          className={[
                            "tabular-nums text-xs font-semibold shrink-0",
                            i === 0 ? "text-foreground" : "text-muted-foreground",
                          ].join(" ")}
                        >
                          {fmtCompact(r.value)}
                        </span>
                      </>
                    ) : (
                      <span className="flex-1 h-3 rounded bg-muted animate-pulse" />
                    )}
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-24 text-center">
        <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight">
          Know your market.<br />Own your position.
        </h2>
        <p className="mt-5 text-muted-foreground max-w-sm mx-auto text-base leading-relaxed">
          Every pharmacy. Every month. The intelligence you need to make better decisions.
        </p>
        <div className="mt-8">
          <Button asChild size="lg" className="px-10">
            <Link to="/register">
              Get started <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">Free to explore. No card required.</p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col md:flex-row justify-between gap-3 text-xs text-muted-foreground">
        <span>© {new Date().getFullYear()} PharmInsight</span>
        <span>Sources: NHS BSA, PHS, NHS Wales, HSC BSO, Companies House — OGL v3.0</span>
      </div>
    </footer>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, BarChart2, Map, TrendingUp, Pill, Building2,
  Stethoscope, ClipboardCheck, Zap, FileBarChart2, Radar, Compass,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

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

type TrendRow = { year: number; month: number; items: number; eps: number; pf: number; nms: number };
type CountryRow = { country: string; value: number; pf: number; nms: number; pharmacies: number };
type Dashboard = {
  period: { year: number; month: number } | null;
  totals_now: { items: number; pf: number; nms: number; eps: number; pharmacies: number };
  totals_trend: TrendRow[];
  by_country: CountryRow[];
};

const fmtCompact = (n: number) => {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "bn";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "m";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "k";
  return String(n);
};
const monthName = (y: number, m: number) =>
  new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "short", year: "numeric" });

function Landing() {
  const [data, setData] = useState<Dashboard | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.rpc("public_landing_data");
      if (alive) setData(data as unknown as Dashboard);
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-gold/30">
      <Header />
      <main className="mx-auto max-w-6xl px-6 py-16 md:py-24 space-y-24 md:space-y-32">
        <Hero data={data} />
        <StatBand data={data} />
        <FeatureBento data={data} />
        <TrackedGrid />
        <ClosingCTA />
      </main>
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
            <Button asChild size="sm"><Link to="/dashboard">My Pharmacy</Link></Button>
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
  return (
    <section className="relative text-center space-y-8">
      <div
        className="pointer-events-none absolute inset-x-0 -top-20 bottom-0 -z-10 opacity-[0.04]"
        aria-hidden="true"
        style={{ backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)", backgroundSize: "24px 24px" }}
      />

      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-card text-[10px] font-bold tracking-widest uppercase">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-gold" />
        </span>
        {period ? `Data updated · ${monthName(period.year, period.month)}` : "Latest NHS data"}
      </div>

      <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[0.95]">
        Every UK pharmacy.<br />
        Every month.<br />
        <span className="text-gold">One platform.</span>
      </h1>

      <p className="max-w-2xl mx-auto text-lg text-muted-foreground leading-relaxed">
        Official NHS dispensing data, benchmarking, and competitive intelligence for pharmacy owners and buyers — refreshed monthly from NHS BSA, PHS, and HSC BSO.
      </p>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
        <Button asChild size="lg" className="px-8">
          <Link to="/register">Get started free <ArrowRight className="h-4 w-4 ml-2" /></Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="px-8">
          <Link to="/leaderboards">Explore the data</Link>
        </Button>
      </div>
    </section>
  );
}

function StatBand({ data }: { data: Dashboard | null }) {
  const t = data?.totals_now;
  const stats = [
    { k: "Pharmacies covered", v: t ? t.pharmacies.toLocaleString() : "12,368", sub: "England · Scotland · Wales · NI" },
    { k: "Items dispensed", v: t ? fmtCompact(t.items) : "—", sub: "this reporting period" },
    { k: "Pharmacy First", v: t ? fmtCompact(t.pf) : "—", sub: "clinical consultations" },
    { k: "Months of history", v: "24", sub: "rolling, every contractor" },
  ];
  return (
    <section className="grid grid-cols-2 md:grid-cols-4 border border-border bg-card divide-x divide-y md:divide-y-0 divide-border">
      {stats.map((s) => (
        <div key={s.k} className="p-6 md:p-8">
          <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-muted-foreground">{s.k}</p>
          <p className="mt-3 text-3xl md:text-4xl font-bold tabular-nums tracking-tight">{s.v}</p>
          <p className="mt-2 text-[11px] text-muted-foreground leading-snug">{s.sub}</p>
        </div>
      ))}
    </section>
  );
}

/* ---------------- Feature bento ---------------- */

function FeatureBento({ data }: { data: Dashboard | null }) {
  return (
    <section className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-gold">The Platform</p>
          <h2 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">Built for serious operators.</h2>
        </div>
        <p className="hidden md:block max-w-sm text-sm text-muted-foreground">
          Four intelligence modules powered by the same official dataset NHS BSA, PHS and HSC BSO publish each month.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <BenchmarkCard />
        <CompetitiveCard />
        <PerformanceCard trend={data?.totals_trend ?? null} />
        <AcquisitionCard />
      </div>
    </section>
  );
}

function CardShell({
  module, title, desc, viz,
}: { module: string; title: string; desc: string; viz: React.ReactNode }) {
  return (
    <div className="bg-card border border-border p-8 flex flex-col justify-between transition-colors hover:border-gold/50 shadow-sm">
      <div className="space-y-4">
        <div className="flex justify-between items-start gap-4">
          <p className="text-[10px] font-mono font-bold tracking-[0.18em] uppercase text-gold">{module}</p>
          <p className="text-right text-[10px] font-mono uppercase tracking-tight text-muted-foreground/70">
            Live · monthly
          </p>
        </div>
        <h3 className="text-xl font-bold tracking-tight">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
      </div>
      <div className="mt-8 pt-6 border-t border-border">{viz}</div>
    </div>
  );
}

function BenchmarkCard() {
  const rows = [
    { rank: 1, label: "Top performer", val: 9240, w: 100 },
    { rank: 4, label: "Cohort leader", val: 7860, w: 85 },
    { rank: 14, label: "You — top 12%", val: 6420, w: 70, me: true },
    { rank: 38, label: "Regional median", val: 4880, w: 53 },
  ];
  return (
    <CardShell
      module="Module 01 · Benchmarking"
      title="Rank against every UK pharmacy."
      desc="See exactly where you stand against every pharmacy in your region, cohort, and nationally — by items, services, EPS share and growth."
      viz={
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.rank} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3">
              <span className={`text-[10px] font-mono font-bold ${r.me ? "text-gold" : "text-muted-foreground"}`}>#{String(r.rank).padStart(2, "0")}</span>
              <div className="h-1.5 bg-secondary overflow-hidden">
                <div className={`h-full ${r.me ? "bg-gold" : "bg-foreground/30"}`} style={{ width: `${r.w}%` }} />
              </div>
              <span className={`text-[11px] font-mono tabular-nums ${r.me ? "font-bold text-foreground" : "text-muted-foreground"}`}>
                {r.val.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      }
    />
  );
}

function CompetitiveCard() {
  // Sparse fake catchment dots in a 12x6 grid
  const dots = [
    [2, 1], [3, 1], [5, 2], [4, 3], [6, 3], [7, 2], [8, 4],
    [9, 3], [10, 4], [11, 5], [1, 4], [3, 5], [5, 4], [7, 5],
  ];
  return (
    <CardShell
      module="Module 02 · Competitive Intel"
      title="Map your local landscape."
      desc="Visualise every competitor in your radius, the GP surgeries that feed them, and the catchment demographics behind their volume."
      viz={
        <div className="space-y-2">
          <div className="relative h-20 border border-border bg-secondary/30 overflow-hidden">
            <div
              className="absolute inset-0 opacity-50"
              style={{ backgroundImage: "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)", backgroundSize: "16px 16px", color: "var(--border)" }}
            />
            {dots.map(([x, y], i) => (
              <span
                key={i}
                className={`absolute h-1.5 w-1.5 rounded-full ${i === 5 ? "bg-gold ring-4 ring-gold/20" : "bg-foreground/50"}`}
                style={{ left: `${x * 8}%`, top: `${y * 14}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between text-[10px] font-mono uppercase tracking-tight text-muted-foreground">
            <span><span className="inline-block h-1.5 w-1.5 rounded-full bg-gold mr-1.5 align-middle" />You</span>
            <span>14 competitors · 1.6 km radius</span>
          </div>
        </div>
      }
    />
  );
}

function PerformanceCard({ trend }: { trend: TrendRow[] | null }) {
  const series = (trend ?? []).slice(-12).map((r) => r.items);
  const fallback = [40, 55, 45, 60, 52, 68, 64, 72, 78, 74, 84, 92];
  const data = series.length >= 6 ? series : fallback;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 100 - ((v - min) / (max - min || 1)) * 100;
    return `${x},${y}`;
  }).join(" ");
  const last = data[data.length - 1];
  const first = data[0];
  const delta = first > 0 ? ((last - first) / first) * 100 : 0;

  return (
    <CardShell
      module="Module 03 · Performance"
      title="24 months of every signal."
      desc="Track items, EPS, Pharmacy First, NMS and revenue across a 24-month rolling window — your pharmacy and every peer, side by side."
      viz={
        <div className="space-y-3">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-14 overflow-visible">
            <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground" vectorEffect="non-scaling-stroke" />
            <circle cx="100" cy={points.split(" ").pop()!.split(",")[1]} r="2" className="fill-gold" />
          </svg>
          <div className="flex justify-between items-center text-[10px] font-mono font-bold uppercase tracking-tight">
            <span className="text-muted-foreground">Items dispensed · LTM</span>
            <span className={delta >= 0 ? "text-gold" : "text-muted-foreground"}>
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
            </span>
          </div>
        </div>
      }
    />
  );
}

function AcquisitionCard() {
  return (
    <CardShell
      module="Module 04 · Acquisition"
      title="Targets you'd otherwise miss."
      desc="Automated valuations, Companies House ownership-change alerts, IMD deprivation deciles, and area-opportunity scores — built on real financials."
      viz={
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-mono font-bold tracking-[0.18em] uppercase text-muted-foreground">Est. valuation band</span>
            <span className="text-sm font-mono font-bold tabular-nums">£1.25m – £1.40m</span>
          </div>
          <div>
            <div className="flex justify-between text-[9px] font-mono uppercase tracking-tight text-muted-foreground mb-1.5">
              <span>Most deprived</span>
              <span>Decile 3</span>
              <span>Least deprived</span>
            </div>
            <div className="flex gap-0.5 h-2.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => (
                <div
                  key={d}
                  className={`flex-1 ${d === 3 ? "bg-gold" : d <= 3 ? "bg-foreground/70" : d <= 5 ? "bg-foreground/30" : "bg-foreground/10"}`}
                />
              ))}
            </div>
          </div>
        </div>
      }
    />
  );
}

/* ---------------- Tracked grid ---------------- */

const TRACKED = [
  { icon: Pill, label: "Items dispensed", desc: "Monthly prescription volume for every NHS contractor across all four nations." },
  { icon: Stethoscope, label: "Pharmacy First", desc: "Consultation volumes across 7 clinical pathways including UTI and sinusitis." },
  { icon: ClipboardCheck, label: "New Medicine Service", desc: "NMS completion rates and patient engagement trends by contractor." },
  { icon: Zap, label: "EPS adoption", desc: "Electronic Prescription Service adoption volume and market share per pharmacy." },
  { icon: BarChart2, label: "Benchmarking", desc: "Rank every pharmacy nationally, regionally, and within specific peer cohorts." },
  { icon: FileBarChart2, label: "Trend analysis", desc: "24-month rolling history to track growth, decline, and service-mix shifts." },
  { icon: Compass, label: "GP feeder mapping", desc: "Map GP feeder patterns and identify nearby competitor acquisition targets." },
  { icon: Building2, label: "Acquisition intel", desc: "Ownership-change alerts, automated valuations, and income-quality scores." },
  { icon: Radar, label: "Catchment & deprivation", desc: "IMD/SIMD/WIMD/NIMDM deciles across the radius around every pharmacy." },
  { icon: Map, label: "Local landscape", desc: "Every competitor in your radius with their service-mix and growth trajectory." },
  { icon: TrendingUp, label: "Fastest-growing", desc: "League tables of pharmacies gaining share month-on-month and year-on-year." },
  { icon: BarChart2, label: "Country splits", desc: "England, Scotland, Wales and NI volumes broken out by service and region." },
] as const;

function TrackedGrid() {
  return (
    <section className="space-y-10">
      <div className="text-center space-y-3">
        <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-gold">What we track</p>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Twelve data layers. One source of truth.</h2>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Every metric below is rebuilt from official NHS publications each month — no estimates, no scraping.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 border border-border bg-card">
        {TRACKED.map((m, i) => (
          <div
            key={m.label}
            className={[
              "p-6 md:p-7 space-y-3",
              i % 4 !== 3 ? "md:border-r border-border" : "",
              i % 2 === 0 ? "border-r md:border-r" : "",
              i < TRACKED.length - 2 ? "border-b border-border" : "",
              i < TRACKED.length - 4 ? "md:border-b" : "md:border-b-0",
            ].join(" ")}
          >
            <div className="flex items-center justify-between">
              <m.icon className="h-4 w-4 text-gold" />
              <span className="text-[9px] font-mono font-bold tracking-tight text-muted-foreground/60">{String(i + 1).padStart(2, "0")}</span>
            </div>
            <h4 className="font-bold text-sm tracking-tight">{m.label}</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">{m.desc}</p>
          </div>
        ))}
      </div>

      <div className="text-center">
        <Link to="/leaderboards" className="inline-flex items-center gap-1.5 text-sm font-semibold underline underline-offset-4 decoration-gold hover:decoration-foreground transition-colors">
          View the full leaderboards <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  );
}

/* ---------------- CTA + footer ---------------- */

function ClosingCTA() {
  return (
    <section className="relative bg-foreground text-background p-10 md:p-16 text-center overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        aria-hidden="true"
        style={{ backgroundImage: "repeating-linear-gradient(45deg, currentColor 0, currentColor 1px, transparent 0, transparent 50%)", backgroundSize: "20px 20px" }}
      />
      <div className="relative space-y-6">
        <h2 className="text-4xl md:text-5xl font-bold tracking-tight">
          Know your market.<br />Own your position.
        </h2>
        <p className="max-w-xl mx-auto text-background/60 leading-relaxed">
          The intelligence you need to make better pharmacy decisions — across all four UK nations, every single month.
        </p>
        <div className="pt-2">
          <Button asChild size="lg" className="bg-gold text-gold-foreground hover:bg-gold/90 px-10 h-12 text-base font-bold">
            <Link to="/register">Get started free</Link>
          </Button>
          <p className="mt-6 text-[10px] font-mono uppercase tracking-[0.2em] text-background/40">
            No credit card · Official NHS data sources
          </p>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col md:flex-row justify-between gap-3 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
        <span>© {new Date().getFullYear()} PharmInsight</span>
        <span>Sources: NHS BSA · PHS · NHS Wales · HSC BSO · Companies House — OGL v3.0</span>
      </div>
    </footer>
  );
}

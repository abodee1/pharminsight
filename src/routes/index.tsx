import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, BarChart2, Map, TrendingUp, Pill, Building2,
  Stethoscope, ClipboardCheck, Zap, FileBarChart2, Radar, Compass,
  MapPin, CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

type Example = {
  id: string;
  name: string;
  location: string;
  tag: string;
  benchmark: { rank: number; label: string; val: number; w: number; me?: boolean }[];
  competitors: number;
  trend: number[];
  decile: number;
  valuation: string;
  radius: number;
};

const EXAMPLES: Example[] = [
  {
    id: "urban",
    name: "Browns Pharmacy",
    location: "Manchester, England",
    tag: "Urban · high competition",
    benchmark: [
      { rank: 1, label: "Top performer", val: 14200, w: 100 },
      { rank: 8, label: "Cohort leader", val: 12100, w: 85 },
      { rank: 14, label: "You — top 8%", val: 10800, w: 76, me: true },
      { rank: 42, label: "Regional median", val: 8300, w: 58 },
    ],
    competitors: 18,
    trend: [60, 62, 58, 65, 68, 70, 72, 75, 74, 78, 82, 88],
    decile: 2,
    valuation: "£1.05m – £1.20m",
    radius: 1.2,
  },
  {
    id: "suburban",
    name: "Clyde Pharmacy",
    location: "Glasgow, Scotland",
    tag: "Suburban · stable volume",
    benchmark: [
      { rank: 1, label: "Top performer", val: 12400, w: 100 },
      { rank: 6, label: "Cohort leader", val: 10500, w: 85 },
      { rank: 19, label: "You — top 15%", val: 9100, w: 73, me: true },
      { rank: 51, label: "Regional median", val: 6400, w: 52 },
    ],
    competitors: 9,
    trend: [72, 70, 71, 73, 72, 74, 75, 74, 76, 75, 77, 78],
    decile: 5,
    valuation: "£890k – £1.05m",
    radius: 2.4,
  },
  {
    id: "city",
    name: "High Street Pharmacy",
    location: "Cardiff, Wales",
    tag: "City centre · high volume",
    benchmark: [
      { rank: 1, label: "Top performer", val: 18500, w: 100 },
      { rank: 3, label: "Cohort leader", val: 16200, w: 88 },
      { rank: 5, label: "You — top 3%", val: 15400, w: 83, me: true },
      { rank: 28, label: "Regional median", val: 9800, w: 53 },
    ],
    competitors: 23,
    trend: [90, 88, 92, 89, 94, 91, 95, 93, 96, 94, 97, 95],
    decile: 3,
    valuation: "£1.60m – £1.85m",
    radius: 0.9,
  },
];

function Landing() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [selected, setSelected] = useState<Example>(EXAMPLES[0]);
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
        <ExampleSelector selected={selected} onSelect={setSelected} />
        <FeatureBento data={data} example={selected} />
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

function ExampleSelector({ selected, onSelect }: { selected: Example; onSelect: (e: Example) => void }) {
  return (
    <section className="space-y-8">
      <div className="text-center space-y-3">
        <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-gold">Interactive demo</p>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Pick a pharmacy profile.</h2>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Switch between real-world scenarios to see how the four intelligence modules adapt to each pharmacy.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {EXAMPLES.map((ex) => {
          const active = ex.id === selected.id;
          return (
            <button
              key={ex.id}
              onClick={() => onSelect(ex)}
              aria-pressed={active}
              className={cn(
                "group relative text-left border p-6 transition-all duration-200",
                active
                  ? "border-gold bg-gold/[0.04] shadow-sm"
                  : "border-border bg-card hover:border-gold/40 hover:bg-card/80"
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-mono font-bold tracking-[0.18em] uppercase text-gold">{ex.tag}</p>
                  <h3 className="text-lg font-bold tracking-tight">{ex.name}</h3>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {ex.location}
                  </p>
                </div>
                <div
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border",
                    active ? "border-gold bg-gold text-gold-foreground" : "border-border text-transparent"
                  )}
                >
                  <CheckCircle2 className="h-3 w-3" />
                </div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3 text-[10px] font-mono uppercase tracking-tight text-muted-foreground">
                <div>
                  <span className="block text-sm font-bold tabular-nums text-foreground">{ex.competitors}</span>
                  Competitors
                </div>
                <div>
                  <span className="block text-sm font-bold tabular-nums text-foreground">{ex.benchmark[2].val.toLocaleString()}</span>
                  Items/mo
                </div>
                <div>
                  <span className="block text-sm font-bold tabular-nums text-foreground">D{ex.decile}</span>
                  Deprivation
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- Feature bento ---------------- */

function FeatureBento({ data, example }: { data: Dashboard | null; example: Example }) {
  return (
    <section className="space-y-6" key={example.id}>
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
        <BenchmarkCard example={example} />
        <CompetitiveCard example={example} />
        <PerformanceCard trend={data?.totals_trend ?? null} example={example} />
        <AcquisitionCard example={example} />
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

function BenchmarkCard({ example }: { example: Example }) {
  return (
    <CardShell
      module="Module 01 · Benchmarking"
      title="Rank against every UK pharmacy."
      desc="See exactly where you stand against every pharmacy in your region, cohort, and nationally — by items, services, EPS share and growth."
      viz={
        <div className="space-y-2.5">
          {example.benchmark.map((r) => (
            <div key={r.rank} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3">
              <span className={`text-[10px] font-mono font-bold ${r.me ? "text-gold" : "text-muted-foreground"}`}>#{String(r.rank).padStart(2, "0")}</span>
              <div className="h-1.5 bg-secondary overflow-hidden">
                <div
                  className={`h-full ${r.me ? "bg-gold" : "bg-foreground/30"}`}
                  style={{ width: `${r.w}%`, transition: "width 600ms ease" }}
                />
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

function CompetitiveCard({ example }: { example: Example }) {
  // Deterministic but jittered dots from the competitor count
  const dots = Array.from({ length: example.competitors }).map((_, i) => {
    const x = ((i * 7.3) % 95) + 2.5;
    const y = ((i * 11.7) % 80) + 10;
    return [x, y, i];
  });
  const meIndex = Math.floor(example.competitors / 2);
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
            {dots.map(([x, y, i]) => (
              <span
                key={`${example.id}-${i}`}
                className={`absolute h-1.5 w-1.5 rounded-full transition-all duration-500 ${i === meIndex ? "bg-gold ring-4 ring-gold/20" : "bg-foreground/50"}`}
                style={{ left: `${x}%`, top: `${y}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between text-[10px] font-mono uppercase tracking-tight text-muted-foreground">
            <span><span className="inline-block h-1.5 w-1.5 rounded-full bg-gold mr-1.5 align-middle" />You</span>
            <span>{example.competitors} competitors · {example.radius} km radius</span>
          </div>
        </div>
      }
    />
  );
}

function PerformanceCard({ trend, example }: { trend: TrendRow[] | null; example: Example }) {
  const series = (trend ?? []).slice(-12).map((r) => r.items);
  const data = series.length >= 6 ? series : example.trend;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 100 - ((v - min) / (max - min || 1)) * 100;
    return `${x},${y}`;
  }).join(" ");
  const lastY = points.split(" ").pop()!.split(",")[1];
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
            <circle cx="100" cy={lastY} r="2" className="fill-gold transition-all duration-500" />
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

function AcquisitionCard({ example }: { example: Example }) {
  return (
    <CardShell
      module="Module 04 · Acquisition"
      title="Targets you'd otherwise miss."
      desc="Automated valuations, Companies House ownership-change alerts, IMD deprivation deciles, and area-opportunity scores — built on real financials."
      viz={
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-mono font-bold tracking-[0.18em] uppercase text-muted-foreground">Est. valuation band</span>
            <span className="text-sm font-mono font-bold tabular-nums">{example.valuation}</span>
          </div>
          <div>
            <div className="flex justify-between text-[9px] font-mono uppercase tracking-tight text-muted-foreground mb-1.5">
              <span>Most deprived</span>
              <span>Decile {example.decile}</span>
              <span>Least deprived</span>
            </div>
            <div className="flex gap-0.5 h-2.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => (
                <div
                  key={d}
                  className={cn(
                    "flex-1 transition-colors duration-300",
                    d === example.decile
                      ? "bg-gold"
                      : d <= example.decile
                        ? "bg-foreground/70"
                        : d <= example.decile + 2
                          ? "bg-foreground/30"
                          : "bg-foreground/10"
                  )}
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

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, BarChart2, Map, TrendingUp, Pill, Trophy, Building2, Crown,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
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
  top_fastest_growing: LeaderRow[];
  totals_trend: TrendRow[];
  top_regions: RegionRow[];
  by_country: CountryRow[];
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
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

// Client-side trading name resolution for leaderboard display
const CHAIN_NAMES: [string, string][] = [
  ["BOOTS UK LIMITED", "Boots"],
  ["BOOTS", "Boots"],
  ["LLOYDS PHARMACY", "Lloyds Pharmacy"],
  ["WELL PHARMACY", "Well"],
  ["BESTWAY NATIONAL CHEMISTS", "Well"],
  ["BESTWAY MEDICALS", "Well"],
  ["L ROWLAND & CO", "Rowlands Pharmacy"],
  ["ROWLANDS PHARMACY", "Rowlands Pharmacy"],
  ["DAY LEWIS", "Day Lewis Pharmacy"],
  ["MOSS PHARMACY", "Moss Pharmacy"],
  ["PEAK PHARMACY", "Peak Pharmacy"],
  ["NUMARK", "Numark Pharmacy"],
  ["WELDRICKS", "Weldricks Pharmacy"],
  ["JHOOTS PHARMACY", "Jhoots Pharmacy"],
  ["PAYDENS", "Paydens Pharmacy"],
  ["PHARMACY2U", "Pharmacy2U"],
  ["CHEMIST DIRECT", "Chemist Direct"],
  ["SUPERDRUG", "Superdrug Pharmacy"],
  ["ASDA PHARMACY", "Asda Pharmacy"],
  ["TESCO PHARMACY", "Tesco Pharmacy"],
  ["MORRISONS PHARMACY", "Morrisons Pharmacy"],
  ["SAINSBURYS PHARMACY", "Sainsbury's Pharmacy"],
  ["CO-OPERATIVE PHARMACY", "Co-op Pharmacy"],
  ["GORDONS CHEMISTS", "Gordons Chemists"],
];
function resolveName(raw: string): string {
  const upper = raw.toUpperCase();
  for (const [pattern, trading] of CHAIN_NAMES) {
    if (upper.includes(pattern)) return trading;
  }
  return titleCase(raw);
}

const COUNTRY_STYLE: Record<string, string> = {
  England: "bg-blue-50 text-blue-700 border-blue-200",
  Scotland: "bg-indigo-50 text-indigo-700 border-indigo-200",
  Wales: "bg-red-50 text-red-700 border-red-200",
  "Northern Ireland": "bg-emerald-50 text-emerald-700 border-emerald-200",
};
function CountryTag({ country }: { country: string | null }) {
  if (!country) return null;
  const short = country === "Northern Ireland" ? "NI" : country.slice(0, 3).toUpperCase();
  return (
    <span className={["text-[9px] font-bold uppercase tracking-wide border rounded px-1 py-0.5 shrink-0 leading-none", COUNTRY_STYLE[country] || "bg-secondary text-muted-foreground"].join(" ")}>
      {short}
    </span>
  );
}

const PROOF_POINTS = [
  "Updated monthly from official NHS sources",
  "Covering 12,368 pharmacies across the UK",
  "Used by pharmacy owners, buyers, and prescribers",
];

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
      <TrendChart data={data?.totals_trend ?? null} />
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
  const [proofIdx, setProofIdx] = useState(0);
  const [proofVisible, setProofVisible] = useState(true);
  const prefersReduced = useRef(
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    if (prefersReduced.current) return;
    const t = setInterval(() => {
      setProofVisible(false);
      const swap = setTimeout(() => {
        setProofIdx(i => (i + 1) % PROOF_POINTS.length);
        setProofVisible(true);
      }, 300);
      return () => clearTimeout(swap);
    }, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="relative mx-auto max-w-5xl px-6 pt-24 pb-20 text-center overflow-hidden">
      {/* Subtle static gradient background — disabled for reduced motion (no animation anyway) */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 20% 60%, hsl(var(--primary) / 0.06) 0%, transparent 70%), " +
            "radial-gradient(ellipse 50% 40% at 80% 20%, hsl(45 93% 47% / 0.05) 0%, transparent 70%)",
        }}
      />

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

      {/* Rotating proof points */}
      <p
        className="mt-5 text-sm text-muted-foreground transition-opacity duration-300 motion-reduce:transition-none"
        style={{ opacity: proofVisible ? 1 : 0 }}
        aria-live="polite"
      >
        {PROOF_POINTS[proofIdx]}
      </p>
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
  {
    icon: Building2,
    title: "Acquisition Intelligence",
    desc: "Automated pharmacy valuations, ownership change alerts, and area opportunity mapping.",
  },
] as const;

function Features() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      {/* Mobile: horizontal scroll carousel. md+: 4-column grid. */}
      <div className="flex gap-5 overflow-x-auto md:overflow-visible md:grid md:grid-cols-4 snap-x snap-mandatory md:snap-none pb-4 md:pb-0 -mx-6 px-6 md:mx-0 md:px-0 scrollbar-none">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="snap-start shrink-0 w-[76vw] sm:w-[45vw] md:w-auto min-w-0 rounded-xl border border-border bg-card p-7 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
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

function TrendChart({ data }: { data: TrendRow[] | null }) {
  if (!data || data.length < 3) return null;
  const chartData = data.slice(-12).map(r => ({
    label: `${MONTHS[r.month - 1]} '${String(r.year).slice(2)}`,
    items: Math.round(r.items / 1000),
  }));

  return (
    <section className="border-t border-border bg-secondary/20">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">UK dispensing trend</h2>
          <p className="text-sm text-muted-foreground mt-1">Last 12 months · all pharmacies · items dispensed (thousands)</p>
        </div>
        <div className="h-56 md:h-64">
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}k`} width={44} />
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                formatter={(v: any) => [`${Number(v).toLocaleString()}k items`, "Total dispensed"]}
              />
              <Line
                type="monotone"
                dataKey="items"
                stroke="var(--chart-1)"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

function Boards({ data, error }: { data: Dashboard | null; error: string | null }) {
  const boards = [
    { key: "items",    title: "Items dispensed",  rows: data?.top_items,           fmt: fmtCompact },
    { key: "pf",       title: "Pharmacy First",   rows: data?.top_pf,              fmt: fmtCompact },
    { key: "nms",      title: "NMS",              rows: data?.top_nms,             fmt: fmtCompact },
    { key: "eps",      title: "EPS Items",        rows: data?.top_eps,             fmt: fmtCompact },
    { key: "fastest",  title: "Fastest growing",  rows: data?.top_fastest_growing, fmt: (v: number) => `+${v.toFixed(1)}%` },
  ];

  return (
    <section className="border-t border-border bg-card">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-bold tracking-tight">Leaderboards</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse motion-reduce:animate-none" />
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

        {/* Mobile: horizontal scroll. md: 2-col, xl: 5-col */}
        <div className="flex gap-4 overflow-x-auto md:overflow-visible md:grid md:grid-cols-2 xl:grid-cols-5 snap-x md:snap-none -mx-6 px-6 md:mx-0 md:px-0 pb-4 md:pb-0 scrollbar-none">
          {boards.map((b) => (
            <Card key={b.key} className="snap-start shrink-0 w-[85vw] sm:w-[55vw] md:w-auto overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-secondary/30">
                <span className="text-sm font-semibold">{b.title}</span>
                <Trophy className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <ol>
                {(b.rows?.slice(0, 5) || Array.from({ length: 5 })).map((r: any, i: number) => (
                  <li
                    key={i}
                    className={[
                      "flex items-center gap-2.5 px-4 py-2.5 text-sm border-t border-border first:border-0",
                      i === 0 ? "bg-gold/8 border-l-2 border-l-gold/50" : "",
                    ].join(" ")}
                  >
                    <span className={["tabular-nums w-5 text-xs font-bold shrink-0", i === 0 ? "text-gold" : "text-muted-foreground"].join(" ")}>
                      {i === 0 ? <Crown className="h-3.5 w-3.5 inline text-gold" /> : i + 1}
                    </span>
                    {r ? (
                      <>
                        <span className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                          <Link
                            to="/pharmacy/$odsCode"
                            params={{ odsCode: r.ods }}
                            className={["truncate hover:underline underline-offset-2 max-w-[120px]", i === 0 ? "font-semibold" : ""].join(" ")}
                          >
                            {resolveName(r.name)}
                          </Link>
                          <CountryTag country={r.country} />
                        </span>
                        <span className={["tabular-nums text-xs font-semibold shrink-0", i === 0 ? "text-foreground" : "text-muted-foreground"].join(" ")}>
                          {b.fmt(r.value)}
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
    <section className="border-t border-border" style={{ background: "radial-gradient(ellipse 80% 60% at 50% 120%, hsl(var(--primary) / 0.06) 0%, transparent 70%)" }}>
      <div className="mx-auto max-w-6xl px-6 py-24 text-center">
        <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight">
          Know your market.<br />Own your position.
        </h2>
        <p className="mt-5 text-muted-foreground max-w-sm mx-auto text-base leading-relaxed">
          Every pharmacy. Every month. The intelligence you need to make better decisions.
        </p>
        <div className="mt-8">
          <Button asChild size="lg" className="px-12 py-4 h-auto text-base font-semibold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200">
            <Link to="/register">
              Get started free <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
        <p className="mt-5 text-xs text-muted-foreground">
          No credit card required · Free to explore · Official NHS data sources
        </p>
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

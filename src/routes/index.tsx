import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Pill, Activity, Stethoscope, ArrowUpRight, ArrowRight, Sparkles,
  TrendingUp, MapPin, Building2, BarChart2, Trophy, Database,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, Tooltip,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "PharmInsight — Live UK pharmacy league tables & NHS analytics" },
      {
        name: "description",
        content:
          "An editorial dashboard of every NHS pharmacy in the UK. Live monthly leaderboards, benchmarking, GP catchment and Companies House intelligence — free.",
      },
      { property: "og:title", content: "PharmInsight — A living atlas of UK community pharmacy" },
      { property: "og:description", content: "Live UK-wide dispensing data with benchmarking, GP catchment and Companies House intelligence." },
      { property: "og:url", content: "https://pharmacy8.com/" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://pharmacy8.com/" }],
  }),
});

/* ---------- types ---------- */
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

/* ---------- formatters ---------- */
const fmt = (n: number) => n.toLocaleString("en-GB");
const fmtCompact = (n: number) => {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "bn";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "m";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "k";
  return String(n);
};
const monthName = (y: number, m: number) =>
  new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" });

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bLtd\b/i, "Ltd").replace(/\bUk\b/g, "UK").replace(/\bNhs\b/g, "NHS");
}

/* ---------- Landing ---------- */
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
    <div className="paper min-h-screen">
      {/* Paper & Ink scoped palette */}
      <style>{`
        .paper {
          --paper: #f5f3ee;
          --paper-2: #ece8de;
          --ink: #0d0d0d;
          --ink-2: #2d2d2d;
          --rule: #d9d3c4;
          --ink-dim: #6b6657;
          background: var(--paper);
          color: var(--ink);
          font-family: var(--font-sans);
        }
        .paper a { color: inherit; }
        .paper .grain {
          background-image:
            radial-gradient(rgba(0,0,0,0.045) 1px, transparent 1px);
          background-size: 3px 3px;
        }
        .serif { font-family: "Inter", ui-serif, Georgia, serif; font-feature-settings: "ss01","cv11"; letter-spacing: -0.02em; }
        .num { font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
        .rule { border-color: var(--rule); }
        .ink-dim { color: var(--ink-dim); }
        .tile { background: #fff; border: 1px solid var(--rule); border-radius: 14px; }
        .tile-dark { background: var(--ink); color: var(--paper); border: 1px solid var(--ink); border-radius: 14px; }
        .tile-paper { background: var(--paper-2); border: 1px solid var(--rule); border-radius: 14px; }
        .kicker { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-dim); }
        .kicker-on-dark { color: rgba(245,243,238,0.6); }
        .dot-grid {
          background-image: radial-gradient(rgba(13,13,13,0.18) 1px, transparent 1px);
          background-size: 14px 14px;
        }
      `}</style>

      <PaperHeader />
      <Hero data={data} />
      <Marquee />
      <BentoDeck data={data} error={error} />
      <NationsStrip data={data} />
      <Leaderboards data={data} />
      <Manifesto />
      <PaperFooter />
    </div>
  );
}

/* ---------- header ---------- */
function PaperHeader() {
  const { user, loading } = useAuth();
  return (
    <header className="sticky top-0 z-30 backdrop-blur" style={{ background: "rgba(245,243,238,0.85)", borderBottom: "1px solid var(--rule)" }}>
      <div className="mx-auto max-w-7xl px-6 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md" style={{ background: "var(--ink)", color: "var(--paper)" }}>
            <Pill className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <div className="text-base font-bold tracking-tight">PharmInsight</div>
            <div className="text-[10px] uppercase tracking-[0.22em] ink-dim">An atlas of UK pharmacy</div>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <a href="#leaderboards" className="hidden md:inline text-sm font-medium px-3 py-2 hover:opacity-70">Leaderboards</a>
          <a href="#atlas" className="hidden md:inline text-sm font-medium px-3 py-2 hover:opacity-70">The atlas</a>
          {loading ? null : user ? (
            <Link to="/dashboard" className="inline-flex items-center gap-1 rounded-md px-4 py-2 text-sm font-semibold" style={{ background: "var(--ink)", color: "var(--paper)" }}>
              Open dashboard <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <>
              <Link to="/login" className="text-sm font-medium px-3 py-2 hover:opacity-70">Sign in</Link>
              <Link to="/register" className="inline-flex items-center gap-1 rounded-md px-4 py-2 text-sm font-semibold" style={{ background: "var(--ink)", color: "var(--paper)" }}>
                Get started <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* ---------- hero (editorial masthead) ---------- */
function Hero({ data }: { data: Dashboard | null }) {
  const period = data?.period;
  const issue = period ? `Vol. ${period.year}  ·  No. ${String(period.month).padStart(2, "0")}` : "Loading edition…";
  return (
    <section className="relative">
      <div className="mx-auto max-w-7xl px-6 pt-10 pb-6">
        <div className="flex items-end justify-between gap-6 pb-4 border-b-2" style={{ borderColor: "var(--ink)" }}>
          <div className="kicker">The PharmInsight Atlas</div>
          <div className="kicker num">{issue}</div>
        </div>
        <div className="grid lg:grid-cols-12 gap-8 pt-8">
          <div className="lg:col-span-8">
            <h1 className="serif text-[44px] md:text-[68px] lg:text-[84px] leading-[0.95] font-bold">
              Every NHS pharmacy<br />
              in the UK,<br />
              <span className="italic" style={{ color: "var(--ink-2)" }}>observed each month.</span>
            </h1>
            <p className="mt-6 text-base md:text-lg max-w-xl ink-dim leading-relaxed">
              A living dashboard of dispensing, services, financials and catchment for
              16,000+ community pharmacies across the four nations. Built on open NHS data —
              free to read, free to claim.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/register" className="inline-flex items-center gap-2 rounded-md px-5 py-3 text-sm font-semibold" style={{ background: "var(--ink)", color: "var(--paper)" }}>
                Claim your pharmacy <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#atlas" className="inline-flex items-center gap-2 rounded-md px-5 py-3 text-sm font-semibold border-2" style={{ borderColor: "var(--ink)" }}>
                Explore this month's atlas
              </a>
            </div>
          </div>
          <aside className="lg:col-span-4 lg:border-l rule lg:pl-8 flex flex-col justify-end">
            <div className="kicker mb-3">Index</div>
            <ol className="space-y-2 text-sm">
              {[
                ["01", "Bento of the nation", "#atlas"],
                ["02", "Four nations, one ledger", "#nations"],
                ["03", "This month's league tables", "#leaderboards"],
                ["04", "Why we built this", "#manifesto"],
              ].map(([n, t, h]) => (
                <li key={n} className="flex items-baseline gap-3">
                  <span className="num text-xs ink-dim w-6">{n}</span>
                  <a href={h} className="font-medium border-b border-transparent hover:border-current">{t}</a>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </div>
    </section>
  );
}

/* ---------- marquee strip ---------- */
function Marquee() {
  const items = [
    "16,000+ NHS pharmacies", "Updated monthly from official NHS releases",
    "England · Scotland · Wales · Northern Ireland", "Companies House linked",
    "GP catchment", "Open Government Licence v3.0",
  ];
  return (
    <div className="border-y rule overflow-hidden" style={{ background: "var(--ink)", color: "var(--paper)" }}>
      <div className="mx-auto max-w-7xl px-6 py-3 flex flex-wrap items-center gap-x-8 gap-y-1 text-xs">
        {items.map((t, i) => (
          <span key={i} className="flex items-center gap-2 uppercase tracking-[0.15em]" style={{ opacity: 0.85 }}>
            <span className="inline-block h-1 w-1 rounded-full" style={{ background: "var(--paper)" }} />
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- bento atlas ---------- */
function BentoDeck({ data, error }: { data: Dashboard | null; error: string | null }) {
  const totals = data?.totals_now;
  const period = data?.period;
  const trend = (data?.totals_trend || []).map((r) => ({
    label: new Date(r.year, r.month - 1, 1).toLocaleString("en-GB", { month: "short" }),
    items: r.items, eps: r.eps,
  }));

  return (
    <section id="atlas" className="border-b rule">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="kicker">§ 01 — The bento</div>
            <h2 className="serif text-3xl md:text-5xl font-bold mt-2">A nation, in tiles.</h2>
          </div>
          <div className="text-xs ink-dim text-right max-w-xs hidden md:block">
            Each tile draws on the most recent fully reported month{period ? ` (${monthName(period.year, period.month)})` : ""}.
          </div>
        </div>
        {error && <p className="text-sm text-destructive mb-4">{error}</p>}

        <div className="grid grid-cols-12 gap-4 auto-rows-[minmax(140px,auto)]">
          {/* Hero number — items dispensed */}
          <div className="col-span-12 md:col-span-7 row-span-2 tile-dark p-6 md:p-8 relative overflow-hidden">
            <div className="absolute inset-0 dot-grid opacity-20" />
            <div className="relative flex flex-col h-full justify-between">
              <div className="flex items-start justify-between">
                <span className="kicker kicker-on-dark">Total items dispensed</span>
                <Pill className="h-4 w-4 opacity-60" />
              </div>
              <div>
                <div className="serif num text-[88px] md:text-[140px] leading-[0.85] font-bold">
                  {totals ? fmtCompact(totals.items) : "—"}
                </div>
                <div className="mt-3 text-sm opacity-70">
                  prescription items dispensed across the UK in {period ? monthName(period.year, period.month) : "the latest month"}.
                </div>
              </div>
              {/* tiny trend */}
              <div className="h-16 -mx-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f5f3ee" stopOpacity={0.55} />
                        <stop offset="100%" stopColor="#f5f3ee" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="items" stroke="#f5f3ee" strokeWidth={1.5} fill="url(#hg)" />
                    <Tooltip
                      formatter={(v: any) => fmt(Number(v))}
                      contentStyle={{ background: "#0d0d0d", border: "1px solid #2d2d2d", borderRadius: 8, color: "#f5f3ee", fontSize: 11 }}
                      labelStyle={{ color: "#f5f3ee" }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Pharmacies tracked */}
          <BigStat
            className="col-span-6 md:col-span-5"
            kicker="Pharmacies tracked"
            value={totals ? fmt(totals.pharmacies) : "—"}
            sub="across all four UK nations"
            icon={Database}
          />

          {/* Pharmacy First */}
          <BigStat
            className="col-span-6 md:col-span-5"
            kicker="Pharmacy First"
            value={totals ? fmtCompact(totals.pf) : "—"}
            sub="consultations this month"
            icon={Stethoscope}
          />

          {/* UK 4 nations infographic */}
          <NationsMap className="col-span-12 md:col-span-7 row-span-2" data={data} />

          {/* NMS */}
          <BigStat
            className="col-span-6 md:col-span-5"
            kicker="NMS"
            value={totals ? fmtCompact(totals.nms) : "—"}
            sub="new medicine service interventions"
            icon={Activity}
          />

          {/* EPS */}
          <BigStat
            className="col-span-6 md:col-span-5"
            kicker="EPS items"
            value={totals ? fmtCompact(totals.eps) : "—"}
            sub="electronic prescriptions"
            icon={TrendingUp}
          />

          {/* Top regions bar (compact) */}
          <RegionsTile className="col-span-12 md:col-span-7" data={data} />

          {/* Benchmark sample */}
          <BenchmarkSample className="col-span-12 md:col-span-5" />

          {/* Companies House CTA */}
          <CHTile className="col-span-12 md:col-span-7" />

          {/* AI analysis CTA */}
          <AITile className="col-span-12 md:col-span-5" />
        </div>
      </div>
    </section>
  );
}

function BigStat({
  className = "", kicker, value, sub, icon: Icon,
}: { className?: string; kicker: string; value: string; sub: string; icon: any }) {
  return (
    <div className={`tile p-5 md:p-6 flex flex-col justify-between ${className}`}>
      <div className="flex items-center justify-between">
        <span className="kicker">{kicker}</span>
        <Icon className="h-4 w-4 ink-dim" />
      </div>
      <div className="mt-4">
        <div className="serif num text-5xl md:text-6xl font-bold leading-none">{value}</div>
        <div className="mt-2 text-xs ink-dim">{sub}</div>
      </div>
    </div>
  );
}

/* ---------- Four nations infographic ---------- */
function NationsMap({ className = "", data }: { className?: string; data: Dashboard | null }) {
  const rows = data?.by_country || [];
  const max = Math.max(1, ...rows.map((r) => r.value));
  // simplified geographic blocks — Scotland top, NI left-mid, England right, Wales lower-left
  const layout: Record<string, { x: number; y: number; w: number; h: number }> = {
    Scotland: { x: 60, y: 8, w: 120, h: 70 },
    "Northern Ireland": { x: 8, y: 80, w: 60, h: 40 },
    Wales: { x: 80, y: 110, w: 50, h: 50 },
    England: { x: 130, y: 80, w: 110, h: 110 },
  };
  return (
    <div className={`tile-paper p-5 md:p-6 relative overflow-hidden ${className}`}>
      <div className="flex items-start justify-between">
        <div>
          <span className="kicker">Four nations</span>
          <h3 className="serif text-2xl md:text-3xl font-bold mt-1">One ledger.</h3>
        </div>
        <span className="text-xs ink-dim">share of items dispensed</span>
      </div>
      <div className="mt-5 grid grid-cols-5 gap-4 items-center">
        <svg viewBox="0 0 250 210" className="col-span-2 w-full h-auto">
          <defs>
            <pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#0d0d0d" strokeWidth="1" />
            </pattern>
          </defs>
          {Object.entries(layout).map(([country, box]) => {
            const row = rows.find((r) => r.country?.toLowerCase() === country.toLowerCase());
            const intensity = row ? row.value / max : 0.2;
            return (
              <g key={country}>
                <rect x={box.x} y={box.y} width={box.w} height={box.h}
                  fill={intensity > 0.6 ? "#0d0d0d" : "url(#hatch)"}
                  opacity={0.25 + intensity * 0.7}
                  stroke="#0d0d0d" strokeWidth="1" rx="4" />
                <text x={box.x + 4} y={box.y + 12} fontSize="8"
                  fill={intensity > 0.6 ? "#f5f3ee" : "#0d0d0d"}
                  fontWeight="700" style={{ letterSpacing: "0.08em" }}>
                  {country.toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="col-span-3 space-y-3">
          {(rows.length ? rows : Array.from({ length: 4 })).map((r: any, i: number) => {
            const pct = r ? Math.round((r.value / max) * 100) : 0;
            return (
              <div key={i} className="border-b rule pb-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold">{r?.country || "—"}</span>
                  <span className="num text-sm font-bold">{r ? fmtCompact(r.value) : "…"}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full" style={{ background: "#e6dfcd" }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--ink)" }} />
                </div>
                <div className="mt-1 flex justify-between text-[10px] ink-dim">
                  <span>{r ? `${fmt(r.pharmacies)} pharmacies` : "…"}</span>
                  <span className="num">{r ? `PF ${fmtCompact(r.pf)} · NMS ${fmtCompact(r.nms)}` : ""}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- Top regions bar ---------- */
function RegionsTile({ className = "", data }: { className?: string; data: Dashboard | null }) {
  const rows = (data?.top_regions || []).slice(0, 8).map((r) => ({
    name: titleCase(r.region).replace(/^Nhs /i, ""), value: r.value,
  }));
  return (
    <div className={`tile p-5 md:p-6 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <span className="kicker">Top areas</span>
          <h3 className="serif text-xl md:text-2xl font-bold mt-1">Where the volume sits.</h3>
        </div>
        <MapPin className="h-4 w-4 ink-dim" />
      </div>
      <div className="mt-4 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
            <XAxis type="number" hide tickFormatter={(v: number) => fmtCompact(v)} />
            <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11, fill: "#2d2d2d" }} stroke="transparent" />
            <Tooltip
              formatter={(v: any) => fmt(Number(v))}
              contentStyle={{ background: "#fff", border: "1px solid #d9d3c4", borderRadius: 8, fontSize: 12 }}
            />
            <Bar dataKey="value" fill="#0d0d0d" radius={[0, 4, 4, 0]}>
              {rows.map((_, i) => <Cell key={i} fill={i === 0 ? "#0d0d0d" : "#2d2d2d"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ---------- Benchmark sample (synthetic illustration) ---------- */
function BenchmarkSample({ className = "" }: { className?: string }) {
  const sample = useMemo(() => ([
    { label: "Items", you: 8200, local: 6400, top: 11000 },
    { label: "PF", you: 64, local: 38, top: 92 },
    { label: "NMS", you: 41, local: 28, top: 78 },
    { label: "EPS %", you: 92, local: 88, top: 97 },
  ]), []);
  return (
    <div className={`tile p-5 md:p-6 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <span className="kicker">Sample pharmacy</span>
          <h3 className="serif text-xl md:text-2xl font-bold mt-1">You vs the cohort.</h3>
        </div>
        <BarChart2 className="h-4 w-4 ink-dim" />
      </div>
      <div className="mt-4 space-y-3">
        {sample.map((m) => {
          const max = Math.max(m.you, m.local, m.top);
          return (
            <div key={m.label}>
              <div className="flex justify-between text-xs">
                <span className="font-semibold">{m.label}</span>
                <span className="num ink-dim">local {fmtCompact(m.local)} · top {fmtCompact(m.top)}</span>
              </div>
              <div className="relative mt-1 h-5 rounded" style={{ background: "var(--paper-2)" }}>
                <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${(m.local / max) * 100}%`, background: "#cdc4ad" }} />
                <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${(m.you / max) * 100}%`, background: "var(--ink)" }} />
                <div className="absolute inset-y-0" style={{ left: `${(m.top / max) * 100}%`, width: 2, background: "#000", opacity: 0.5 }} />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-bold num" style={{ color: "var(--paper)" }}>
                  {fmtCompact(m.you)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-[11px] ink-dim">
        Illustrative numbers. Claim your pharmacy to see the real comparison against your ICB cohort.
      </p>
    </div>
  );
}

/* ---------- Companies House tile ---------- */
function CHTile({ className = "" }: { className?: string }) {
  return (
    <div className={`tile-paper p-5 md:p-6 ${className}`}>
      <div className="grid md:grid-cols-2 gap-4 items-center">
        <div>
          <span className="kicker">Companies House, linked</span>
          <h3 className="serif text-2xl md:text-3xl font-bold mt-1">Numbers, with names attached.</h3>
          <p className="text-sm ink-dim mt-2 max-w-sm">
            Every limited-company pharmacy joined to its accounts, directors, valuation range and red flags.
          </p>
          <Link to="/register" className="inline-flex items-center gap-1.5 mt-3 text-sm font-semibold border-b-2" style={{ borderColor: "var(--ink)" }}>
            Browse pharmacy owners <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          {[
            { k: "T/O range", v: "£0.6–1.4m" },
            { k: "Net assets", v: "£212k" },
            { k: "Avg age", v: "11 yrs" },
            { k: "Directors", v: "2" },
            { k: "Sister sites", v: "4" },
            { k: "Red flags", v: "0" },
          ].map((c) => (
            <div key={c.k} className="rounded-md p-2" style={{ background: "#fff", border: "1px solid var(--rule)" }}>
              <div className="kicker text-[9px]">{c.k}</div>
              <div className="num text-sm font-bold mt-1">{c.v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- AI tile ---------- */
function AITile({ className = "" }: { className?: string }) {
  return (
    <div className={`tile-dark p-5 md:p-6 relative overflow-hidden ${className}`}>
      <div className="absolute inset-0 dot-grid opacity-15" />
      <div className="relative">
        <span className="kicker kicker-on-dark">One-click AI</span>
        <h3 className="serif text-2xl md:text-3xl font-bold mt-1">Read the room.</h3>
        <p className="text-sm opacity-75 mt-2 max-w-sm">
          A 30-second written summary of how a pharmacy is performing — written in the voice of a calm consultant.
        </p>
        <div className="mt-4 rounded-md p-3 text-xs" style={{ background: "rgba(245,243,238,0.08)", border: "1px solid rgba(245,243,238,0.15)" }}>
          <Sparkles className="h-3.5 w-3.5 inline mr-1.5 opacity-70" />
          "Items dispensed up 6% YoY. Pharmacy First sits in the top quartile for the local ICB.
          Worth pressing on NMS — currently 32% behind the local average."
        </div>
      </div>
    </div>
  );
}

/* ---------- Nations strip ---------- */
function NationsStrip({ data }: { data: Dashboard | null }) {
  const rows = data?.by_country || [];
  return (
    <section id="nations" className="border-b rule" style={{ background: "var(--paper-2)" }}>
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="kicker">§ 02 — Four nations</div>
            <h2 className="serif text-3xl md:text-5xl font-bold mt-2">One country, four ledgers.</h2>
          </div>
          <p className="text-xs ink-dim max-w-xs text-right hidden md:block">
            Each nation publishes its own dispensing data, on its own cadence. We line them up.
          </p>
        </div>
        <div className="grid md:grid-cols-4 gap-0 border-y-2" style={{ borderColor: "var(--ink)" }}>
          {(rows.length ? rows : Array.from({ length: 4 })).map((r: any, i: number) => (
            <div key={i} className={`p-5 md:p-7 ${i < 3 ? "md:border-r rule" : ""} ${i > 0 && i < rows.length ? "border-t md:border-t-0 rule" : ""}`}>
              <div className="num text-xs ink-dim">0{i + 1}</div>
              <div className="serif text-2xl font-bold mt-1">{r?.country || "—"}</div>
              <div className="num serif text-4xl md:text-5xl font-bold mt-3">{r ? fmtCompact(r.value) : "…"}</div>
              <div className="text-[11px] ink-dim">items dispensed</div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <Mini k="Pharm." v={r ? fmt(r.pharmacies) : "…"} />
                <Mini k="PF" v={r ? fmtCompact(r.pf) : "…"} />
                <Mini k="NMS" v={r ? fmtCompact(r.nms) : "…"} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
function Mini({ k, v }: { k: string; v: string }) {
  return <div><div className="kicker text-[9px]">{k}</div><div className="num font-semibold mt-0.5">{v}</div></div>;
}

/* ---------- Leaderboards ---------- */
function Leaderboards({ data }: { data: Dashboard | null }) {
  const period = data?.period;
  const boards = [
    { key: "items", title: "Items dispensed", rows: data?.top_items },
    { key: "pf", title: "Pharmacy First", rows: data?.top_pf },
    { key: "nms", title: "NMS", rows: data?.top_nms },
    { key: "eps", title: "EPS", rows: data?.top_eps },
  ];
  return (
    <section id="leaderboards" className="border-b rule">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="kicker">§ 03 — League tables</div>
            <h2 className="serif text-3xl md:text-5xl font-bold mt-2">Top of the page,<br />top of the league.</h2>
          </div>
          <p className="text-xs ink-dim max-w-xs text-right hidden md:block">
            UK-wide top 10 for {period ? monthName(period.year, period.month) : "the latest month"}. Sign in to filter by ICB and unlock 36 months of history.
          </p>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
          {boards.map((b) => (
            <div key={b.key} className="tile overflow-hidden">
              <div className="px-4 py-3 border-b rule flex items-center justify-between" style={{ background: "var(--paper-2)" }}>
                <span className="text-sm font-semibold">{b.title}</span>
                <Trophy className="h-3.5 w-3.5 ink-dim" />
              </div>
              <ol className="divide-y rule">
                {(b.rows || Array.from({ length: 10 })).map((r: any, i: number) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className={[
                      "num inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold flex-shrink-0",
                      i === 0 ? "bg-black text-white" : "border rule",
                    ].join(" ")}>{i + 1}</span>
                    {r ? (
                      <>
                        <span className="flex-1 truncate font-medium">{titleCase(r.name)}</span>
                        <span className="num font-bold">{fmtCompact(r.value)}</span>
                      </>
                    ) : (
                      <span className="flex-1 h-3 rounded animate-pulse" style={{ background: "var(--paper-2)" }} />
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <div className="mt-6 text-center">
          <Link to="/register" className="text-sm font-semibold border-b-2 pb-0.5" style={{ borderColor: "var(--ink)" }}>
            Unlock full filters and history →
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------- Manifesto ---------- */
function Manifesto() {
  const principles = [
    { n: "I.", t: "Open data deserves clear pages.", b: "NHS releases are dense PDFs and spreadsheets. We publish them as a living atlas, free to read." },
    { n: "II.", t: "Compare, don't just count.", b: "Every number sits next to its local cohort and the top decile. Context is the product." },
    { n: "III.", t: "Numbers with names attached.", b: "Companies House, GP catchment and four-nation services in one record. Not a different tab." },
    { n: "IV.", t: "Read it in 30 seconds.", b: "AI turns the dashboard into a paragraph. Skim the page, claim the insight, move on." },
  ];
  return (
    <section id="manifesto" className="border-b rule">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4">
            <div className="kicker">§ 04 — Manifesto</div>
            <h2 className="serif text-3xl md:text-5xl font-bold mt-2">Why we built this.</h2>
            <p className="mt-4 text-sm ink-dim max-w-sm">
              We were tired of paying for a read-only mirror of free NHS data. So we built the
              alternative: a clearer atlas, with the context built in.
            </p>
            <Link to="/register" className="inline-flex items-center gap-2 mt-6 rounded-md px-5 py-3 text-sm font-semibold" style={{ background: "var(--ink)", color: "var(--paper)" }}>
              Start reading the atlas <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="lg:col-span-8 grid md:grid-cols-2 gap-px" style={{ background: "var(--rule)" }}>
            {principles.map((p) => (
              <div key={p.n} className="p-6" style={{ background: "var(--paper)" }}>
                <div className="serif text-2xl font-bold">{p.n}</div>
                <div className="serif text-lg font-bold mt-1">{p.t}</div>
                <p className="text-sm ink-dim mt-2 leading-relaxed">{p.b}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- footer ---------- */
function PaperFooter() {
  return (
    <footer style={{ background: "var(--ink)", color: "var(--paper)" }}>
      <div className="mx-auto max-w-7xl px-6 py-14 grid md:grid-cols-3 gap-8">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md" style={{ background: "var(--paper)", color: "var(--ink)" }}>
              <Pill className="h-3.5 w-3.5" />
            </span>
            <span className="font-bold">PharmInsight</span>
          </div>
          <p className="mt-3 text-xs opacity-70 leading-relaxed max-w-xs">
            A living atlas of UK community pharmacy, built on open NHS data.
          </p>
        </div>
        <div>
          <div className="kicker kicker-on-dark">Read</div>
          <ul className="mt-3 space-y-1.5 text-sm">
            <li><a href="#atlas" className="hover:opacity-60">The bento</a></li>
            <li><a href="#nations" className="hover:opacity-60">Four nations</a></li>
            <li><a href="#leaderboards" className="hover:opacity-60">League tables</a></li>
            <li><a href="#manifesto" className="hover:opacity-60">Manifesto</a></li>
          </ul>
        </div>
        <div>
          <div className="kicker kicker-on-dark">Sources</div>
          <p className="mt-3 text-xs opacity-70 leading-relaxed">
            NHS BSA (England), Public Health Scotland, NHS Wales, HSC BSO (Northern Ireland) and
            Companies House — Open Government Licence v3.0.
          </p>
        </div>
      </div>
      <div className="border-t" style={{ borderColor: "rgba(245,243,238,0.15)" }}>
        <div className="mx-auto max-w-7xl px-6 py-4 text-xs opacity-70 flex flex-col md:flex-row justify-between gap-2">
          <span>© {new Date().getFullYear()} PharmInsight</span>
          <span>Updated monthly from official NHS releases.</span>
        </div>
      </div>
    </footer>
  );
}

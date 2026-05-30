import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Trophy, BarChart2, Building2, Pill, Activity, Stethoscope, ArrowUpRight,
  Sparkles, Database, MapPin, TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
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
          "Live monthly leaderboards for every NHS pharmacy in England, Scotland, Wales and Northern Ireland. Items dispensed, Pharmacy First, NMS, EPS — plus benchmarking, financials and Companies House intelligence.",
      },
      { property: "og:title", content: "PharmInsight — Live UK pharmacy league tables & NHS analytics" },
      { property: "og:description", content: "The free, faster, smarter alternative to pharmdata — live UK-wide pharmacy dispensing data with benchmarking and Companies House intelligence." },
      { property: "og:url", content: "https://pharmacy8.com/" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://pharmacy8.com/" }],
    scripts: [{
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "PharmInsight",
        url: "https://pharmacy8.com/",
        description: "Live UK pharmacy dispensing leaderboards and NHS analytics.",
      }),
    }],
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
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main>
        <Hero totals={data?.totals_now} period={data?.period} />
        <ValueRow />
        <LeaderboardsBlock data={data} error={error} />
        <TrendBlock data={data} />
        <RegionsBlock data={data} />
        <CountryBlock data={data} />
        <CompareCta />
        <Features />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  const { user, loading } = useAuth();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto max-w-7xl px-6 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Pill className="h-4 w-4" />
          </span>
          <span className="text-lg font-bold tracking-tight text-foreground">Pharmacy8</span>
        </Link>
        <div className="flex items-center gap-2">
          {loading ? null : user ? (
            <Link to="/dashboard" className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90">
              Open dashboard <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <>
              <Link to="/login" className="text-sm font-medium text-foreground hover:text-primary px-3 py-2">Sign in</Link>
              <Link to="/register" className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90">
                Get started <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Hero({ totals, period }: { totals?: Dashboard["totals_now"]; period?: Dashboard["period"] }) {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(80%_60%_at_50%_0%,oklch(0.96_0.04_265)_0%,transparent_70%)]" />
      <div className="mx-auto max-w-7xl px-6 pt-16 pb-12">
        <div className="text-center max-w-4xl mx-auto">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-gold" />
            Live NHS data · updated monthly · free to view
          </span>
          <h1 className="mt-5 text-4xl md:text-6xl font-bold tracking-tight text-foreground">
            Every NHS pharmacy in the UK,{" "}
            <span className="text-gold">ranked in real time.</span>
          </h1>
          <p className="mt-5 text-base md:text-lg text-muted-foreground max-w-2xl mx-auto">
            Items dispensed, Pharmacy First, NMS, EPS, financials and Companies House intelligence —
            for England, Scotland, Wales and Northern Ireland.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link to="/register" className="rounded-md bg-primary text-primary-foreground px-6 py-3 text-sm font-semibold hover:opacity-90">
              Create free account
            </Link>
            <a href="#leaderboards" className="rounded-md border border-border bg-card px-6 py-3 text-sm font-semibold hover:bg-secondary">
              See live league tables
            </a>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatTile icon={Database} label="Pharmacies tracked" value={totals ? fmt(totals.pharmacies) : "…"} hint={period ? monthName(period.year, period.month) : "Loading"} />
          <StatTile icon={Pill} label="Items dispensed" value={totals ? fmtCompact(totals.items) : "…"} hint="this month" />
          <StatTile icon={Stethoscope} label="Pharmacy First" value={totals ? fmtCompact(totals.pf) : "…"} hint="consultations" />
          <StatTile icon={Activity} label="NMS interventions" value={totals ? fmtCompact(totals.nms) : "…"} hint="this month" />
          <StatTile icon={TrendingUp} label="EPS items" value={totals ? fmtCompact(totals.eps) : "…"} hint="electronic prescriptions" />
        </div>
      </div>
    </section>
  );
}

function StatTile({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>
    </div>
  );
}

function ValueRow() {
  const items = [
    "16,000+ NHS pharmacies",
    "60+ months of history",
    "Companies House linkage",
    "Local landscape & GP linkage",
    "AI-powered analysis",
  ];
  return (
    <div className="border-b border-border bg-secondary/40">
      <div className="mx-auto max-w-7xl px-6 py-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
        {items.map((t) => <span key={t} className="flex items-center gap-1.5">✓ {t}</span>)}
      </div>
    </div>
  );
}

function LeaderboardsBlock({ data, error }: { data: Dashboard | null; error: string | null }) {
  const period = data?.period;
  const boards = [
    { key: "items", title: "Items dispensed", icon: Pill, rows: data?.top_items },
    { key: "pf",    title: "Pharmacy First",   icon: Stethoscope, rows: data?.top_pf },
    { key: "nms",   title: "NMS",              icon: Activity, rows: data?.top_nms },
    { key: "eps",   title: "EPS items",        icon: TrendingUp, rows: data?.top_eps },
  ];
  return (
    <section id="leaderboards" className="border-b border-border">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeader
          eyebrow="Live UK leaderboards"
          title="Who's top of the league this month?"
          subtitle={period ? `Top 10 across the UK · ${monthName(period.year, period.month)}` : "Loading latest month…"}
        />
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        <div className="mt-8 grid md:grid-cols-2 xl:grid-cols-4 gap-5">
          {boards.map((b) => (
            <LeaderCard key={b.key} title={b.title} icon={b.icon} rows={b.rows} />
          ))}
        </div>
        <div className="mt-6 text-center">
          <Link to="/register" className="text-sm font-semibold text-primary hover:underline">
            Sign in to filter by ICB, Health Board and 36 months of history →
          </Link>
        </div>
      </div>
    </section>
  );
}

function LeaderCard({ title, icon: Icon, rows }: { title: string; icon: any; rows?: LeaderRow[] }) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-secondary/50">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <ol className="divide-y divide-border">
        {(rows || Array.from({ length: 10 })).map((r: any, i: number) => (
          <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className={[
              "inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold flex-shrink-0",
              i === 0 ? "bg-gold/20 text-gold" : i < 3 ? "bg-secondary text-foreground" : "bg-muted text-muted-foreground",
            ].join(" ")}>{i + 1}</span>
            {r ? (
              <>
                <span className="flex-1 truncate font-medium text-foreground">{titleCase(r.name)}</span>
                <span className="tabular-nums font-semibold text-foreground">{fmt(r.value)}</span>
              </>
            ) : (
              <span className="flex-1 h-3 rounded bg-muted animate-pulse" />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bLtd\b/i, "Ltd").replace(/\bUk\b/g, "UK").replace(/\bNhs\b/g, "NHS");
}

function TrendBlock({ data }: { data: Dashboard | null }) {
  const series = (data?.totals_trend || []).map((r) => ({
    label: new Date(r.year, r.month - 1, 1).toLocaleString("en-GB", { month: "short", year: "2-digit" }),
    items: r.items,
    eps: r.eps,
  }));
  return (
    <section className="border-b border-border bg-secondary/30">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeader
          eyebrow="National trend"
          title="UK NHS dispensing — last 24 months"
          subtitle="Total items dispensed (all four nations) vs Electronic Prescription Service (EPS) items."
        />
        <div className="mt-8 rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gItems" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gEps" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--gold)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--gold)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis tickFormatter={(v: number) => fmtCompact(v)} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <Tooltip
                  formatter={(v: any) => fmt(Number(v))}
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                />
                <Area type="monotone" dataKey="items" name="Total items" stroke="var(--chart-2)" strokeWidth={2} fill="url(#gItems)" />
                <Area type="monotone" dataKey="eps" name="EPS items" stroke="var(--gold)" strokeWidth={2} fill="url(#gEps)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}

function RegionsBlock({ data }: { data: Dashboard | null }) {
  const rows = data?.top_regions || [];
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeader
          eyebrow="Areas"
          title="Top 12 areas by dispensing volume"
          subtitle="NHS regions, ICBs and Health Boards ranked by total items this month."
        />
        <div className="mt-8 grid md:grid-cols-2 gap-x-8 gap-y-2">
          {(rows.length ? rows : Array.from({ length: 12 })).map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <span className="text-xs tabular-nums text-muted-foreground w-6 text-right">{i + 1}</span>
              <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium truncate">{r ? titleCase(r.region) : ""}</span>
                  <span className="text-sm font-semibold tabular-nums">{r ? fmtCompact(r.value) : ""}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: r ? `${(r.value / max) * 100}%` : "0%" }} />
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {r ? `${r.pharmacies} pharmacies · ${r.country}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CountryBlock({ data }: { data: Dashboard | null }) {
  const rows = data?.by_country || [];
  return (
    <section className="border-b border-border bg-secondary/30">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeader
          eyebrow="UK breakdown"
          title="Four nations, one view"
          subtitle="England, Scotland, Wales and Northern Ireland side by side."
        />
        <div className="mt-8 grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {(rows.length ? rows : Array.from({ length: 4 })).map((r: any, i: number) => (
            <div key={i} className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{r?.country || "—"}</div>
              <div className="mt-2 text-3xl font-bold tabular-nums">{r ? fmtCompact(r.value) : "…"}</div>
              <div className="text-xs text-muted-foreground">items dispensed</div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <Mini label="Pharmacies" value={r ? fmt(r.pharmacies) : "…"} />
                <Mini label="PF" value={r ? fmtCompact(r.pf) : "…"} />
                <Mini label="NMS" value={r ? fmtCompact(r.nms) : "…"} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function CompareCta() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="rounded-xl border border-border bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-8 md:p-10 shadow-lg">
          <div className="grid md:grid-cols-2 gap-6 items-center">
            <div>
              <span className="inline-block text-xs uppercase tracking-widest text-gold font-semibold">Why Pharmacy8 beats pharmdata</span>
              <h2 className="mt-2 text-2xl md:text-3xl font-bold">Live leaderboards, free benchmarking, AI analysis, Companies House data — in one place.</h2>
              <p className="mt-3 text-sm md:text-base text-primary-foreground/80 max-w-xl">
                Pharmdata is read-only. Pharmacy8 lets you sign in, claim your pharmacy, benchmark against the local average and top 10%, see GP catchment, run AI analysis, and pull Companies House financials — all included.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link to="/register" className="rounded-md bg-gold text-gold-foreground px-5 py-2.5 text-sm font-semibold hover:opacity-90">
                  Claim your pharmacy
                </Link>
                <Link to="/login" className="rounded-md border border-primary-foreground/30 px-5 py-2.5 text-sm font-semibold hover:bg-primary-foreground/10">
                  Sign in
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <CompareTile label="Live league tables" us="✓" them="✓" />
              <CompareTile label="Filter by ICB / HB" us="✓" them="✓" />
              <CompareTile label="Benchmark vs local" us="✓" them="✗" />
              <CompareTile label="Companies House" us="✓" them="✗" />
              <CompareTile label="GP catchment" us="✓" them="✗" />
              <CompareTile label="AI analysis" us="✓" them="✗" />
              <CompareTile label="Local landscape" us="✓" them="✗" />
              <CompareTile label="Free to use" us="✓" them="paid" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CompareTile({ label, us, them }: { label: string; us: string; them: string }) {
  return (
    <div className="rounded-md bg-primary-foreground/10 border border-primary-foreground/15 px-3 py-2.5">
      <div className="text-xs text-primary-foreground/70">{label}</div>
      <div className="mt-1 flex items-center justify-between text-sm">
        <span className="text-gold font-semibold">Us {us}</span>
        <span className="text-primary-foreground/60">Them {them}</span>
      </div>
    </div>
  );
}

function Features() {
  const items = [
    { icon: Trophy, title: "Leaderboards", body: "Every pharmacy, every service, every month — filter by country, ICB and Health Board." },
    { icon: BarChart2, title: "Benchmarking", body: "See where you sit vs the local cohort and the national top 10%, in plain English." },
    { icon: Building2, title: "Companies House", body: "Linked financials, directors, valuation range and red flags for every limited company." },
    { icon: MapPin, title: "Local landscape", body: "Nearby competing pharmacies, surrounding GP surgeries and dispensing share." },
    { icon: Stethoscope, title: "Pharmacy First", body: "Track every advanced service: PF, NMS, MCR, smoking cessation, methadone and more." },
    { icon: Sparkles, title: "AI analysis", body: "One click turns the numbers into a 30-second performance summary, written like a consultant would." },
  ];
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <SectionHeader eyebrow="Everything you need" title="Built for owners, consultants and acquirers." />
        <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((f) => (
            <div key={f.title} className="rounded-lg border border-border bg-card p-6 shadow-sm hover:border-gold/40 hover:shadow-md transition-all">
              <div className="h-10 w-10 rounded-md bg-gold/15 flex items-center justify-center text-gold">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="border-b border-border bg-secondary/30">
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Ready to know where you stand?</h2>
        <p className="mt-3 text-muted-foreground">It takes 30 seconds. No card. Full access to leaderboards, benchmarking and AI analysis.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link to="/register" className="rounded-md bg-primary text-primary-foreground px-6 py-3 text-sm font-semibold hover:opacity-90">
            Create free account
          </Link>
          <Link to="/login" className="rounded-md border border-border bg-card px-6 py-3 text-sm font-semibold hover:bg-secondary">
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}

function SectionHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="text-center max-w-3xl mx-auto">
      <span className="text-xs uppercase tracking-widest text-gold font-semibold">{eyebrow}</span>
      <h2 className="mt-2 text-2xl md:text-3xl font-bold tracking-tight text-foreground">{title}</h2>
      {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function SiteFooter() {
  return (
    <footer>
      <div className="mx-auto max-w-7xl px-6 py-10 grid md:grid-cols-3 gap-6 text-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Pill className="h-3.5 w-3.5" />
            </span>
            <span className="font-bold">Pharmacy8</span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
            Live UK pharmacy analytics, built on open NHS data. The smarter alternative to pharmdata.
          </p>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product</div>
          <ul className="mt-3 space-y-1.5">
            <li><Link to="/register" className="hover:text-primary">Get started</Link></li>
            <li><Link to="/login" className="hover:text-primary">Sign in</Link></li>
            <li><a href="#leaderboards" className="hover:text-primary">Leaderboards</a></li>
          </ul>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data sources</div>
          <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
            NHS BSA (England), Public Health Scotland, NHS Wales, HSC BSO (Northern Ireland), Companies House — all under the Open Government Licence v3.0.
          </p>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-4 text-xs text-muted-foreground flex flex-col md:flex-row justify-between gap-2">
          <span>© {new Date().getFullYear()} Pharmacy8</span>
          <span>Data updated monthly from official NHS releases.</span>
        </div>
      </div>
    </footer>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Pill, Trophy } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
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
      <Stats data={data} />
      <Regions data={data} error={error} />
      <Boards data={data} />
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
  const trend = (data?.totals_trend || []).map((r) => ({
    label: new Date(r.year, r.month - 1, 1).toLocaleString("en-GB", { month: "short" }),
    items: r.items,
  }));
  return (
    <section className="mx-auto max-w-6xl px-6 pt-16 pb-12">
      <div className="grid lg:grid-cols-2 gap-10 items-end">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {period ? monthName(period.year, period.month) : "Latest data"}
          </p>
          <h1 className="mt-3 text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05]">
            UK pharmacy data,<br />in one place.
          </h1>
          <p className="mt-4 text-base text-muted-foreground max-w-md">
            Monthly NHS dispensing, services and ownership data for every community pharmacy in the UK.
          </p>
          <div className="mt-6 flex gap-3">
            <Button asChild><Link to="/register">Get started <ArrowRight className="h-4 w-4 ml-1" /></Link></Button>
            <Button asChild variant="outline"><Link to="/leaderboards">View leaderboards</Link></Button>
          </div>
        </div>
        <div className="h-40 -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="items" stroke="var(--chart-1)" strokeWidth={1.5} fill="url(#hg)" />
              <Tooltip
                formatter={(v: any) => fmt(Number(v))}
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

function Stats({ data }: { data: Dashboard | null }) {
  const t = data?.totals_now;
  const items = [
    { k: "Pharmacies", v: t ? fmt(t.pharmacies) : "—" },
    { k: "Items dispensed", v: t ? fmtCompact(t.items) : "—" },
    { k: "Pharmacy First", v: t ? fmtCompact(t.pf) : "—" },
    { k: "NMS", v: t ? fmtCompact(t.nms) : "—" },
  ];
  return (
    <section className="border-y border-border bg-card">
      <div className="mx-auto max-w-6xl px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6">
        {items.map((s) => (
          <div key={s.k}>
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{s.k}</div>
            <div className="mt-1.5 text-3xl font-semibold tabular-nums tracking-tight">{s.v}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Regions({ data, error }: { data: Dashboard | null; error: string | null }) {
  const rows = (data?.top_regions || []).slice(0, 8).map((r) => ({
    name: titleCase(r.region).replace(/^Nhs /i, ""), value: r.value,
  }));
  return (
    <section className="mx-auto max-w-6xl px-6 py-14">
      <div className="flex items-end justify-between mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Top areas by volume</h2>
        <p className="text-xs text-muted-foreground hidden md:block">Items dispensed, latest month</p>
      </div>
      {error && <p className="text-sm text-destructive mb-4">{error}</p>}
      <Card className="p-5">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="transparent" />
              <Tooltip
                formatter={(v: any) => fmt(Number(v))}
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
              />
              <Bar dataKey="value" fill="var(--chart-2)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </section>
  );
}

function Boards({ data }: { data: Dashboard | null }) {
  const boards = [
    { key: "items", title: "Items dispensed", rows: data?.top_items },
    { key: "pf", title: "Pharmacy First", rows: data?.top_pf },
    { key: "nms", title: "NMS", rows: data?.top_nms },
    { key: "eps", title: "EPS", rows: data?.top_eps },
  ];
  return (
    <section className="border-t border-border bg-card">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="flex items-end justify-between mb-6">
          <h2 className="text-2xl font-semibold tracking-tight">Leaderboards</h2>
          <Link to="/leaderboards" className="text-sm font-medium text-muted-foreground hover:text-foreground">View all →</Link>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
          {boards.map((b) => (
            <Card key={b.key} className="overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/40">
                <span className="text-sm font-semibold">{b.title}</span>
                <Trophy className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <ol className="divide-y divide-border">
                {(b.rows?.slice(0, 5) || Array.from({ length: 5 })).map((r: any, i: number) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="tabular-nums w-5 text-xs text-muted-foreground">{i + 1}</span>
                    {r ? (
                      <>
                        <span className="flex-1 truncate">{titleCase(r.name)}</span>
                        <span className="tabular-nums font-semibold">{fmtCompact(r.value)}</span>
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
    <section className="mx-auto max-w-6xl px-6 py-20 text-center">
      <h2 className="text-3xl font-semibold tracking-tight">Claim your pharmacy.</h2>
      <p className="mt-3 text-muted-foreground max-w-md mx-auto">
        Benchmark against your local cohort and unlock full history.
      </p>
      <Button asChild size="lg" className="mt-6"><Link to="/register">Get started <ArrowRight className="h-4 w-4 ml-1" /></Link></Button>
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

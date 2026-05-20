import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader, StatCard } from "@/components/PageHeader";
import { DataAttribution } from "@/components/DataAttribution";
import { PercentileRail, AnnotatedSparkline } from "@/components/Infographics";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { Trophy, BarChart2, Upload, GitCompare, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Dashboard });

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

type Pharmacy = { id: string; name: string; region: string | null; country: string | null };
type Row = {
  pharmacy_id: string; month: number; year: number;
  items_dispensed: number; nms_count: number; pharmacy_first_count: number;
};

function Dashboard() {
  const { user, profile } = useAuth();
  const [pharmacy, setPharmacy] = useState<Pharmacy | null>(null);
  const [series, setSeries] = useState<{ label: string; mine: number; national: number }[]>([]);
  const [stats, setStats] = useState({ items: 0, pf: 0, nms: 0, rank: 0, total: 0 });
  const [peerItems, setPeerItems] = useState<number[]>([]);
  const [peerPf, setPeerPf] = useState<number[]>([]);

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: up } = await supabase
        .from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle();
      if (!up) return;
      const { data: ph } = await supabase
        .from("pharmacies").select("id,name,region,country").eq("id", up.pharmacy_id).maybeSingle();
      if (!ph) return;
      setPharmacy(ph as Pharmacy);

      const all = await fetchAll<Row>((from, to) =>
        supabase
          .from("dispensing_data")
          .select("pharmacy_id,month,year,items_dispensed,nms_count,pharmacy_first_count")
          .range(from, to)
      );
      const rows = all;

      // build 12-month series for mine vs national avg
      const periods = Array.from(
        new Set(rows.map((r) => `${r.year}-${String(r.month).padStart(2, "0")}`))
      ).sort();
      const points = periods.map((p) => {
        const [y, m] = p.split("-").map(Number);
        const subset = rows.filter((r) => r.year === y && r.month === m);
        const mine = subset.find((r) => r.pharmacy_id === ph.id)?.items_dispensed ?? 0;
        const avg = Math.round(
          subset.reduce((a, r) => a + r.items_dispensed, 0) / Math.max(1, subset.length)
        );
        return { label: `${MONTHS[m - 1]} ${String(y).slice(2)}`, mine, national: avg };
      });
      setSeries(points);

      // latest period stats
      const latest = periods[periods.length - 1];
      const [ly, lm] = latest.split("-").map(Number);
      const latestRows = rows.filter((r) => r.year === ly && r.month === lm);
      const mine = latestRows.find((r) => r.pharmacy_id === ph.id);
      const ranked = [...latestRows].sort((a, b) => b.items_dispensed - a.items_dispensed);
      const rank = ranked.findIndex((r) => r.pharmacy_id === ph.id) + 1;
      setStats({
        items: mine?.items_dispensed ?? 0,
        pf: mine?.pharmacy_first_count ?? 0,
        nms: mine?.nms_count ?? 0,
        rank,
        total: latestRows.length,
      });
      setPeerItems(latestRows.map((r) => r.items_dispensed || 0));
      setPeerPf(latestRows.map((r) => r.pharmacy_first_count || 0));
    })();
  }, [user]);

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();
  const firstName = (profile?.full_name || "").split(" ")[0] || "there";

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader title={`${greeting}, ${firstName}`} subtitle="Here's how your pharmacy is performing." showBack={false} />

      {!pharmacy && (
        <div className="mb-6 rounded-lg border border-gold/40 bg-gold/10 p-4 text-sm">
          You haven't set your pharmacy yet.{" "}
          <Link to="/settings" className="font-semibold text-primary hover:underline">
            Set it in Settings
          </Link>{" "}
          to unlock benchmarking and personalised insights.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Items this month" value={stats.items.toLocaleString()} hint={pharmacy?.name} />
        <StatCard label="Pharmacy First" value={stats.pf.toLocaleString()} />
        <StatCard label="NMS" value={stats.nms.toLocaleString()} />
        <StatCard
          label="National rank"
          value={stats.rank ? `#${stats.rank}` : "—"}
          hint={stats.total ? `of ${stats.total} pharmacies` : undefined}
        />
      </div>

      <div className="mt-6 rounded-lg bg-card border border-border p-6 shadow-sm">
        <h2 className="text-sm font-semibold mb-4">Items dispensed — last 12 months</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 5, right: 12, bottom: 0, left: -10 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="mine" name="My pharmacy" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="national" name="National avg" stroke="var(--chart-1)" strokeWidth={2} dot={false} strokeDasharray="4 4" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link to="/compare" className="group rounded-xl bg-card border border-border p-5 shadow-sm hover:border-foreground/40 hover:shadow-md transition-all">
          <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            <GitCompare className="h-4.5 w-4.5" />
          </div>
          <p className="mt-3 font-semibold text-sm">Compare pharmacies</p>
          <p className="text-xs text-muted-foreground mt-1">Side-by-side, up to 4 at once</p>
        </Link>
        <Link to="/leaderboards" className="group rounded-xl bg-card border border-border p-5 shadow-sm hover:border-foreground/40 hover:shadow-md transition-all">
          <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            <Trophy className="h-4.5 w-4.5" />
          </div>
          <p className="mt-3 font-semibold text-sm">Leaderboards</p>
          <p className="text-xs text-muted-foreground mt-1">Rank by service across the UK</p>
        </Link>
        <Link to="/benchmarking" className="group rounded-xl bg-card border border-border p-5 shadow-sm hover:border-foreground/40 hover:shadow-md transition-all">
          <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            <BarChart2 className="h-4.5 w-4.5" />
          </div>
          <p className="mt-3 font-semibold text-sm">Benchmarking</p>
          <p className="text-xs text-muted-foreground mt-1">Vs local & national peers</p>
        </Link>
        <Link to="/insights" className="group rounded-xl bg-card border border-border p-5 shadow-sm hover:border-foreground/40 hover:shadow-md transition-all">
          <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            <Sparkles className="h-4.5 w-4.5" />
          </div>
          <p className="mt-3 font-semibold text-sm">Smart Insights</p>
          <p className="text-xs text-muted-foreground mt-1">SWOT, gaps & commentary</p>
        </Link>
      </div>

      <Link to="/upload" className="mt-4 group flex items-center justify-between rounded-xl border border-dashed border-border bg-secondary/30 p-5 hover:border-foreground/40 hover:bg-secondary transition-colors">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-card border border-border flex items-center justify-center">
            <Upload className="h-4.5 w-4.5" />
          </div>
          <div>
            <p className="font-semibold text-sm">Upload private data</p>
            <p className="text-xs text-muted-foreground">GLP-1, aesthetics & more — stays in your private workspace</p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground group-hover:text-foreground">Open →</span>
      </Link>

      <DataAttribution />
    </div>
  );
}

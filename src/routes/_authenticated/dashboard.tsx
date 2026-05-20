import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatCard } from "@/components/PageHeader";
import { DataAttribution } from "@/components/DataAttribution";
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
import { Trophy, BarChart2, Upload } from "lucide-react";

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

      const { data: all } = await supabase
        .from("dispensing_data")
        .select("pharmacy_id,month,year,items_dispensed,nms_count,pharmacy_first_count");
      const rows = (all || []) as Row[];

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
    })();
  }, [user]);

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();
  const firstName = (profile?.full_name || "").split(" ")[0] || "there";

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader title={`${greeting}, ${firstName}`} subtitle="Here's how your pharmacy is performing." />

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

      <div className="mt-6 grid md:grid-cols-3 gap-4">
        <Link to="/leaderboards" className="rounded-lg bg-card border border-border p-5 shadow-sm hover:border-gold transition-colors">
          <Trophy className="h-5 w-5 text-gold" />
          <p className="mt-3 font-semibold text-sm">Leaderboards</p>
          <p className="text-xs text-muted-foreground mt-1">Rank by service across the UK</p>
        </Link>
        <Link to="/benchmarking" className="rounded-lg bg-card border border-border p-5 shadow-sm hover:border-gold transition-colors">
          <BarChart2 className="h-5 w-5 text-gold" />
          <p className="mt-3 font-semibold text-sm">Benchmarking</p>
          <p className="text-xs text-muted-foreground mt-1">Compare vs local & national peers</p>
        </Link>
        <Link to="/upload" className="rounded-lg bg-card border border-border p-5 shadow-sm hover:border-gold transition-colors">
          <Upload className="h-5 w-5 text-gold" />
          <p className="mt-3 font-semibold text-sm">Upload private data</p>
          <p className="text-xs text-muted-foreground mt-1">GLP-1, aesthetics & more</p>
        </Link>
      </div>

      <DataAttribution />
    </div>
  );
}

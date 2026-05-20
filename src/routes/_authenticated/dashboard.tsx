import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader, StatCard } from "@/components/PageHeader";
import { DataAttribution } from "@/components/DataAttribution";
import {
  PercentileRail,
  AnnotatedSparkline,
  ShareDonut,
  DistributionStrip,
} from "@/components/Infographics";
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
const periodKey = (y: number, m: number) => y * 12 + (m - 1);
const labelFor = (y: number, m: number) => `${MONTHS[m - 1]} ${String(y).slice(2)}`;

type Pharmacy = { id: string; name: string; region: string | null; country: string | null };
type Row = {
  pharmacy_id: string; month: number; year: number;
  items_dispensed: number; nms_count: number; pharmacy_first_count: number;
  pharmacy_first_payment: number; mcr_payment: number; smoking_cessation_payment: number;
  final_payment: number; gross_cost: number;
};

function Dashboard() {
  const { user, profile } = useAuth();
  const [pharmacy, setPharmacy] = useState<Pharmacy | null>(null);
  const [loading, setLoading] = useState(true);
  const [series, setSeries] = useState<{ label: string; mine: number; national: number }[]>([]);
  const [pfSeries, setPfSeries] = useState<{ period: string; value: number }[]>([]);
  const [stats, setStats] = useState({ items: 0, pf: 0, nms: 0, rank: 0, total: 0, period: "" });
  const [peerItems, setPeerItems] = useState<number[]>([]);
  const [peerPf, setPeerPf] = useState<number[]>([]);
  const [revenueMix, setRevenueMix] = useState<{ label: string; value: number }[]>([]);
  const [countrySplit, setCountrySplit] = useState<{ label: string; value: number }[]>([]);
  const [nationalTrend, setNationalTrend] = useState<{ period: string; value: number }[]>([]);

  useEffect(() => {
    (async () => {
      if (!user) return;
      setLoading(true);

      const { data: up } = await supabase
        .from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle();

      let ph: Pharmacy | null = null;
      if (up) {
        const { data } = await supabase
          .from("pharmacies").select("id,name,region,country").eq("id", up.pharmacy_id).maybeSingle();
        ph = (data as Pharmacy) || null;
      }
      setPharmacy(ph);

      // ---- National overview (always shown): latest period totals per country ----
      const { data: allPharm } = await supabase.from("pharmacies").select("id,country");
      const countryById = new Map<string, string>();
      (allPharm || []).forEach((p: any) => countryById.set(p.id, p.country || "Unknown"));

      // Pull last 24 months of compact data for the user's country (or all if none)
      const targetCountry = ph?.country || "Scotland";
      const peerIds = (allPharm || []).filter((p: any) => p.country === targetCountry).map((p: any) => p.id);

      const recent = await fetchAll<Row>((from, to) =>
        supabase
          .from("dispensing_data")
          .select(
            "pharmacy_id,month,year,items_dispensed,nms_count,pharmacy_first_count,pharmacy_first_payment,mcr_payment,smoking_cessation_payment,final_payment,gross_cost",
          )
          .in("pharmacy_id", peerIds.length ? peerIds : ["00000000-0000-0000-0000-000000000000"])
          .order("year", { ascending: false })
          .order("month", { ascending: false })
          .range(from, to),
      );

      // Group by period
      const byPeriod = new Map<number, Row[]>();
      recent.forEach((r) => {
        const k = periodKey(r.year, r.month);
        if (!byPeriod.has(k)) byPeriod.set(k, []);
        byPeriod.get(k)!.push(r);
      });
      const periods = [...byPeriod.keys()].sort((a, b) => a - b).slice(-24);

      // Build mine vs national series (last 12 of those)
      const last12 = periods.slice(-12);
      const points = last12.map((k) => {
        const rows = byPeriod.get(k)!;
        const y = Math.floor(k / 12); const m = (k % 12) + 1;
        const mine = ph ? rows.find((r) => r.pharmacy_id === ph!.id)?.items_dispensed ?? 0 : 0;
        const avg = Math.round(rows.reduce((a, r) => a + (r.items_dispensed || 0), 0) / Math.max(1, rows.length));
        return { label: labelFor(y, m), mine, national: avg };
      });
      setSeries(points);

      // PF sparkline for mine (or country avg)
      setPfSeries(
        last12.map((k) => {
          const rows = byPeriod.get(k)!;
          const y = Math.floor(k / 12); const m = (k % 12) + 1;
          const v = ph
            ? rows.find((r) => r.pharmacy_id === ph!.id)?.pharmacy_first_count ?? 0
            : Math.round(rows.reduce((a, r) => a + (r.pharmacy_first_count || 0), 0) / Math.max(1, rows.length));
          return { period: labelFor(y, m), value: v };
        }),
      );

      // Pick latest period where this pharmacy actually reported (non-zero items)
      let latestKey = periods[periods.length - 1];
      if (ph) {
        for (let i = periods.length - 1; i >= 0; i--) {
          const r = byPeriod.get(periods[i])!.find((x) => x.pharmacy_id === ph!.id);
          if (r && (r.items_dispensed || 0) > 0) { latestKey = periods[i]; break; }
        }
      }
      const latestRows = byPeriod.get(latestKey) || [];
      const ly = Math.floor(latestKey / 12); const lm = (latestKey % 12) + 1;
      const mineRow = ph ? latestRows.find((r) => r.pharmacy_id === ph.id) : undefined;
      const ranked = [...latestRows].sort((a, b) => (b.items_dispensed || 0) - (a.items_dispensed || 0));
      const rank = ph ? ranked.findIndex((r) => r.pharmacy_id === ph.id) + 1 : 0;
      setStats({
        items: mineRow?.items_dispensed ?? 0,
        pf: mineRow?.pharmacy_first_count ?? 0,
        nms: mineRow?.nms_count ?? 0,
        rank,
        total: latestRows.length,
        period: labelFor(ly, lm),
      });
      setPeerItems(latestRows.map((r) => r.items_dispensed || 0));
      setPeerPf(latestRows.map((r) => r.pharmacy_first_count || 0));

      // Revenue mix donut (mine if available, else country totals at latest)
      const source = mineRow ? [mineRow] : latestRows;
      const sum = (k: keyof Row) => source.reduce((a, r) => a + (Number(r[k]) || 0), 0);
      const pf = sum("pharmacy_first_payment");
      const mcr = sum("mcr_payment");
      const smk = sum("smoking_cessation_payment");
      const final = sum("final_payment");
      const other = Math.max(0, final - pf - mcr - smk);
      setRevenueMix([
        { label: "Pharmacy First", value: pf },
        { label: "MCR", value: mcr },
        { label: "Smoking cessation", value: smk },
        { label: "Dispensing & other", value: other },
      ]);

      // Country split donut — total items at latest period across all countries
      const { data: latestAll } = await supabase
        .from("dispensing_data")
        .select("pharmacy_id,items_dispensed,year,month")
        .eq("year", ly).eq("month", lm);
      const split = new Map<string, number>();
      (latestAll || []).forEach((r: any) => {
        const c = countryById.get(r.pharmacy_id) || "Unknown";
        split.set(c, (split.get(c) || 0) + (r.items_dispensed || 0));
      });
      setCountrySplit([...split.entries()].map(([label, value]) => ({ label, value })));

      // National trend (all countries) — total items per period last 12
      const natByPeriod = new Map<number, number>();
      // re-use peer recent doesn't have all countries; use a lightweight national query
      const { data: nat } = await supabase
        .from("dispensing_data")
        .select("year,month,items_dispensed");
      (nat || []).forEach((r: any) => {
        const k = periodKey(r.year, r.month);
        natByPeriod.set(k, (natByPeriod.get(k) || 0) + (r.items_dispensed || 0));
      });
      const natKeys = [...natByPeriod.keys()].sort((a, b) => a - b).slice(-12);
      setNationalTrend(
        natKeys.map((k) => {
          const y = Math.floor(k / 12); const m = (k % 12) + 1;
          return { period: labelFor(y, m), value: natByPeriod.get(k) || 0 };
        }),
      );

      setLoading(false);
    })();
  }, [user]);

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();
  const firstName = (profile?.full_name || "").split(" ")[0] || "there";
  const gbp = (n: number) => `£${Math.round(n).toLocaleString()}`;

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        title={`${greeting}, ${firstName}`}
        subtitle={
          pharmacy
            ? `${pharmacy.name} · latest reporting period: ${stats.period || "—"}`
            : "Here's the national picture. Set your pharmacy to unlock personalised benchmarks."
        }
        showBack={false}
      />

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
        <StatCard label={`Items · ${stats.period || "latest"}`} value={stats.items.toLocaleString()} hint={pharmacy?.name} />
        <StatCard label="Pharmacy First" value={stats.pf.toLocaleString()} />
        <StatCard label="NMS" value={stats.nms.toLocaleString()} />
        <StatCard
          label={`${pharmacy?.country || "Country"} rank`}
          value={stats.rank ? `#${stats.rank}` : "—"}
          hint={stats.total ? `of ${stats.total} pharmacies` : undefined}
        />
      </div>

      <div className="mt-6 rounded-lg bg-card border border-border p-6 shadow-sm">
        <h2 className="text-sm font-semibold mb-1">Items dispensed — last 12 months</h2>
        <p className="text-xs text-muted-foreground mb-4">
          {pharmacy ? `Your pharmacy vs ${pharmacy.country || "national"} average` : "National average per pharmacy"}
        </p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 5, right: 12, bottom: 0, left: -10 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {pharmacy && (
                <Line type="monotone" dataKey="mine" name="My pharmacy" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
              )}
              <Line type="monotone" dataKey="national" name={`${pharmacy?.country || "National"} avg`} stroke="var(--chart-1)" strokeWidth={2} dot={false} strokeDasharray={pharmacy ? "4 4" : undefined} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {pharmacy && peerItems.length > 0 && (
        <div className="mt-6 grid md:grid-cols-2 gap-4">
          <PercentileRail
            label={`Items dispensed · ${stats.period}`}
            value={stats.items}
            values={peerItems}
            peerLabel={`${pharmacy.country || "Country"} avg`}
            nationalLabel="Highest"
            caption={`Your pharmacy versus ${peerItems.length.toLocaleString()} reporting peers in ${pharmacy.country}.`}
          />
          <PercentileRail
            label={`Pharmacy First · ${stats.period}`}
            value={stats.pf}
            values={peerPf}
            peerLabel={`${pharmacy.country || "Country"} avg`}
            nationalLabel="Highest"
            caption="Clinical consultations delivered through the Pharmacy First pathway."
          />
        </div>
      )}

      <div className="mt-6 grid md:grid-cols-2 gap-4">
        {pfSeries.length >= 6 && (
          <AnnotatedSparkline
            label={pharmacy ? "Pharmacy First — your 12-month arc" : "Pharmacy First — national arc"}
            points={pfSeries}
          />
        )}
        {nationalTrend.length >= 6 && (
          <AnnotatedSparkline
            label="UK items dispensed — total across reporting pharmacies"
            points={nationalTrend}
          />
        )}
      </div>

      {peerItems.length > 8 && (
        <div className="mt-6">
          <DistributionStrip
            label={`How ${pharmacy?.country || "the country"} dispenses — ${stats.period}`}
            values={peerItems}
            highlightValue={pharmacy ? stats.items : undefined}
            highlightLabel={pharmacy?.name}
            caption="Each bar is a band of pharmacies grouped by monthly items dispensed."
          />
        </div>
      )}

      <div className="mt-6 grid md:grid-cols-2 gap-4">
        {revenueMix.some((s) => s.value > 0) && (
          <ShareDonut
            label={pharmacy ? `Revenue mix · ${stats.period}` : `${pharmacy ? "" : "Country "}revenue mix · ${stats.period}`}
            segments={revenueMix}
            caption={
              pharmacy
                ? "Composition of the pharmacy's reported income at the latest period."
                : "Composition of total reported income across the country at the latest period."
            }
            formatValue={gbp}
          />
        )}
        {countrySplit.some((s) => s.value > 0) && (
          <ShareDonut
            label={`UK dispensing share · ${stats.period}`}
            segments={countrySplit}
            caption="Share of items dispensed across the four UK nations at the latest period reported."
          />
        )}
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

      {loading && <p className="mt-4 text-xs text-muted-foreground">Loading latest data…</p>}

      <DataAttribution />
    </div>
  );
}

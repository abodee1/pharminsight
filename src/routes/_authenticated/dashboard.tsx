import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { getLatestSubstantialPeriod } from "@/lib/latestPeriod";
import { PageHeader, StatCard } from "@/components/PageHeader";
import { DataAttribution } from "@/components/DataAttribution";
import {
  PercentileRail,
  AnnotatedSparkline,
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
const labelFor = (y: number, m: number) => `${MONTHS[m - 1]} ${String(y).slice(2)}`;

type Pharmacy = { id: string; name: string; region: string | null; country: string | null };
type Row = {
  pharmacy_id: string; month: number; year: number;
  items_dispensed: number; nms_count: number; pharmacy_first_count: number;
  pharmacy_first_payment: number; mcr_payment: number; smoking_cessation_payment: number;
  final_payment: number; gross_cost: number; is_actual_payment: boolean;
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

  useEffect(() => {
    (async () => {
      if (!user) return;
      setLoading(true);

      // 1. Get user's pharmacy
      const { data: up } = await supabase
        .from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle();

      let ph: Pharmacy | null = null;
      if (up) {
        const { data } = await supabase
          .from("pharmacies").select("id,name,region,country").eq("id", up.pharmacy_id).maybeSingle();
        ph = (data as Pharmacy) || null;
      }
      setPharmacy(ph);

      // 2. Latest substantive period
      const latestPeriod = await getLatestSubstantialPeriod();
      const endY = latestPeriod?.year ?? new Date().getFullYear();
      const endM = latestPeriod?.month ?? new Date().getMonth() + 1;
      const startKey = endY * 12 + (endM - 1) - 12;
      const startY = Math.floor(startKey / 12);
      const startM = (startKey % 12) + 1;

      // 3. Parallel: user pharmacy 13mo + country aggregates + latest period country snapshot
      const targetCountry = ph?.country || null;

      const myRowsP = ph
        ? supabase
            .from("dispensing_data")
            .select(
              "pharmacy_id,month,year,items_dispensed,nms_count,pharmacy_first_count,pharmacy_first_payment,mcr_payment,smoking_cessation_payment,final_payment,gross_cost,is_actual_payment",
            )
            .eq("pharmacy_id", ph.id)
            .or(`and(year.gt.${startY}),and(year.eq.${startY},month.gte.${startM})`)
            .or(`and(year.lt.${endY}),and(year.eq.${endY},month.lte.${endM})`)
            .order("year", { ascending: true })
            .order("month", { ascending: true })
        : Promise.resolve({ data: [] as Row[], error: null });

      const aggP = supabase.rpc("country_monthly_aggregates", {
        p_country: targetCountry,
        p_start_year: startY,
        p_start_month: startM,
        p_end_year: endY,
        p_end_month: endM,
      });

      // Latest period country snapshot for rank/distribution. Paginate but
      // filter by country first so it's ~1-2k rows (Scotland), not 12k.
      const latestSnapP = fetchAll<Row>((from, to) =>
        supabase
          .from("dispensing_data")
          .select(
            "pharmacy_id,month,year,items_dispensed,nms_count,pharmacy_first_count,pharmacy_first_payment,mcr_payment,smoking_cessation_payment,final_payment,gross_cost,is_actual_payment",
          )
          .eq("year", endY)
          .eq("month", endM)
          .range(from, to),
      );

      const [myRowsRes, aggRes, latestSnapAll] = await Promise.all([
        myRowsP,
        aggP,
        latestSnapP,
      ]);

      const myRows = (myRowsRes.data || []) as Row[];
      const agg = (aggRes.data || []) as Array<{
        year: number; month: number; pharmacy_count: number;
        avg_items: number; avg_pf: number; avg_nms: number; total_items: number;
      }>;

      // For country rank we need country pharmacies. If no pharmacy chosen, fall back to all.
      let latestSnap = latestSnapAll;
      if (targetCountry) {
        const { data: countryPharms } = await supabase
          .from("pharmacies")
          .select("id")
          .eq("country", targetCountry);
        const ids = new Set((countryPharms || []).map((p) => p.id));
        latestSnap = latestSnapAll.filter((r) => ids.has(r.pharmacy_id));
      }

      // Mine vs country avg trend (last 12 months from agg)
      const last12Agg = agg.slice(-12);
      const myByKey = new Map<number, Row>();
      myRows.forEach((r) => myByKey.set(r.year * 12 + (r.month - 1), r));
      const points = last12Agg.map((a) => {
        const k = a.year * 12 + (a.month - 1);
        return {
          label: labelFor(a.year, a.month),
          mine: myByKey.get(k)?.items_dispensed ?? 0,
          national: Math.round(Number(a.avg_items) || 0),
        };
      });
      setSeries(points);

      // PF sparkline — user pharmacy if available, otherwise country avg
      setPfSeries(
        last12Agg.map((a) => {
          const k = a.year * 12 + (a.month - 1);
          const v = ph
            ? myByKey.get(k)?.pharmacy_first_count ?? 0
            : Math.round(Number(a.avg_pf) || 0);
          return { period: labelFor(a.year, a.month), value: v };
        }),
      );

      // Latest period stats — prefer pharmacy's most recent confirmed row,
      // else its most recent provisional row.
      let mineRow: Row | undefined;
      if (myRows.length) {
        mineRow =
          [...myRows].reverse().find((r) => r.is_actual_payment) ??
          myRows[myRows.length - 1];
      }
      const statY = mineRow?.year ?? endY;
      const statM = mineRow?.month ?? endM;

      const ranked = [...latestSnap].sort(
        (a, b) => (b.items_dispensed || 0) - (a.items_dispensed || 0),
      );
      const rank = ph ? ranked.findIndex((r) => r.pharmacy_id === ph.id) + 1 : 0;
      setStats({
        items: mineRow?.items_dispensed ?? 0,
        pf: mineRow?.pharmacy_first_count ?? 0,
        nms: mineRow?.nms_count ?? 0,
        rank,
        total: latestSnap.length,
        period: labelFor(statY, statM),
      });
      setPeerItems(latestSnap.map((r) => r.items_dispensed || 0));
      setPeerPf(latestSnap.map((r) => r.pharmacy_first_count || 0));

      // Revenue mix (user pharmacy latest row, else country totals at latest)
      const source: Row[] = mineRow ? [mineRow] : latestSnap;
      const sum = (k: keyof Row) =>
        source.reduce((a, r) => a + (Number(r[k]) || 0), 0);
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

      setLoading(false);
    })();
  }, [user]);

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();
  const firstName = (profile?.full_name || "").split(" ")[0] || "there";

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto animate-fade-in">
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
                <Line type="monotone" dataKey="mine" name="My pharmacy" stroke="var(--cmp-1)" strokeWidth={2} dot={false} />
              )}
              <Line type="monotone" dataKey="national" name={`${pharmacy?.country || "National"} avg`} stroke="var(--cmp-2)" strokeWidth={2} dot={false} strokeDasharray={pharmacy ? "4 4" : undefined} />
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
            caption={pharmacy ? "Your monthly Pharmacy First consultations over the last year, with peak and trough highlighted." : "Average Pharmacy First consultations per reporting pharmacy across the country."}
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

      <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link to="/compare" className="group rounded-xl bg-card border border-border p-5 shadow-sm hover:border-foreground/40 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
          <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            <GitCompare className="h-4.5 w-4.5" />
          </div>
          <p className="mt-3 font-semibold text-sm">Compare pharmacies</p>
          <p className="text-xs text-muted-foreground mt-1">Side-by-side, up to 4 at once</p>
        </Link>
        <Link to="/leaderboards" className="group rounded-xl bg-card border border-border p-5 shadow-sm hover:border-foreground/40 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
          <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            <Trophy className="h-4.5 w-4.5" />
          </div>
          <p className="mt-3 font-semibold text-sm">Leaderboards</p>
          <p className="text-xs text-muted-foreground mt-1">Rank by service across the UK</p>
        </Link>
        <Link to="/benchmarking" className="group rounded-xl bg-card border border-border p-5 shadow-sm hover:border-foreground/40 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
          <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            <BarChart2 className="h-4.5 w-4.5" />
          </div>
          <p className="mt-3 font-semibold text-sm">Benchmarking</p>
          <p className="text-xs text-muted-foreground mt-1">Vs local & national peers</p>
        </Link>
        <Link to="/insights" className="group rounded-xl bg-card border border-border p-5 shadow-sm hover:border-foreground/40 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
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
      {revenueMix.length === 0 && null}
    </div>
  );
}

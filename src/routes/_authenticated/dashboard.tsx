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
import { Trophy, BarChart2, GitCompare } from "lucide-react";

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
  const [stats, setStats] = useState({ items: 0, pf: 0, nms: 0, rank: 0, total: 0, period: "", pfPeriod: "", nmsPeriod: "" });
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
        p_country: targetCountry as string,
        p_start_year: startY,
        p_start_month: startM,
        p_end_year: endY,
        p_end_month: endM,
      });

      const [myRowsRes, aggRes] = await Promise.all([myRowsP, aggP]);

      const myRows = (myRowsRes.data || []) as Row[];
      const agg = (aggRes.data || []) as Array<{
        year: number; month: number; pharmacy_count: number;
        avg_items: number; avg_pf: number; avg_nms: number; total_items: number;
      }>;

      // Stats period: user's latest row with any reported activity (skip
      // trailing partial/preview months). This matches the pharmacy profile
      // and compare pages, so the headline period is the same everywhere.
      let mineRow: Row | undefined;
      if (myRows.length) {
        for (let i = myRows.length - 1; i >= 0; i--) {
          const r = myRows[i];
          if (r.items_dispensed > 0 || r.pharmacy_first_count > 0 || r.nms_count > 0) {
            mineRow = r;
            break;
          }
        }
        if (!mineRow) mineRow = myRows[myRows.length - 1];
      }
      const statY = mineRow?.year ?? endY;
      const statM = mineRow?.month ?? endM;
      const statKey = statY * 12 + (statM - 1);

      // Country pharmacy ids (paginate — Scotland has >1000)
      let countryPharmIds = new Set<string>();
      if (targetCountry) {
        const cp = await fetchAll<{ id: string }>((from, to) =>
          supabase.from("pharmacies").select("id").eq("country", targetCountry).range(from, to),
        );
        countryPharmIds = new Set(cp.map((p) => p.id));
      }

      // Snapshot for rank/distribution — use stat period so user is included
      const snapAll = await fetchAll<Row>((from, to) =>
        supabase
          .from("dispensing_data")
          .select(
            "pharmacy_id,month,year,items_dispensed,nms_count,pharmacy_first_count,pharmacy_first_payment,mcr_payment,smoking_cessation_payment,final_payment,gross_cost,is_actual_payment",
          )
          .eq("year", statY)
          .eq("month", statM)
          .range(from, to),
      );
      const latestSnap = targetCountry
        ? snapAll.filter((r) => countryPharmIds.has(r.pharmacy_id))
        : snapAll;

      // Cap aggregates to statKey so we never show months past user's latest data
      const cappedAgg = agg.filter((a) => a.year * 12 + (a.month - 1) <= statKey);
      const last12Agg = cappedAgg.slice(-12);
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

      // PF sparkline — trim trailing zeros/missing for clean arc
      const pfRaw = last12Agg.map((a) => {
        const k = a.year * 12 + (a.month - 1);
        const myRow = myByKey.get(k);
        const hasMine = !!myRow;
        const v = ph
          ? myRow?.pharmacy_first_count ?? 0
          : Math.round(Number(a.avg_pf) || 0);
        return { period: labelFor(a.year, a.month), value: v, hasMine };
      });
      let endIdx = pfRaw.length;
      while (endIdx > 0) {
        const e = pfRaw[endIdx - 1];
        if ((ph && !e.hasMine) || !e.value || e.value <= 0) endIdx--;
        else break;
      }
      setPfSeries(pfRaw.slice(0, endIdx).map(({ period, value }) => ({ period, value })));

      const ranked = [...latestSnap].sort(
        (a, b) => (b.items_dispensed || 0) - (a.items_dispensed || 0),
      );
      const rank = ph ? ranked.findIndex((r) => r.pharmacy_id === ph.id) + 1 : 0;

      // For PF and NMS, fall back to the latest month with reported activity
      // (Scottish PF / NMS reporting lags items-dispensed by 1-2 months).
      let pfRow: Row | undefined;
      let nmsRow: Row | undefined;
      for (let i = myRows.length - 1; i >= 0; i--) {
        if (!pfRow && (myRows[i].pharmacy_first_count || 0) > 0) pfRow = myRows[i];
        if (!nmsRow && (myRows[i].nms_count || 0) > 0) nmsRow = myRows[i];
        if (pfRow && nmsRow) break;
      }

      setStats({
        items: mineRow?.items_dispensed ?? 0,
        pf: pfRow?.pharmacy_first_count ?? 0,
        nms: nmsRow?.nms_count ?? 0,
        rank,
        total: latestSnap.length,
        period: labelFor(statY, statM),
        pfPeriod: pfRow ? labelFor(pfRow.year, pfRow.month) : "",
        nmsPeriod: nmsRow ? labelFor(nmsRow.year, nmsRow.month) : "",
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
      </div>




      {loading && <p className="mt-4 text-xs text-muted-foreground">Loading latest data…</p>}

      <DataAttribution />
      {revenueMix.length === 0 && null}
    </div>
  );
}

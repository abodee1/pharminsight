import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
  ShareDonut,
  TrendCard,
  GpPrescribingCard,
  MetricSpotlight,
  ServiceIntensityCard,
  type PeriodWindow,
  type SpotlightMetric,
  type IntensityRate,
} from "@/components/Infographics";
import { LocalLandscape } from "@/components/LocalLandscape";

import {
  Trophy, BarChart2, GitCompare, Package, Stethoscope, ClipboardCheck, Medal,
  PoundSterling, Wallet, TrendingUp, TrendingDown, Cigarette,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Dashboard });

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const labelFor = (y: number, m: number) => `${MONTHS[m - 1]} ${String(y).slice(2)}`;
const money = (n: number) => `£${Math.round(n).toLocaleString()}`;

type Pharmacy = { id: string; ods_code: string; name: string; region: string | null; country: string | null; postcode: string | null; address: string | null };
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
  const [trendWindow, setTrendWindow] = useState<PeriodWindow>(12);

  // 24-month trend rows for the user pharmacy + country aggregates, keyed by year-month
  const [myByKey, setMyByKey] = useState<Map<number, Row>>(new Map());
  const [aggByKey, setAggByKey] = useState<
    Map<number, { avg_items: number; avg_pf: number; avg_nms: number }>
  >(new Map());
  const [trendKeys, setTrendKeys] = useState<number[]>([]); // sorted ascending

  // Headline stats / cohort snapshots
  const [stats, setStats] = useState({
    items: 0, pf: 0, nms: 0, rank: 0, total: 0,
    period: "", pfPeriod: "", nmsPeriod: "",
    finalPayment: 0, grossCost: 0, mcrPayment: 0, smkPayment: 0, payPeriod: "",
    itemsDelta: 0, // % vs country avg for the same month
    pfShareOfPeers: 0, // percentile 0..100 of PF vs peers
  });
  const [peerItems, setPeerItems] = useState<number[]>([]);
  const [peerPf, setPeerPf] = useState<number[]>([]);
  const [peerNms, setPeerNms] = useState<number[]>([]);
  const [peerFinalPay, setPeerFinalPay] = useState<number[]>([]);
  const [peerGrossCost, setPeerGrossCost] = useState<number[]>([]);
  const [peerPfPeriod, setPeerPfPeriod] = useState<string>("");
  const [intensityRates, setIntensityRates] = useState<IntensityRate[]>([]);
  const [revenueMix, setRevenueMix] = useState<{ label: string; value: number }[]>([]);

  useEffect(() => {
    (async () => {
      if (!user) return;
      setLoading(true);

      // 1. Resolve user's pharmacy
      const { data: up } = await supabase
        .from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle();

      let ph: Pharmacy | null = null;
      if (up) {
        const { data } = await supabase
          .from("pharmacies").select("id,ods_code,name,region,country,postcode,address").eq("id", up.pharmacy_id).maybeSingle();
        ph = (data as Pharmacy) || null;
      }
      setPharmacy(ph);

      // 2. Latest substantive period (anchors the trend window)
      const latestPeriod = await getLatestSubstantialPeriod();
      const endY = latestPeriod?.year ?? new Date().getFullYear();
      const endM = latestPeriod?.month ?? new Date().getMonth() + 1;
      const endKey = endY * 12 + (endM - 1);
      // Always fetch the trailing 24 months — fast + reliable, no fragile OR filters.
      const startKey = endKey - 23;
      const startY = Math.floor(startKey / 12);
      const startM = (startKey % 12) + 1;
      const targetCountry = ph?.country || null;

      // 3. Last 24 months for the user pharmacy (cheap — single pharmacy)
      const myRowsP = ph
        ? supabase
            .from("dispensing_data")
            .select("pharmacy_id,month,year,items_dispensed,nms_count,pharmacy_first_count,pharmacy_first_payment,mcr_payment,smoking_cessation_payment,final_payment,gross_cost,is_actual_payment")
            .eq("pharmacy_id", ph.id)
            .order("year", { ascending: false })
            .order("month", { ascending: false })
            .limit(36)
        : Promise.resolve({ data: [] as Row[], error: null });

      // 4. Country monthly aggregates over the same window
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

      // Build keyed maps + sorted key list
      const myMap = new Map<number, Row>();
      myRows.forEach((r) => myMap.set(r.year * 12 + (r.month - 1), r));
      const aggMap = new Map<number, { avg_items: number; avg_pf: number; avg_nms: number }>();
      agg.forEach((a) => aggMap.set(a.year * 12 + (a.month - 1), {
        avg_items: Number(a.avg_items) || 0,
        avg_pf: Number(a.avg_pf) || 0,
        avg_nms: Number(a.avg_nms) || 0,
      }));

      // 5. Pick stat period = user's latest row with any reported activity
      let mineRow: Row | undefined;
      if (myRows.length) {
        const sorted = [...myRows].sort(
          (a, b) => a.year * 12 + a.month - (b.year * 12 + b.month),
        );
        for (let i = sorted.length - 1; i >= 0; i--) {
          const r = sorted[i];
          if (r.items_dispensed > 0 || r.pharmacy_first_count > 0 || r.nms_count > 0) {
            mineRow = r; break;
          }
        }
        if (!mineRow) mineRow = sorted[sorted.length - 1];
      }
      const statY = mineRow?.year ?? endY;
      const statM = mineRow?.month ?? endM;
      const statKey = statY * 12 + (statM - 1);

      // Cap trend at user's latest reported activity so we never plot empty future months
      const cappedEnd = Math.min(endKey, statKey);
      const keys: number[] = [];
      for (let k = Math.max(startKey, cappedEnd - 23); k <= cappedEnd; k++) keys.push(k);
      setTrendKeys(keys);
      setMyByKey(myMap);
      setAggByKey(aggMap);

      // 6. Cohort snapshots for rank + distribution
      let countryPharmIds = new Set<string>();
      if (targetCountry) {
        const cp = await fetchAll<{ id: string }>((from, to) =>
          supabase.from("pharmacies").select("id").eq("country", targetCountry).range(from, to),
        );
        countryPharmIds = new Set(cp.map((p) => p.id));
      }
      const snapAll = await fetchAll<Row>((from, to) =>
        supabase
          .from("dispensing_data")
          .select("pharmacy_id,month,year,items_dispensed,nms_count,pharmacy_first_count,pharmacy_first_payment,mcr_payment,smoking_cessation_payment,final_payment,gross_cost,is_actual_payment")
          .eq("year", statY).eq("month", statM).range(from, to),
      );
      const latestSnap = targetCountry
        ? snapAll.filter((r) => countryPharmIds.has(r.pharmacy_id))
        : snapAll;

      const ranked = [...latestSnap].sort(
        (a, b) => (b.items_dispensed || 0) - (a.items_dispensed || 0),
      );
      const rank = ph ? ranked.findIndex((r) => r.pharmacy_id === ph.id) + 1 : 0;

      // PF / NMS / Payments often lag — find latest non-zero reported rows
      let pfRow: Row | undefined; let nmsRow: Row | undefined; let payRow: Row | undefined;
      const sortedMy = [...myRows].sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month));
      for (const r of sortedMy) {
        if (!pfRow && (r.pharmacy_first_count || 0) > 0) pfRow = r;
        if (!nmsRow && (r.nms_count || 0) > 0) nmsRow = r;
        if (!payRow && (Number(r.final_payment) || 0) > 0) payRow = r;
        if (pfRow && nmsRow && payRow) break;
      }

      // Country avg items for the same period (delta)
      const countryAvgItems = aggMap.get(statKey)?.avg_items ?? 0;
      const itemsDelta = countryAvgItems > 0 && mineRow
        ? Math.round(((mineRow.items_dispensed - countryAvgItems) / countryAvgItems) * 100)
        : 0;

      setStats({
        items: mineRow?.items_dispensed ?? 0,
        pf: pfRow?.pharmacy_first_count ?? 0,
        nms: nmsRow?.nms_count ?? 0,
        rank, total: latestSnap.length,
        period: labelFor(statY, statM),
        pfPeriod: pfRow ? labelFor(pfRow.year, pfRow.month) : "",
        nmsPeriod: nmsRow ? labelFor(nmsRow.year, nmsRow.month) : "",
        finalPayment: Number(payRow?.final_payment) || 0,
        grossCost: Number(payRow?.gross_cost ?? mineRow?.gross_cost) || 0,
        mcrPayment: Number(payRow?.mcr_payment) || 0,
        smkPayment: Number(payRow?.smoking_cessation_payment) || 0,
        payPeriod: payRow ? labelFor(payRow.year, payRow.month) : "",
        itemsDelta,
        pfShareOfPeers: 0, // computed below once peerPf is known
      });
      setPeerItems(latestSnap.map((r) => r.items_dispensed || 0));
      setPeerNms(latestSnap.map((r) => r.nms_count || 0));
      setPeerFinalPay(latestSnap.map((r) => Number(r.final_payment) || 0));
      setPeerGrossCost(latestSnap.map((r) => Number(r.gross_cost) || 0));

      // Service intensity — per 1,000 items rates for this pharmacy vs cohort
      const itemsArr = latestSnap.map((r) => r.items_dispensed || 0);
      const pfArr = latestSnap.map((r) => r.pharmacy_first_count || 0);
      const nmsArr = latestSnap.map((r) => r.nms_count || 0);
      const epsArr = latestSnap.map((r) => (r as Row & { eps_items?: number }).eps_items || 0);
      const rateArr = (num: number[], den: number[]) =>
        num.map((v, i) => (den[i] > 0 ? (v / den[i]) * 1000 : 0)).filter((v) => v > 0);
      const meanOf = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
      const topQuartileOf = (a: number[]) => {
        if (!a.length) return 0;
        const sorted = [...a].sort((x, y) => x - y);
        return sorted[Math.floor(sorted.length * 0.75)] || 0;
      };
      const myItems = mineRow?.items_dispensed || 0;
      const myPfCount = pfRow?.pharmacy_first_count || 0;
      const myPfItems = pfRow ? (myMap.get(pfRow.year * 12 + (pfRow.month - 1))?.items_dispensed || myItems) : myItems;
      const myNmsItems = nmsRow ? (myMap.get(nmsRow.year * 12 + (nmsRow.month - 1))?.items_dispensed || myItems) : myItems;
      const myEpsItems = (mineRow as (Row & { eps_items?: number }) | undefined)?.eps_items || 0;
      const pfRates = rateArr(pfArr, itemsArr);
      const nmsRates = rateArr(nmsArr, itemsArr);
      const epsRates = rateArr(epsArr, itemsArr);
      setIntensityRates([
        {
          key: "pf",
          label: "Pharmacy First",
          yourRate: myPfItems > 0 ? (myPfCount / myPfItems) * 1000 : 0,
          peerRate: meanOf(pfRates),
          topRate: topQuartileOf(pfRates),
        },
        {
          key: "nms",
          label: "NMS",
          yourRate: myNmsItems > 0 ? ((nmsRow?.nms_count || 0) / myNmsItems) * 1000 : 0,
          peerRate: meanOf(nmsRates),
          topRate: topQuartileOf(nmsRates),
        },
        {
          key: "eps",
          label: "EPS items",
          yourRate: myItems > 0 ? (myEpsItems / myItems) * 1000 : 0,
          peerRate: meanOf(epsRates),
          topRate: topQuartileOf(epsRates),
        },
      ]);

      const pfY = pfRow?.year ?? statY; const pfM = pfRow?.month ?? statM;
      if (pfY === statY && pfM === statM) {
        setPeerPf(latestSnap.map((r) => r.pharmacy_first_count || 0));
        setPeerPfPeriod(labelFor(statY, statM));
      } else {
        const pfSnapAll = await fetchAll<Row>((from, to) =>
          supabase
            .from("dispensing_data")
            .select("pharmacy_id,month,year,pharmacy_first_count,items_dispensed,nms_count,pharmacy_first_payment,mcr_payment,smoking_cessation_payment,final_payment,gross_cost,is_actual_payment")
            .eq("year", pfY).eq("month", pfM).range(from, to),
        );
        const pfSnap = targetCountry ? pfSnapAll.filter((r) => countryPharmIds.has(r.pharmacy_id)) : pfSnapAll;
        setPeerPf(pfSnap.map((r) => r.pharmacy_first_count || 0));
        setPeerPfPeriod(labelFor(pfY, pfM));
      }

      const source: Row[] = payRow ? [payRow] : mineRow ? [mineRow] : latestSnap;
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

  // Derive chart data from the keyed maps + selected window
  const itemsPoints = useMemo(
    () => trendKeys.map((k) => {
      const y = Math.floor(k / 12);
      const m = (k % 12) + 1;
      return {
        label: labelFor(y, m),
        value: myByKey.get(k)?.items_dispensed ?? 0,
        comparison: Math.round(aggByKey.get(k)?.avg_items ?? 0),
      };
    }),
    [trendKeys, myByKey, aggByKey],
  );

  const pfPoints = useMemo(
    () => trendKeys.map((k) => {
      const y = Math.floor(k / 12);
      const m = (k % 12) + 1;
      return {
        label: labelFor(y, m),
        value: pharmacy ? (myByKey.get(k)?.pharmacy_first_count ?? 0) : Math.round(aggByKey.get(k)?.avg_pf ?? 0),
      };
    }),
    [trendKeys, myByKey, aggByKey, pharmacy],
  );

  const costPoints = useMemo(
    () => trendKeys.map((k) => {
      const y = Math.floor(k / 12);
      const m = (k % 12) + 1;
      return {
        label: labelFor(y, m),
        value: Math.round(Number(myByKey.get(k)?.gross_cost) || 0),
      };
    }),
    [trendKeys, myByKey],
  );

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
        <StatCard
          label={`Items · ${stats.period || "latest"}`}
          value={stats.items.toLocaleString()}
          hint={pharmacy?.name}
          icon={Package}
          accent="indigo"
        />
        <StatCard
          label="Pharmacy First"
          value={stats.pf.toLocaleString()}
          hint={stats.pfPeriod && stats.pfPeriod !== stats.period ? `Latest reported · ${stats.pfPeriod}` : stats.pfPeriod || undefined}
          icon={Stethoscope}
          accent="emerald"
        />
        {pharmacy?.country?.toLowerCase() !== "scotland" && (
          <StatCard
            label="NMS"
            value={stats.nms.toLocaleString()}
            hint={stats.nmsPeriod && stats.nmsPeriod !== stats.period ? `Latest reported · ${stats.nmsPeriod}` : stats.nmsPeriod || undefined}
            icon={ClipboardCheck}
            accent="sky"
          />
        )}
        <StatCard
          label={`${pharmacy?.country || "Country"} rank`}
          value={stats.rank ? `#${stats.rank}` : "—"}
          hint={stats.total ? `of ${stats.total.toLocaleString()} pharmacies` : undefined}
          icon={stats.rank && stats.rank <= 10 ? Trophy : Medal}
          accent="amber"
        />
      </div>

      {pharmacy && (
        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label={`NHS revenue · ${stats.payPeriod || stats.period || "latest"}`}
            value={money(stats.finalPayment)}
            hint={stats.payPeriod && stats.payPeriod !== stats.period ? `Latest reported · ${stats.payPeriod}` : "Final payment after adjustments"}
            icon={PoundSterling}
            accent="emerald"
          />
          <StatCard
            label="Gross drug cost"
            value={money(stats.grossCost)}
            hint="Reimbursable spend"
            icon={Wallet}
            accent="indigo"
          />
          <StatCard
            label="vs country avg"
            value={`${stats.itemsDelta >= 0 ? "+" : ""}${stats.itemsDelta}%`}
            hint={`Items vs ${pharmacy.country || "national"} mean`}
            icon={stats.itemsDelta >= 0 ? TrendingUp : TrendingDown}
            accent={stats.itemsDelta >= 0 ? "emerald" : "amber"}
          />
          <StatCard
            label="Smoking cessation"
            value={money(stats.smkPayment)}
            hint={stats.mcrPayment > 0 ? `MCR ${money(stats.mcrPayment)}` : undefined}
            icon={Cigarette}
            accent="sky"
          />
        </div>
      )}

      {/* Primary trend — items dispensed, with adjustable window + country comparison */}
      <div className="mt-6">
        {itemsPoints.length > 0 ? (
          <TrendCard
            title="Items dispensed"
            subtitle={pharmacy ? `Your pharmacy vs ${pharmacy.country || "national"} average` : "National average per pharmacy"}
            points={itemsPoints}
            window={trendWindow}
            onWindowChange={setTrendWindow}
            comparisonLabel={pharmacy ? `${pharmacy.country || "National"} avg` : undefined}
            primaryLabel={pharmacy ? "My pharmacy" : "National avg"}
            caption="Trailing window of monthly prescription volume. Switch between 1M / 3M / 6M / 12M to zoom in or out."
            height={260}
          />
        ) : (
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm text-sm text-muted-foreground">
            {loading ? "Loading dispensing trend…" : "No dispensing rows reported yet."}
          </div>
        )}
      </div>

      {/* Secondary trends — share the same window */}
      <div className="mt-6 grid md:grid-cols-2 gap-4">
        {pfPoints.length > 0 && (
          <TrendCard
            title="Pharmacy First consultations"
            subtitle={pharmacy ? "Monthly walk-in clinical activity" : "National monthly average"}
            points={pfPoints}
            window={trendWindow}
            onWindowChange={setTrendWindow}
            caption="Walk-in consultations delivered through the Pharmacy First pathway."
          />
        )}
        {pharmacy && costPoints.length > 0 && (
          <TrendCard
            title="Gross drug cost"
            subtitle="Monthly reimbursable spend"
            points={costPoints}
            window={trendWindow}
            onWindowChange={setTrendWindow}
            formatValue={money}
            caption="Drug acquisition cost before clawback — a proxy for prescribing volume value."
          />
        )}
      </div>

      {/* Local GP prescribing — items dispensed against scripts from linked GPs */}
      {pharmacy && (
        <div className="mt-6">
          <GpPrescribingCard pharmacyOds={pharmacy.ods_code} />
        </div>
      )}

      {/* Local landscape — nearby competitor pharmacies & GP surgeries */}
      {pharmacy && (
        <LocalLandscape
          pharmacyName={pharmacy.name}
          postcode={pharmacy.postcode}
          address={pharmacy.address}
        />
      )}

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
            label={`Pharmacy First · ${peerPfPeriod || stats.period}`}
            value={stats.pf}
            values={peerPf}
            peerLabel={`${pharmacy.country || "Country"} avg`}
            nationalLabel="Highest"
            caption="Clinical consultations delivered through the Pharmacy First pathway."
          />
        </div>
      )}

      <div className="mt-6 grid md:grid-cols-2 gap-4">
        {itemsPoints.length >= 6 && (
          <AnnotatedSparkline
            label={pharmacy ? "Items dispensed — 12-month arc" : "Items dispensed — national arc"}
            points={itemsPoints.slice(-12).map((p) => ({ period: p.label, value: p.value }))}
            caption="Peak and trough months across the trailing year."
          />
        )}
        {revenueMix.length > 0 && revenueMix.some((s) => s.value > 0) && (
          <ShareDonut
            label={`Revenue mix · ${stats.period}`}
            segments={revenueMix}
            caption="How your latest month's NHS revenue breaks down across services and dispensing."
            formatValue={money}
          />
        )}
      </div>

      {pharmacy && peerItems.length > 8 && (() => {
        // Only surface metrics where the cohort actually has reported data.
        // Avoids showing "NHS revenue · £0" for countries that don't publish
        // payment data (England, Wales, NI) — where every peer value is 0.
        const hasData = (vals: number[]) =>
          vals.length > 0 && vals.some((v) => v > 0);
        const isScot = (pharmacy.country || "").toLowerCase() === "scotland";
        const raw: SpotlightMetric[] = [
          {
            key: "items",
            label: "Items",
            values: peerItems,
            yourValue: stats.items,
            period: stats.period,
          },
          {
            key: "pf",
            label: "Pharmacy First",
            values: peerPf,
            yourValue: stats.pf,
            period: peerPfPeriod || stats.period,
          },
          {
            key: "nms",
            label: "NMS",
            values: peerNms,
            yourValue: stats.nms,
            period: stats.nmsPeriod || stats.period,
          },
          // Payment metrics are only meaningful for Scotland (only country
          // publishing per-pharmacy verified payments). Hide elsewhere so
          // the chart never shows a flat 0 bar.
          ...(isScot
            ? [
                {
                  key: "final",
                  label: "NHS revenue",
                  values: peerFinalPay,
                  yourValue: stats.finalPayment,
                  period: stats.payPeriod || stats.period,
                  format: money,
                } as SpotlightMetric,
                {
                  key: "gross",
                  label: "Gross cost",
                  values: peerGrossCost,
                  yourValue: stats.grossCost,
                  period: stats.payPeriod || stats.period,
                  format: money,
                } as SpotlightMetric,
              ]
            : []),
        ];
        const metrics = raw.filter((m) => hasData(m.values));
        if (metrics.length === 0) return null;
        return (
          <div className="mt-6">
            <MetricSpotlight
              title={`Cohort spotlight — ${pharmacy.region || pharmacy.country || "your region"}`}
              highlightLabel={pharmacy.name}
              peerLabel={`${pharmacy.country || "Country"} avg`}
              caption="Switch metrics to see where you sit across reporting peers for the latest published period."
              metrics={metrics}
            />
          </div>
        );
      })()}

      {pharmacy && intensityRates.some((r) => r.topRate > 0) && (
        <div className="mt-6">
          <ServiceIntensityCard
            rates={intensityRates}
            caption="Toggle between Pharmacy First, NMS and EPS to see your normalised service take-up."
          />
        </div>
      )}

      {!pharmacy && peerItems.length > 8 && (
        <div className="mt-6">
          <DistributionStrip
            label={`How the country dispenses — ${stats.period}`}
            values={peerItems}
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
    </div>
  );
}

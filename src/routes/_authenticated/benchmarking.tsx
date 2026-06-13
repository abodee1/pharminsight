import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader } from "@/components/PageHeader";
import { DataAttribution } from "@/components/DataAttribution";
import { useAuth } from "@/hooks/useAuth";
import { PercentileRail, GpPrescribingCard } from "@/components/Infographics";
import { MarketShareSection } from "@/components/MarketShareSection";
import { PharmacySearch } from "@/components/PharmacySearch";
import { CountryBadge } from "@/components/CountryBadge";
import { Button } from "@/components/ui/button";
import { fmtGbpCompact } from "@/lib/utils";
import { getViewedPharmacy } from "@/lib/viewedPharmacy";
import { generateInsight } from "@/lib/insights.functions";
import { cn } from "@/lib/utils";
import { pharmacyDisplayName } from "@/lib/pharmacyName";

export const Route = createFileRoute("/_authenticated/benchmarking")({ component: Benchmarking });

type PeriodOpt = 1 | 3 | 6 | 12 | 18 | 24;
const PERIOD_OPTS: PeriodOpt[] = [1, 3, 6, 12, 18, 24];

type AggRow = {
  pharmacy_id: string;
  items_dispensed: number;
  eps_items: number;
  pharmacy_first_count: number;
  pharmacy_first_payment: number;
  nms_count: number;
  flu_vaccinations: number;
  methadone_items: number;
  mcr_registrations: number;
  gross_cost: number;
  final_payment: number;
  // count of months included (for per-month averages)
  _months: number;
};

function emptyAgg(id: string): AggRow {
  return { pharmacy_id: id, items_dispensed: 0, eps_items: 0, pharmacy_first_count: 0, pharmacy_first_payment: 0, nms_count: 0, flu_vaccinations: 0, methadone_items: 0, mcr_registrations: 0, gross_cost: 0, final_payment: 0, _months: 0 };
}

function addToAgg(agg: AggRow, row: any) {
  agg.items_dispensed    += Number(row.items_dispensed) || 0;
  agg.eps_items          += Number(row.eps_items) || 0;
  agg.pharmacy_first_count += Number(row.pharmacy_first_count) || 0;
  agg.pharmacy_first_payment += Number(row.pharmacy_first_payment) || 0;
  agg.nms_count          += Number(row.nms_count) || 0;
  agg.flu_vaccinations   += Number(row.flu_vaccinations) || 0;
  agg.methadone_items    += Number(row.methadone_items) || 0;
  agg.mcr_registrations  += Number(row.mcr_registrations) || 0;
  agg.gross_cost         += Number(row.gross_cost) || 0;
  agg.final_payment      += Number(row.final_payment) || 0;
  agg._months            += 1;
}

type MetricDef = {
  key: string;
  label: string;
  group: "volume" | "service" | "revenue" | "ratio";
  fmt: (n: number) => string;
  derive: (agg: AggRow) => number;
  description?: string;
  countries?: string[];
};

const fmtN  = (n: number) => Math.round(n).toLocaleString();
const fmtM  = (n: number) => "£" + Math.round(n).toLocaleString();
const fmtR  = (n: number) => n.toFixed(2);
const fmtP  = (n: number) => n.toFixed(1) + "%";
const fmtP2 = (n: number) => "£" + n.toFixed(2);

const METRICS: MetricDef[] = [
  // ── Volume ────────────────────────────────────────────────────────────
  { key: "items_dispensed", label: "Items dispensed", group: "volume",
    fmt: fmtN, derive: (a) => a.items_dispensed,
    description: "Total prescription items dispensed in the period." },
  { key: "eps_items", label: "EPS items", group: "volume", countries: ["England"],
    fmt: fmtN, derive: (a) => a.eps_items,
    description: "Items processed via Electronic Prescription Service." },
  { key: "flu_vaccinations", label: "Flu vaccinations", group: "volume",
    fmt: fmtN, derive: (a) => a.flu_vaccinations,
    description: "NHS flu jabs administered in the period." },

  // ── Clinical services ─────────────────────────────────────────────────
  { key: "pharmacy_first_count", label: "Pharmacy First consultations", group: "service",
    fmt: fmtN, derive: (a) => a.pharmacy_first_count,
    description: "Walk-in clinical consultations completed." },
  { key: "nms_count", label: "New Medicine Service", group: "service", countries: ["England"],
    fmt: fmtN, derive: (a) => a.nms_count,
    description: "NMS interventions delivered to patients starting new meds." },
  { key: "methadone_items", label: "Methadone items", group: "service", countries: ["Scotland"],
    fmt: fmtN, derive: (a) => a.methadone_items,
    description: "Supervised opioid substitution items." },
  { key: "mcr_registrations", label: "MCR registrations", group: "service", countries: ["Scotland"],
    fmt: fmtN, derive: (a) => a.mcr_registrations,
    description: "Patients registered for the Medicines: Care & Review service." },

  // ── Revenue ───────────────────────────────────────────────────────────
  { key: "gross_cost", label: "Gross drug cost", group: "revenue",
    fmt: fmtM, derive: (a) => a.gross_cost,
    description: "Reimbursable drug cost before clawback." },
  { key: "final_payment", label: "Final NHS payment", group: "revenue",
    fmt: fmtM, derive: (a) => a.final_payment,
    description: "Net payment received for the period." },
  { key: "pharmacy_first_payment", label: "Pharmacy First payment", group: "revenue",
    fmt: fmtM, derive: (a) => a.pharmacy_first_payment,
    description: "Total Pharmacy First remuneration." },

  // ── Ratios ────────────────────────────────────────────────────────────
  { key: "pf_per_100", label: "Pharmacy First per 100 items", group: "ratio",
    fmt: fmtR, derive: (a) => a.items_dispensed > 0 ? (a.pharmacy_first_count * 100) / a.items_dispensed : 0,
    description: "Clinical service intensity vs dispensing volume." },
  { key: "nms_per_100", label: "NMS per 100 items", group: "ratio", countries: ["England"],
    fmt: fmtR, derive: (a) => a.items_dispensed > 0 ? (a.nms_count * 100) / a.items_dispensed : 0,
    description: "How actively the team engages patients on new meds." },
  { key: "nms_cap", label: "NMS cap utilisation", group: "ratio", countries: ["England"],
    fmt: fmtP, derive: (a) => a.items_dispensed > 0 ? (a.nms_count / (a.items_dispensed * 0.01)) * 100 : 0,
    description: "NMS as % of the 1% monthly cap. Above 100% signals over-claiming risk." },
  { key: "revenue_per_item", label: "Revenue per item", group: "ratio",
    fmt: fmtP2, derive: (a) => a.items_dispensed > 0 ? a.final_payment / a.items_dispensed : 0,
    description: "Average NHS revenue earned per dispensed item." },
  { key: "eps_share", label: "EPS share", group: "ratio", countries: ["England"],
    fmt: fmtP, derive: (a) => a.items_dispensed > 0 ? (a.eps_items / a.items_dispensed) * 100 : 0,
    description: "Share of items processed via EPS. Above 95% is excellent." },
];

const GROUP_LABEL: Record<MetricDef["group"], string> = {
  volume: "Volume",
  service: "Clinical services",
  revenue: "Revenue & payments",
  ratio: "Efficiency ratios",
};

function Benchmarking() {
  const { user } = useAuth();
  const [pharmacy, setPharmacy] = useState<any>(null);
  const [pharmacyOverride, setPharmacyOverride] = useState<any>(null);
  const [myHistory, setMyHistory] = useState<any[]>([]);
  const [regionPharmIds, setRegionPharmIds] = useState<Set<string>>(new Set());
  const [countryPharmIds, setCountryPharmIds] = useState<Set<string>>(new Set());
  const [myAgg, setMyAgg] = useState<AggRow | null>(null);
  const [cohortAggs, setCohortAggs] = useState<AggRow[]>([]);
  const [regionAggs, setRegionAggs] = useState<AggRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodMonths, setPeriodMonths] = useState<PeriodOpt>(12);
  const [insightMd, setInsightMd] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const runInsight = useServerFn(generateInsight);

  // Load subject pharmacy
  useEffect(() => {
    if (pharmacyOverride) return;
    (async () => {
      if (!user) return;
      const viewed = getViewedPharmacy();
      let subjectId: string | null = viewed?.id ?? null;
      if (!subjectId) {
        const { data: up } = await supabase
          .from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle();
        subjectId = up?.pharmacy_id ?? null;
      }
      if (!subjectId) { setLoading(false); return; }
      const { data: ph } = await supabase
        .from("pharmacies").select("*").eq("id", subjectId).maybeSingle();
      if (ph) setPharmacy(ph);
      else setLoading(false);
    })();
  }, [user, pharmacyOverride]);

  useEffect(() => {
    if (!pharmacyOverride) return;
    (async () => {
      const { data: ph } = await supabase
        .from("pharmacies").select("*").eq("id", pharmacyOverride.id).maybeSingle();
      if (ph) setPharmacy(ph);
    })();
  }, [pharmacyOverride]);

  useEffect(() => { setInsightMd(null); }, [pharmacy?.id]);

  // Load my dispensing history (last 24 months)
  useEffect(() => {
    if (!pharmacy) return;
    (async () => {
      setLoading(true);
      const { data: hist } = await supabase
        .from("dispensing_data").select("*")
        .eq("pharmacy_id", pharmacy.id)
        .order("year", { ascending: false }).order("month", { ascending: false })
        .limit(24);
      setMyHistory(hist ?? []);

      // Load cohort pharmacy IDs
      const cohort = await fetchAll<any>((from, to) =>
        supabase.from("pharmacies").select("id,name,region,country")
          .eq("country", pharmacy.country ?? "")
          .order("id", { ascending: true }).range(from, to)
      );
      const countryIds = new Set(cohort.map((p: any) => p.id as string));
      const regionIds = new Set(cohort.filter((p: any) => p.region === pharmacy.region).map((p: any) => p.id as string));
      setCountryPharmIds(countryIds);
      setRegionPharmIds(regionIds);
    })();
  }, [pharmacy]);

  // When myHistory + periodMonths change: aggregate my data + fetch cohort for those months
  useEffect(() => {
    if (!myHistory.length || !countryPharmIds.size) return;
    let cancelled = false;

    (async () => {
      setLoading(true);

      // Get the last N months of MY data (sorted oldest→newest)
      const sorted = [...myHistory].sort((a, b) => (a.year - b.year) || (a.month - b.month));
      const mySlice = sorted.slice(-periodMonths);
      if (!mySlice.length) { setLoading(false); return; }

      // Aggregate MY data
      const me = emptyAgg(pharmacy?.id ?? "");
      mySlice.forEach(r => addToAgg(me, r));
      if (!cancelled) setMyAgg(me);

      // Fetch cohort data for those same months in parallel
      const monthKeys = mySlice.map(r => ({ year: r.year as number, month: r.month as number }));

      const monthlyData = await Promise.all(
        monthKeys.map(async ({ year, month }) => {
          const rows = await fetchAll<any>((from, to) =>
            supabase.from("dispensing_data")
              .select("pharmacy_id,items_dispensed,eps_items,nms_count,pharmacy_first_count,pharmacy_first_payment,flu_vaccinations,methadone_items,mcr_registrations,gross_cost,final_payment")
              .eq("year", year).eq("month", month)
              .order("id", { ascending: true }).range(from, to)
          );
          return rows.filter((r: any) => countryPharmIds.has(r.pharmacy_id));
        })
      );

      if (cancelled) return;

      // Aggregate cohort by pharmacy
      const pharmAggs = new Map<string, AggRow>();
      for (const monthRows of monthlyData) {
        for (const row of monthRows) {
          const agg = pharmAggs.get(row.pharmacy_id) ?? emptyAgg(row.pharmacy_id);
          addToAgg(agg, row);
          pharmAggs.set(row.pharmacy_id, agg);
        }
      }

      const allAggs = Array.from(pharmAggs.values());
      const regAggs = allAggs.filter(a => regionPharmIds.has(a.pharmacy_id));
      setCohortAggs(allAggs);
      setRegionAggs(regAggs);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [myHistory, periodMonths, countryPharmIds, regionPharmIds, pharmacy]);

  const analysis = useMemo(() => {
    if (!myAgg || !cohortAggs.length || !pharmacy) return null;

    const pharmCountry: string = pharmacy.country ?? "";
    const applicable = METRICS.filter(m => !m.countries || m.countries.includes(pharmCountry));

    const rows = applicable.map(m => {
      const mineVal = m.derive(myAgg);
      const cohortVals = cohortAggs.map(a => m.derive(a)).filter(v => isFinite(v) && v >= 0);
      const regVals   = regionAggs.map(a => m.derive(a)).filter(v => isFinite(v) && v >= 0);

      const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      const sorted = [...cohortVals].sort((a, b) => b - a);
      const top10n = Math.max(1, Math.ceil(sorted.length * 0.1));
      const top10   = avg(sorted.slice(0, top10n));
      const rank    = sorted.findIndex(v => v <= mineVal) + 1 || sorted.length;
      const percentile = cohortVals.length ? Math.round((1 - rank / cohortVals.length) * 100) : 0;

      return {
        metric: m,
        mineVal,
        myMonthlyAvg: myAgg._months > 0 ? mineVal / myAgg._months : mineVal,
        regionAvg: avg(regVals),
        countryAvg: avg(cohortVals),
        top10,
        regionVals: regVals,
        countryVals: cohortVals,
        rank,
        cohortSize: cohortVals.length,
        percentile,
      };
    }).filter(r => r.cohortSize > 0);

    const grouped: Record<string, any[]> = {};
    for (const r of rows) {
      (grouped[r.metric.group] ||= []).push(r);
    }
    return { rows, grouped };
  }, [myAgg, cohortAggs, regionAggs, pharmacy]);

  const periodLabel = periodMonths === 1 ? "Latest month" : `Trailing ${periodMonths} months`;
  const isRatio = (g: string) => g === "ratio";

  return (
    <div className="p-4 sm:p-6 md:p-10 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Benchmarking"
        subtitle="How any pharmacy compares against regional and national peers across volume, services, revenue and efficiency."
      />

      {/* Pharmacy switcher */}
      <div className="rounded-lg bg-card border border-border p-4 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="md:w-[420px] shrink-0">
            <PharmacySearch
              placeholder="Search any pharmacy by name, postcode or ODS code…"
              clearOnSelect
              onSelect={(p) => setPharmacyOverride(p)}
            />
          </div>
          {pharmacy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
              <span>Benchmarking</span>
              <span className="font-semibold text-foreground">{pharmacyDisplayName(pharmacy.name, pharmacy.trading_name)}</span>
              <CountryBadge country={pharmacy.country} />
              {pharmacyOverride && (
                <button type="button" onClick={() => { setPharmacyOverride(null); setPharmacy(null); }}
                  className="text-xs text-primary hover:underline">
                  Reset to my pharmacy
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {!pharmacy && !loading && (
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm text-sm">
          Search a pharmacy above, or{" "}
          <Link to="/settings" className="text-primary font-semibold hover:underline">
            set your default in Settings
          </Link>.
        </div>
      )}

      {pharmacy && (
        <>
          {/* ── Period toggle ──────────────────────────────────────────── */}
          <div className="rounded-lg bg-card border border-border p-3 sm:p-4 shadow-sm flex flex-wrap items-center gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Benchmark period</p>
              <div className="inline-flex rounded-md border border-border bg-secondary/40 p-0.5">
                {PERIOD_OPTS.map(n => (
                  <button key={n} type="button" onClick={() => setPeriodMonths(n)}
                    className={cn("px-2.5 py-1 text-[11px] font-semibold rounded transition-colors",
                      periodMonths === n ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}>
                    {n === 1 ? "1M" : `${n}M`}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-sm">
              <p className="font-medium">{periodLabel}</p>
              <p className="text-[11px] text-muted-foreground">
                All metrics show totals over this window. Ratios are period-weighted (not averaged).
              </p>
            </div>
          </div>

          {loading && (
            <div className="rounded-lg border border-border bg-card p-6 shadow-sm flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Crunching {periodLabel.toLowerCase()} benchmarks…
            </div>
          )}

          {!loading && analysis && analysis.rows.length === 0 && (
            <div className="rounded-lg border border-border bg-card p-6 shadow-sm text-sm text-muted-foreground">
              No reported activity in the last {periodMonths} months.
            </div>
          )}

          {!loading && analysis && analysis.rows.length > 0 && (
            <>
              {/* Context bar */}
              <div className="rounded-lg bg-card border border-border px-5 py-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-base font-semibold">{pharmacyDisplayName(pharmacy.name, pharmacy.trading_name)}</p>
                  <p className="text-sm text-muted-foreground">
                    {pharmacy.region} · {pharmacy.country} · {regionAggs.length.toLocaleString()} regional / {cohortAggs.length.toLocaleString()} national pharmacies
                  </p>
                </div>
                <div className="text-[11px] text-muted-foreground text-right">
                  <p>Cohort: pharmacies with data in the {periodLabel.toLowerCase()}</p>
                  <p>Rank 1 = highest · ratios are period-weighted averages</p>
                </div>
              </div>

              {/* Headline scoreboard — top 4 metrics */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {analysis.rows.slice(0, 4).map((r) => {
                  const vsRegion = r.regionAvg > 0 ? Math.round(((r.mineVal - r.regionAvg) / r.regionAvg) * 100) : 0;
                  const tone = vsRegion > 5 ? "text-emerald-700 dark:text-emerald-400" : vsRegion < -5 ? "text-rose-600" : "text-muted-foreground";
                  return (
                    <div key={r.metric.key} className="rounded-lg bg-card border border-border p-5 shadow-sm">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.metric.label}</p>
                      <p className="mt-1 text-2xl font-bold tabular-nums">{r.metric.fmt(r.mineVal)}</p>
                      <p className={`mt-1 text-xs font-medium ${tone}`}>
                        {vsRegion >= 0 ? "+" : ""}{vsRegion}% vs {pharmacy.region} avg
                      </p>
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        #{r.rank.toLocaleString()} of {r.cohortSize.toLocaleString()} in {pharmacy.country} · {r.percentile}th %ile
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* GP prescribing */}
              {pharmacy.ods_code && (
                <section>
                  <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">GP practice activity</h2>
                  <GpPrescribingCard pharmacyOds={pharmacy.ods_code} />
                </section>
              )}

              {/* Market share */}
              {pharmacy.id && pharmacy.ods_code && (
                <section>
                  <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Market position</h2>
                  <MarketShareSection
                    pharmacyId={pharmacy.id} pharmacyOds={pharmacy.ods_code}
                    pharmacyName={pharmacyDisplayName(pharmacy.name, pharmacy.trading_name)} lat={pharmacy.lat} lng={pharmacy.lng}
                  />
                </section>
              )}

              {/* Grouped breakdown */}
              {(["volume", "service", "revenue", "ratio"] as const).map((g) => {
                const items = analysis.grouped[g];
                if (!items?.length) return null;
                return (
                  <section key={g}>
                    <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">{GROUP_LABEL[g]}</h2>

                    {/* Table */}
                    <div className="rounded-lg bg-card border border-border shadow-sm overflow-hidden mb-5">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[640px]">
                          <thead className="text-muted-foreground bg-secondary/40">
                            <tr>
                              <th className="text-left font-medium py-2.5 px-4 w-[220px]">Metric</th>
                              <th className="text-right font-medium py-2.5 px-4">
                                You<br /><span className="text-[10px] font-normal">{periodLabel}</span>
                              </th>
                              {!isRatio(g) && (
                                <th className="text-right font-medium py-2.5 px-4">
                                  You<br /><span className="text-[10px] font-normal">monthly avg</span>
                                </th>
                              )}
                              <th className="text-right font-medium py-2.5 px-4">
                                {pharmacy.region}<br /><span className="text-[10px] font-normal">avg {periodLabel}</span>
                              </th>
                              <th className="text-right font-medium py-2.5 px-4">
                                {pharmacy.country}<br /><span className="text-[10px] font-normal">avg {periodLabel}</span>
                              </th>
                              <th className="text-right font-medium py-2.5 px-4">Top 10%</th>
                              <th className="text-right font-medium py-2.5 px-4">Rank</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((r: any) => {
                              const isPf = r.metric.key === "pharmacy_first_count";
                              const myPfPay = isPf ? myAgg?.pharmacy_first_payment ?? 0 : 0;
                              const countryPfPayAvg = isPf
                                ? cohortAggs.reduce((a, x) => a + x.pharmacy_first_payment, 0) / Math.max(1, cohortAggs.length)
                                : 0;
                              const vsRegion = r.regionAvg > 0 ? ((r.mineVal - r.regionAvg) / r.regionAvg) * 100 : 0;
                              const tone = vsRegion > 5 ? "text-emerald-700 dark:text-emerald-400" : vsRegion < -5 ? "text-rose-500" : "";
                              return (
                                <tr key={r.metric.key} className="border-t border-border hover:bg-secondary/20 transition-colors">
                                  <td className="py-3 px-4">
                                    <div className="font-medium text-sm">{r.metric.label}</div>
                                    {r.metric.description && (
                                      <div className="text-[11px] text-muted-foreground mt-0.5">{r.metric.description}</div>
                                    )}
                                  </td>
                                  <td className={`text-right tabular-nums font-bold py-3 px-4 ${tone}`}>
                                    {r.metric.fmt(r.mineVal)}
                                    {isPf && myPfPay > 0 && (
                                      <div className="text-[11px] font-normal text-emerald-700 dark:text-emerald-400 mt-0.5">
                                        {fmtGbpCompact(myPfPay)} earned
                                      </div>
                                    )}
                                  </td>
                                  {!isRatio(g) && (
                                    <td className="text-right tabular-nums text-muted-foreground py-3 px-4">
                                      {r.metric.fmt(r.myMonthlyAvg)}
                                    </td>
                                  )}
                                  <td className="text-right tabular-nums text-muted-foreground py-3 px-4">
                                    {r.metric.fmt(r.regionAvg)}
                                  </td>
                                  <td className="text-right tabular-nums text-muted-foreground py-3 px-4">
                                    {r.metric.fmt(r.countryAvg)}
                                    {isPf && countryPfPayAvg > 0 && (
                                      <div className="text-[11px] mt-0.5">{fmtGbpCompact(countryPfPayAvg)} avg</div>
                                    )}
                                  </td>
                                  <td className="text-right tabular-nums text-muted-foreground py-3 px-4">
                                    {r.metric.fmt(r.top10)}
                                  </td>
                                  <td className="text-right tabular-nums py-3 px-4">
                                    <span className="font-semibold">{r.rank.toLocaleString()}</span>
                                    <span className="text-muted-foreground"> / {r.cohortSize.toLocaleString()}</span>
                                    <div className="text-[10px] text-muted-foreground">{r.percentile}th %ile</div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Percentile rails */}
                    <div className="grid md:grid-cols-2 gap-4">
                      {items.map((r: any) => {
                        const diff = r.regionAvg > 0 ? Math.round(((r.mineVal - r.regionAvg) / r.regionAvg) * 100) : 0;
                        const caption = Math.abs(diff) < 5
                          ? `Within ±5% of the ${pharmacy.region} average — broadly in line with regional peers over the ${periodLabel.toLowerCase()}.`
                          : `${diff >= 0 ? "Outperforming" : "Trailing"} the ${pharmacy.region} average by ${Math.abs(diff)}% over the ${periodLabel.toLowerCase()}.`;
                        return (
                          <PercentileRail
                            key={r.metric.key}
                            label={r.metric.label}
                            value={r.mineVal}
                            values={r.regionVals.length > 5 ? r.regionVals : r.countryVals}
                            peerLabel={`${pharmacy.region} avg`}
                            nationalLabel="Regional peak"
                            caption={caption}
                            formatValue={r.metric.fmt}
                          />
                        );
                      })}
                    </div>
                  </section>
                );
              })}

              {/* Smart Insight */}
              <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                  <div>
                    <h2 className="text-base font-semibold flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-gold" /> Smart Insight
                    </h2>
                    <p className="text-xs text-muted-foreground mt-1">
                      AI commentary tailored to this pharmacy's volume, services, revenue and peer gaps.
                    </p>
                  </div>
                  <Button size="sm" disabled={insightLoading || !pharmacy}
                    onClick={async () => {
                      if (!pharmacy) return;
                      setInsightLoading(true); setInsightMd(null);
                      try {
                        const { insight } = await runInsight({
                          data: { insight_type: "benchmark", pharmacy_id: pharmacy.id },
                        });
                        setInsightMd(insight?.insight_text ?? "");
                      } catch (e: any) {
                        toast.error(e?.message || "Could not generate Smart Insight");
                      } finally {
                        setInsightLoading(false);
                      }
                    }} className="gap-1.5">
                    {insightLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {insightMd ? "Regenerate" : "Generate Smart Insight"}
                  </Button>
                </div>
                {insightLoading && !insightMd && <p className="text-sm text-muted-foreground">Crunching the numbers…</p>}
                {insightMd && (
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown>{insightMd}</ReactMarkdown>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      <DataAttribution />
    </div>
  );
}

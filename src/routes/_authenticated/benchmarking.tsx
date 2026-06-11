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
import { PharmacySearch } from "@/components/PharmacySearch";
import { CountryBadge } from "@/components/CountryBadge";
import { Button } from "@/components/ui/button";
import { fmtGbpCompact } from "@/lib/utils";
import { getViewedPharmacy } from "@/lib/viewedPharmacy";
import { generateInsight } from "@/lib/insights.functions";

export const Route = createFileRoute("/_authenticated/benchmarking")({ component: Benchmarking });

type MetricDef = {
  key: string;
  label: string;
  unit?: string;
  fmt?: (n: number) => string;
  group: "volume" | "service" | "revenue" | "ratio";
  // ratio: compute per row from other fields
  derive?: (row: any) => number;
  description?: string;
};

const money = (n: number) =>
  `£${Math.round(n).toLocaleString()}`;
const ratio = (n: number) => `${n.toFixed(1)}`;

const METRICS: MetricDef[] = [
  { key: "items_dispensed", label: "Items dispensed", group: "volume", description: "Total prescription items dispensed in the month." },
  { key: "eps_items", label: "EPS items", group: "volume", description: "Items processed via Electronic Prescription Service." },
  { key: "pharmacy_first_count", label: "Pharmacy First consultations", group: "service", description: "Walk-in clinical consultations completed." },
  { key: "nms_count", label: "New Medicine Service", group: "service", description: "NMS interventions delivered to patients starting new meds." },
  { key: "flu_vaccinations", label: "Flu vaccinations", group: "service", description: "NHS flu jabs administered in the month." },
  { key: "methadone_items", label: "Methadone items", group: "service", description: "Supervised opioid substitution items." },
  { key: "mcr_registrations", label: "MCR registrations", group: "service", description: "Patients registered for the Medicines: Care & Review service." },
  { key: "gross_cost", label: "Gross drug cost", group: "revenue", fmt: money, description: "Reimbursable drug cost before clawback." },
  { key: "final_payment", label: "Final payment", group: "revenue", fmt: money, description: "Net payment received for the month." },
  {
    key: "pf_per_100",
    label: "Pharmacy First per 100 items",
    group: "ratio",
    fmt: ratio,
    derive: (r) => (r.items_dispensed ? (r.pharmacy_first_count * 100) / r.items_dispensed : 0),
    description: "Clinical service intensity vs dispensing volume.",
  },
  {
    key: "nms_per_100",
    label: "NMS per 100 items",
    group: "ratio",
    fmt: ratio,
    derive: (r) => (r.items_dispensed ? (r.nms_count * 100) / r.items_dispensed : 0),
    description: "How actively the team engages patients on new meds.",
  },
  {
    key: "revenue_per_item",
    label: "Revenue per item",
    group: "ratio",
    fmt: (n) => `£${n.toFixed(2)}`,
    derive: (r) => (r.items_dispensed ? r.final_payment / r.items_dispensed : 0),
    description: "Average revenue earned per dispensed item.",
  },
];

const GROUP_LABEL: Record<MetricDef["group"], string> = {
  volume: "Volume",
  service: "Clinical services",
  revenue: "Revenue",
  ratio: "Efficiency ratios",
};

function metricValue(m: MetricDef, row: any): number {
  if (m.derive) return m.derive(row);
  return Number(row?.[m.key] ?? 0);
}

function Benchmarking() {
  const { user } = useAuth();
  const [pharmacy, setPharmacy] = useState<any>(null);
  const [pharmacyOverride, setPharmacyOverride] = useState<any>(null);
  const [myHistory, setMyHistory] = useState<any[]>([]);
  const [regionPharms, setRegionPharms] = useState<any[]>([]);
  const [countryPharms, setCountryPharms] = useState<any[]>([]);
  // Per-metric snapshots: snapshots[metricKey] = { year, month, regionRows, countryRows }
  const [snapshots, setSnapshots] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [insightMd, setInsightMd] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const runInsight = useServerFn(generateInsight);

  // Load the SUBJECT pharmacy. Priority: in-page override > "browsed" pharmacy
  // (set when the user opens another pharmacy via the search bar) > saved
  // home pharmacy. Returning to the saved pharmacy clears the override.
  useEffect(() => {
    if (pharmacyOverride) return;
    (async () => {
      if (!user) return;
      const viewed = getViewedPharmacy();
      let subjectId: string | null = viewed?.id ?? null;

      if (!subjectId) {
        const { data: up } = await supabase
          .from("user_pharmacy")
          .select("pharmacy_id")
          .eq("user_id", user.id)
          .maybeSingle();
        subjectId = up?.pharmacy_id ?? null;
      }
      if (!subjectId) { setLoading(false); return; }

      const { data: ph } = await supabase
        .from("pharmacies")
        .select("*")
        .eq("id", subjectId)
        .maybeSingle();
      if (ph) setPharmacy(ph);
      else setLoading(false);
    })();
  }, [user, pharmacyOverride]);

  // When override is set, load its full pharmacy row
  useEffect(() => {
    if (!pharmacyOverride) return;
    (async () => {
      const { data: ph } = await supabase
        .from("pharmacies")
        .select("*")
        .eq("id", pharmacyOverride.id)
        .maybeSingle();
      if (ph) setPharmacy(ph);
    })();
  }, [pharmacyOverride]);

  // Reset AI insight whenever the active pharmacy changes
  useEffect(() => { setInsightMd(null); }, [pharmacy?.id]);



  // When the active pharmacy changes, load cohorts + history
  useEffect(() => {
    if (!pharmacy) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setSnapshots({});
      const country = await fetchAll<any>((from, to) =>
        supabase
          .from("pharmacies")
          .select("id,name,region,country")
          .eq("country", pharmacy.country ?? "")
          .order("id", { ascending: true })
          .range(from, to),
      );
      if (cancelled) return;
      setCountryPharms(country);
      setRegionPharms(country.filter((p) => p.region === pharmacy.region));

      const { data: hist } = await supabase
        .from("dispensing_data")
        .select("*")
        .eq("pharmacy_id", pharmacy.id)
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .limit(24);
      if (!cancelled) setMyHistory(hist ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [pharmacy]);

  // Once we have the user history + cohorts, pick a target month per metric (latest where user > 0)
  // and fetch country-wide rows for that month. Months are deduped to minimise queries.
  useEffect(() => {
    if (!pharmacy || !myHistory.length || !countryPharms.length) return;
    (async () => {
      setLoading(true);
      const ordered = [...myHistory].sort(
        (a, b) => b.year * 12 + b.month - (a.year * 12 + a.month),
      );

      // pick month per metric
      const metricMonth: Record<string, { year: number; month: number; mine: any }> = {};
      for (const m of METRICS) {
        const hit = ordered.find((row) => metricValue(m, row) > 0);
        if (hit) metricMonth[m.key] = { year: hit.year, month: hit.month, mine: hit };
      }

      // unique months
      const monthKey = (y: number, mo: number) => `${y}-${mo}`;
      const uniqueMonths = Array.from(
        new Map(
          Object.values(metricMonth).map((v) => [monthKey(v.year, v.month), v]),
        ).values(),
      );

      // fetch country dispensing for each unique month in parallel
      const countryIds = new Set(countryPharms.map((p) => p.id));
      const monthData = new Map<string, any[]>();
      await Promise.all(
        uniqueMonths.map(async ({ year, month }) => {
          const rows = await fetchAll<any>((from, to) =>
            supabase
              .from("dispensing_data")
              .select(
                "pharmacy_id,items_dispensed,eps_items,nms_count,pharmacy_first_count,pharmacy_first_payment,flu_vaccinations,methadone_items,mcr_registrations,gross_cost,final_payment",
              )
              .eq("year", year)
              .eq("month", month)
              .order("id", { ascending: true })
              .range(from, to),
          );
          monthData.set(
            monthKey(year, month),
            rows.filter((r) => countryIds.has(r.pharmacy_id)),
          );
        }),
      );

      const snaps: Record<string, any> = {};
      for (const m of METRICS) {
        const sel = metricMonth[m.key];
        if (!sel) continue;
        const rows = monthData.get(monthKey(sel.year, sel.month)) || [];
        snaps[m.key] = {
          year: sel.year,
          month: sel.month,
          mine: sel.mine,
          countryRows: rows,
        };
      }
      setSnapshots(snaps);
      setLoading(false);
    })();
  }, [pharmacy, myHistory, countryPharms]);

  const monthLabel = (y: number, mo: number) =>
    new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });

  const analysis = useMemo(() => {
    if (!pharmacy || !Object.keys(snapshots).length) return null;
    const regionIds = new Set(regionPharms.map((p) => p.id));

    const rows = METRICS.map((m) => {
      const snap = snapshots[m.key];
      if (!snap) return null;
      const mineVal = metricValue(m, snap.mine);
      const country = snap.countryRows;
      const region = country.filter((r: any) => regionIds.has(r.pharmacy_id));
      const countryVals = country.map((r: any) => metricValue(m, r)).filter((v: number) => isFinite(v));
      const regionVals = region.map((r: any) => metricValue(m, r)).filter((v: number) => isFinite(v));
      const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
      const sortedC = [...countryVals].sort((a, b) => b - a);
      const top10n = Math.max(1, Math.ceil(sortedC.length * 0.1));
      const top10 = avg(sortedC.slice(0, top10n));

      // rank in country (1 = best)
      const sortedDesc = [...countryVals].sort((a, b) => b - a);
      const rank = sortedDesc.findIndex((v) => v <= mineVal) + 1;
      const percentile = countryVals.length
        ? Math.round((1 - rank / countryVals.length) * 100)
        : 0;

      return {
        metric: m,
        snap,
        mineVal,
        regionAvg: avg(regionVals),
        countryAvg: avg(countryVals),
        top10,
        regionVals,
        countryVals,
        rank,
        cohortSize: countryVals.length,
        percentile,
      };
    }).filter(Boolean) as any[];

    const grouped: Record<string, any[]> = {};
    for (const r of rows) {
      (grouped[r.metric.group] ||= []).push(r);
    }
    return { rows, grouped };
  }, [pharmacy, snapshots, regionPharms]);

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Benchmarking"
        subtitle="How any pharmacy compares against local and national peers across volume, services, revenue and efficiency."
      />

      {/* Pharmacy switcher — benchmark any pharmacy, not just your own */}
      <div className="rounded-lg bg-card border border-border p-4 shadow-sm mb-6">
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
              <span className="font-semibold text-foreground">{pharmacy.name}</span>
              <CountryBadge country={pharmacy.country} />
              {pharmacyOverride && (
                <button
                  type="button"
                  onClick={() => { setPharmacyOverride(null); setPharmacy(null); }}
                  className="text-xs text-primary hover:underline"
                >
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

      {pharmacy && loading && (
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm text-sm text-muted-foreground">
          Crunching latest benchmarks…
        </div>
      )}

      {pharmacy && !loading && analysis && analysis.rows.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm text-sm text-muted-foreground">
          No reported activity for your pharmacy in the last 24 months.
        </div>
      )}

      {pharmacy && !loading && analysis && analysis.rows.length > 0 && (
        <>
          <div className="rounded-lg bg-card border border-border p-6 shadow-sm mb-6">
            <p className="text-xs text-muted-foreground">Comparing</p>
            <p className="text-lg font-semibold">{pharmacy.name}</p>
            <p className="text-sm text-muted-foreground">
              {pharmacy.region} · {pharmacy.country} · cohort of{" "}
              {regionPharms.length.toLocaleString()} regional /{" "}
              {countryPharms.length.toLocaleString()} national pharmacies
            </p>
          </div>

          {/* Headline scoreboard */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {analysis.rows.slice(0, 4).map((r) => {
              const fmt = r.metric.fmt || ((n: number) => Math.round(n).toLocaleString());
              const vsRegion =
                r.regionAvg > 0 ? Math.round(((r.mineVal - r.regionAvg) / r.regionAvg) * 100) : 0;
              const tone =
                vsRegion > 0
                  ? "text-emerald-700"
                  : vsRegion < 0
                  ? "text-rose-700"
                  : "text-muted-foreground";
              return (
                <div
                  key={r.metric.key}
                  className="rounded-lg bg-card border border-border p-5 shadow-sm"
                >
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {r.metric.label}
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{fmt(r.mineVal)}</p>
                  <p className={`mt-1 text-xs ${tone}`}>
                    {vsRegion >= 0 ? "+" : ""}
                    {vsRegion}% vs {pharmacy.region}
                  </p>
                  <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {monthLabel(r.snap.year, r.snap.month)}
                    {r.cohortSize > 0 && (
                      <>
                        {" · "}#{r.rank.toLocaleString()} of {r.cohortSize.toLocaleString()}
                      </>
                    )}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Local GP prescribing — items dispensed against scripts from linked GPs */}
          {pharmacy.ods_code && (
            <section className="mb-10">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                GP practice activity
              </h2>
              <GpPrescribingCard pharmacyOds={pharmacy.ods_code} />
            </section>
          )}

          {/* Grouped breakdown */}
          {(["volume", "service", "revenue", "ratio"] as const).map((g) => {
            const items = analysis.grouped[g];
            if (!items?.length) return null;
            return (
              <section key={g} className="mb-10">
                <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                  {GROUP_LABEL[g]}
                </h2>

                <div className="rounded-lg bg-card border border-border shadow-sm overflow-hidden mb-5">
                  <table className="w-full text-sm">
                    <thead className="text-muted-foreground bg-secondary/40">
                      <tr>
                        <th className="text-left font-medium py-2 px-4">Metric</th>
                        <th className="text-right font-medium py-2 px-4">You</th>
                        <th className="text-right font-medium py-2 px-4">{pharmacy.region}</th>
                        <th className="text-right font-medium py-2 px-4">{pharmacy.country}</th>
                        <th className="text-right font-medium py-2 px-4">Top 10%</th>
                        <th className="text-right font-medium py-2 px-4">Rank</th>
                        <th className="text-right font-medium py-2 px-4">Period</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((r) => {
                        const fmt = r.metric.fmt || ((n: number) => Math.round(n).toLocaleString());
                        const isPf = r.metric.key === "pharmacy_first_count";
                        const myPfPay = isPf ? Number((r.snap.mine as any).pharmacy_first_payment) || 0 : 0;
                        const countryPfPayAvg = isPf
                          ? (r.snap.countryRows as any[]).reduce((a, x) => a + (Number(x.pharmacy_first_payment) || 0), 0) /
                            Math.max(1, (r.snap.countryRows as any[]).length)
                          : 0;
                        return (
                          <tr key={r.metric.key} className="border-t border-border">
                            <td className="py-2.5 px-4">
                              <div className="font-medium">{r.metric.label}</div>
                              {r.metric.description && (
                                <div className="text-[11px] text-muted-foreground">
                                  {r.metric.description}
                                </div>
                              )}
                            </td>
                            <td className="text-right tabular-nums font-semibold py-2.5 px-4">
                              {fmt(r.mineVal)}
                              {isPf && (
                                <div className="text-[11px] font-normal text-emerald-700 mt-0.5">
                                  {fmtGbpCompact(myPfPay)} paid
                                </div>
                              )}
                            </td>
                            <td className="text-right tabular-nums text-muted-foreground py-2.5 px-4">
                              {fmt(r.regionAvg)}
                            </td>
                            <td className="text-right tabular-nums text-muted-foreground py-2.5 px-4">
                              {fmt(r.countryAvg)}
                              {isPf && (
                                <div className="text-[11px] mt-0.5">
                                  {fmtGbpCompact(countryPfPayAvg)} avg
                                </div>
                              )}
                            </td>
                            <td className="text-right tabular-nums text-muted-foreground py-2.5 px-4">
                              {fmt(r.top10)}
                            </td>
                            <td className="text-right tabular-nums py-2.5 px-4">
                              <span className="font-medium">{r.rank.toLocaleString()}</span>
                              <span className="text-muted-foreground">
                                {" "}
                                / {r.cohortSize.toLocaleString()}
                              </span>
                            </td>
                            <td className="text-right text-[11px] text-muted-foreground py-2.5 px-4 whitespace-nowrap">
                              {monthLabel(r.snap.year, r.snap.month)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  {items.map((r) => {
                    const fmt = r.metric.fmt || ((n: number) => Math.round(n).toLocaleString());
                    const diff =
                      r.regionAvg > 0
                        ? Math.round(((r.mineVal - r.regionAvg) / r.regionAvg) * 100)
                        : 0;
                    const caption =
                      Math.abs(diff) < 5
                        ? `In line with ${pharmacy.region} peers — within ±5% of the regional average for ${monthLabel(
                            r.snap.year,
                            r.snap.month,
                          )}.`
                        : `${diff >= 0 ? "Outperforming" : "Trailing"} the ${pharmacy.region} average by ${Math.abs(
                            diff,
                          )}% in ${monthLabel(r.snap.year, r.snap.month)}.`;
                    return (
                      <PercentileRail
                        key={r.metric.key}
                        label={r.metric.label}
                        value={r.mineVal}
                        values={r.regionVals.length > 5 ? r.regionVals : r.countryVals}
                        peerLabel={`${pharmacy.region} avg`}
                        nationalLabel="Regional peak"
                        caption={caption}
                        formatValue={fmt}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}

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
              <Button
                size="sm"
                disabled={insightLoading || !pharmacy}
                onClick={async () => {
                  if (!pharmacy) return;
                  setInsightLoading(true);
                  setInsightMd(null);
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
                }}
                className="gap-1.5"
              >
                {insightLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {insightMd ? "Regenerate" : "Generate Smart Insight"}
              </Button>
            </div>
            {insightLoading && !insightMd && (
              <p className="text-sm text-muted-foreground">Crunching the numbers…</p>
            )}
            {insightMd && (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown>{insightMd}</ReactMarkdown>
              </div>
            )}
          </div>
        </>
      )}

      <DataAttribution />
    </div>
  );
}

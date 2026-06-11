import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, ArrowRight, TrendingUp, TrendingDown } from "lucide-react";

interface Props {
  pharmacyOds: string;
  country: string | null;
}

interface GpFeeder {
  practice_code: string;
  name: string;
  itemsToUs: number;
  itemsTotal: number;
  shareOfOurInflow: number;   // % of our items that came from this GP
  shareOfGpOutput: number;    // % of this GP's output that came to us
}

const PERIOD_OPTIONS = [
  { label: "Last 3 months", months: 3 },
  { label: "Last 6 months", months: 6 },
  { label: "Last 12 months", months: 12 },
];

function periodFilter(months: number) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - months, 1);
  return { year: from.getFullYear(), month: from.getMonth() + 1 };
}

function inPeriod(row: { year: number; month: number }, fromYear: number, fromMonth: number) {
  return row.year > fromYear || (row.year === fromYear && row.month >= fromMonth);
}

export function NominationFlow({ pharmacyOds, country }: Props) {
  const [periodIdx, setPeriodIdx] = useState(2);
  const [feeders, setFeeders] = useState<GpFeeder[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalInflow, setTotalInflow] = useState(0);
  const [totalGpCount, setTotalGpCount] = useState(0);

  const isSupported = country === "England" || country === "Scotland";
  const period = PERIOD_OPTIONS[periodIdx];

  useEffect(() => {
    if (!isSupported) return;
    setLoading(true);
    setFeeders([]);

    (async () => {
      const { year, month } = periodFilter(period.months);

      // All flows TO this pharmacy
      const { data: toThis } = await supabase
        .from("gp_pharmacy_linkage")
        .select("practice_code,items_dispensed,year,month")
        .eq("pharmacy_ods_code", pharmacyOds)
        .gte("year", year);

      const toThisFiltered = (toThis ?? []).filter(r => inPeriod(r, year, month));
      if (!toThisFiltered.length) { setLoading(false); return; }

      // Aggregate by GP — items sent to US
      const gpToUs = new Map<string, number>();
      for (const r of toThisFiltered) {
        gpToUs.set(r.practice_code, (gpToUs.get(r.practice_code) ?? 0) + r.items_dispensed);
      }
      setTotalGpCount(gpToUs.size);

      const ourTotal = Array.from(gpToUs.values()).reduce((s, v) => s + v, 0);
      setTotalInflow(ourTotal);

      // Top 10 feeders
      const top10 = Array.from(gpToUs.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([code]) => code);

      // GP names
      const { data: gpNames } = await supabase
        .from("gp_practices")
        .select("practice_code,practice_name,google_name")
        .in("practice_code", top10);

      const nameMap = new Map<string, string>(
        (gpNames ?? []).map(g => [g.practice_code, g.google_name || g.practice_name || g.practice_code])
      );

      // All flows FROM these GPs (to any pharmacy) in period — to compute GP's total output
      const { data: allFlows } = await supabase
        .from("gp_pharmacy_linkage")
        .select("practice_code,items_dispensed,year,month")
        .in("practice_code", top10)
        .gte("year", year);

      const gpTotalOutput = new Map<string, number>();
      for (const r of (allFlows ?? []).filter(r => inPeriod(r, year, month))) {
        gpTotalOutput.set(r.practice_code, (gpTotalOutput.get(r.practice_code) ?? 0) + r.items_dispensed);
      }

      const result: GpFeeder[] = top10.map(code => {
        const itemsToUs = gpToUs.get(code) ?? 0;
        const itemsTotal = gpTotalOutput.get(code) ?? itemsToUs;
        return {
          practice_code: code,
          name: nameMap.get(code) ?? code,
          itemsToUs,
          itemsTotal,
          shareOfOurInflow: ourTotal > 0 ? (itemsToUs / ourTotal) * 100 : 0,
          shareOfGpOutput: itemsTotal > 0 ? (itemsToUs / itemsTotal) * 100 : 0,
        };
      });

      setFeeders(result);
      setLoading(false);
    })();
  }, [pharmacyOds, isSupported, period.months]);

  if (!isSupported) {
    return (
      <section className="mt-6 rounded-lg bg-card border border-border shadow-sm px-4 py-4 text-sm text-muted-foreground">
        GP nomination flow data is available for England and Scotland pharmacies only.
      </section>
    );
  }

  const top = feeders[0];

  return (
    <section className="mt-6">
      <div className="rounded-lg bg-card border border-border shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">GP feeder analysis</h2>
          </div>
          <Select value={String(periodIdx)} onValueChange={v => setPeriodIdx(Number(v))}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((o, i) => (
                <SelectItem key={i} value={String(i)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading && (
          <div className="px-5 py-12 text-sm text-muted-foreground animate-pulse text-center">
            Loading GP feeder data…
          </div>
        )}

        {!loading && feeders.length === 0 && (
          <div className="px-5 py-12 text-sm text-muted-foreground text-center">
            No GP→pharmacy flow data found for this pharmacy in the selected period.
          </div>
        )}

        {!loading && feeders.length > 0 && (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
              <div className="px-5 py-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total GP feeders</p>
                <p className="text-2xl font-bold mt-1 tabular-nums">{totalGpCount}</p>
              </div>
              <div className="px-5 py-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Items received</p>
                <p className="text-2xl font-bold mt-1 tabular-nums">{totalInflow.toLocaleString()}</p>
              </div>
              <div className="px-5 py-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Top GP share</p>
                <p className="text-2xl font-bold mt-1 tabular-nums">
                  {top ? `${top.shareOfOurInflow.toFixed(1)}%` : "—"}
                </p>
                {top && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{top.name}</p>}
              </div>
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-[2rem_1fr_6rem_6rem_8rem] gap-x-4 px-5 py-2 border-b border-border bg-secondary/30">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">#</span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">GP practice</span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground text-right">Items to us</span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground text-right">Our share</span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground text-right">GP loyalty</span>
            </div>

            {/* Feeder rows */}
            <div className="divide-y divide-border/60">
              {feeders.map((gp, i) => {
                const loyaltyWidth = Math.min(100, gp.shareOfGpOutput);
                const inflowWidth = Math.min(100, gp.shareOfOurInflow);
                const isTop = i === 0;

                return (
                  <div
                    key={gp.practice_code}
                    className={`grid grid-cols-[2rem_1fr_6rem_6rem_8rem] gap-x-4 px-5 py-3.5 items-center hover:bg-secondary/20 transition-colors ${isTop ? "bg-primary/5" : ""}`}
                  >
                    {/* Rank */}
                    <span className={`text-sm font-bold tabular-nums ${isTop ? "text-primary" : "text-muted-foreground"}`}>
                      {i + 1}
                    </span>

                    {/* GP name + inflow bar */}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate leading-tight">{gp.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{gp.practice_code}</p>
                      {/* Inflow bar */}
                      <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/70 transition-all"
                          style={{ width: `${inflowWidth}%` }}
                        />
                      </div>
                    </div>

                    {/* Items to us */}
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">{gp.itemsToUs.toLocaleString()}</p>
                      <p className="text-[11px] text-muted-foreground">items</p>
                    </div>

                    {/* Share of our inflow */}
                    <div className="text-right">
                      <p className={`text-sm font-bold tabular-nums ${isTop ? "text-primary" : ""}`}>
                        {gp.shareOfOurInflow.toFixed(1)}%
                      </p>
                      <p className="text-[11px] text-muted-foreground">of our total</p>
                    </div>

                    {/* GP loyalty = share of GP's output that came to us */}
                    <div className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden max-w-[56px]">
                          <div
                            className={`h-full rounded-full transition-all ${loyaltyWidth > 50 ? "bg-emerald-500" : loyaltyWidth > 25 ? "bg-amber-500" : "bg-muted-foreground/50"}`}
                            style={{ width: `${loyaltyWidth}%` }}
                          />
                        </div>
                        <p className={`text-sm font-semibold tabular-nums shrink-0 ${loyaltyWidth > 50 ? "text-emerald-600 dark:text-emerald-400" : loyaltyWidth > 25 ? "text-amber-600 dark:text-amber-400" : ""}`}>
                          {gp.shareOfGpOutput.toFixed(0)}%
                        </p>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">of GP output</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend / explainer */}
            <div className="px-5 py-4 border-t border-border bg-secondary/20 space-y-2 text-[11px] text-muted-foreground">
              <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                <span><strong className="text-foreground">Our share</strong> — % of this pharmacy's total linked items that originated from this GP</span>
                <span><strong className="text-foreground">GP loyalty</strong> — % of this GP's total linked prescriptions that were dispensed here</span>
              </div>
              <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                <strong className="text-muted-foreground">Accuracy note:</strong> GP loyalty reflects patient EPS nomination capture — it shows where patients registered with this GP chose to collect their prescriptions, not a GP actively directing business. Figures are based on the NHS linked prescribing dataset and may undercount if some prescriptions are not linked in this dataset.
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

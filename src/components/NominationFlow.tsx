import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users } from "lucide-react";
import { gpDisplayName, gpDisplayAddress } from "@/lib/gpName";

interface Props {
  pharmacyOds: string;
  country: string | null;
}

interface GpFeeder {
  practice_code: string;
  name: string;
  address: string;
  itemsToUs: number;
  shareOfOurInflow: number;
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

      // All flows TO this pharmacy in the period
      const { data: toThis } = await supabase
        .from("gp_pharmacy_linkage")
        .select("practice_code,items_dispensed,year,month")
        .eq("pharmacy_ods_code", pharmacyOds)
        .gte("year", year);

      const toThisFiltered = (toThis ?? []).filter(r => inPeriod(r, year, month));
      if (!toThisFiltered.length) { setLoading(false); return; }

      // Aggregate items to us per GP
      const gpToUs = new Map<string, number>();
      for (const r of toThisFiltered) {
        gpToUs.set(r.practice_code, (gpToUs.get(r.practice_code) ?? 0) + r.items_dispensed);
      }
      setTotalGpCount(gpToUs.size);

      const ourTotal = Array.from(gpToUs.values()).reduce((s, v) => s + v, 0);
      setTotalInflow(ourTotal);

      // Top 10 feeders by items sent to us
      const top10 = Array.from(gpToUs.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([code]) => code);

      // GP names + addresses
      const { data: gpRows } = await supabase
        .from("gp_practices")
        .select("practice_code,practice_name,google_name,postcode,address_line")
        .in("practice_code", top10);

      const metaMap = new Map<string, { name: string; address: string }>(
        (gpRows ?? []).map((g) => [g.practice_code, { name: gpDisplayName(g), address: gpDisplayAddress(g) }])
      );

      const result: GpFeeder[] = top10.map(code => {
        const itemsToUs = gpToUs.get(code) ?? 0;
        const m = metaMap.get(code);
        return {
          practice_code: code,
          name: m?.name ?? "GP Practice",
          address: m?.address ?? "",
          itemsToUs,
          shareOfOurInflow: ourTotal > 0 ? (itemsToUs / ourTotal) * 100 : 0,
        };
      });

      setFeeders(result);
      setLoading(false);
    })();
  }, [pharmacyOds, isSupported, period.months]);

  if (!isSupported) {
    return (
      <section className="mt-6 rounded-lg bg-card border border-border shadow-sm px-4 py-4 text-sm text-muted-foreground">
        GP prescription source data is available for England and Scotland pharmacies only.
      </section>
    );
  }

  const top = feeders[0];

  return (
    <section className="mt-6">
      <div className="rounded-lg bg-card border border-border shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">GP prescription sources</h2>
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
          <div className="px-4 py-12 text-sm text-muted-foreground animate-pulse text-center">
            Loading GP data…
          </div>
        )}

        {!loading && feeders.length === 0 && (
          <div className="px-4 py-12 text-sm text-muted-foreground text-center">
            No linked prescription data found for this pharmacy in the selected period.
          </div>
        )}

        {!loading && feeders.length > 0 && (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
              <div className="px-4 py-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">GP sources</p>
                <p className="text-2xl font-bold mt-1 tabular-nums">{totalGpCount}</p>
              </div>
              <div className="px-4 py-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Items linked</p>
                <p className="text-2xl font-bold mt-1 tabular-nums">{totalInflow.toLocaleString()}</p>
              </div>
              <div className="px-4 py-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Top source</p>
                <p className="text-2xl font-bold mt-1 tabular-nums">
                  {top ? `${top.shareOfOurInflow.toFixed(1)}%` : "—"}
                </p>
                {top && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{top.name}</p>}
              </div>
            </div>

            {/* Feeder list — mobile-first stacked cards */}
            <div className="divide-y divide-border/60">
              {feeders.map((gp, i) => {
                const barWidth = Math.min(100, gp.shareOfOurInflow);
                const isTop = i === 0;

                return (
                  <div
                    key={gp.practice_code}
                    className={`px-4 sm:px-5 py-3.5 hover:bg-secondary/20 transition-colors ${isTop ? "bg-primary/5" : ""}`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Rank badge */}
                      <span className={`mt-0.5 shrink-0 w-6 text-sm font-bold tabular-nums ${isTop ? "text-primary" : "text-muted-foreground"}`}>
                        {i + 1}
                      </span>

                      <div className="flex-1 min-w-0">
                        {/* Name + address (instead of GP code) */}
                        <p className="text-sm font-medium leading-snug">{gp.name}</p>
                        {gp.address && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{gp.address}</p>}

                        {/* Progress bar */}
                        <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${isTop ? "bg-primary" : "bg-primary/50"}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>

                      {/* Metrics — right-aligned */}
                      <div className="shrink-0 text-right">
                        <p className={`text-sm font-bold tabular-nums leading-snug ${isTop ? "text-primary" : ""}`}>
                          {gp.shareOfOurInflow.toFixed(1)}%
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{gp.itemsToUs.toLocaleString()} items</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer explainer */}
            <div className="px-4 sm:px-5 py-3 border-t border-border bg-secondary/20 text-[11px] text-muted-foreground">
              <p>
                <strong className="text-foreground">% share</strong> — proportion of this pharmacy's total linked prescriptions originating from each GP surgery, based on NHS linked prescribing data for {period.label.toLowerCase()}.
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

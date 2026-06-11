import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PharmacySearch, type Pharmacy as SearchPharmacy } from "@/components/PharmacySearch";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { TrendingUp, TrendingDown, X } from "lucide-react";

interface Props {
  pharmacyId: string;
  pharmacyOds: string;
  pharmacyName: string;
  country: string | null;
  onClose: () => void;
}

type MetricRow = {
  month: number; year: number;
  items_dispensed: number; nms_count: number;
  pharmacy_first_count: number; flu_vaccinations: number;
  eps_items: number; eps_nominations: number;
};

type Agg = { items: number; nms: number; pf: number; flu: number; eps: number; nom: number };

function aggregate(rows: MetricRow[]): Agg {
  const recent = [...rows]
    .sort((a, b) => b.year * 100 + b.month - (a.year * 100 + a.month))
    .slice(0, 12);
  return {
    items: recent.reduce((s, r) => s + (r.items_dispensed ?? 0), 0),
    nms: recent.reduce((s, r) => s + (r.nms_count ?? 0), 0),
    pf: recent.reduce((s, r) => s + (r.pharmacy_first_count ?? 0), 0),
    flu: recent.reduce((s, r) => s + (r.flu_vaccinations ?? 0), 0),
    eps: recent.reduce((s, r) => s + (r.eps_items ?? 0), 0),
    nom: recent.reduce((s, r) => s + (r.eps_nominations ?? 0), 0),
  };
}

function rivalryScore(mine: Agg, theirs: Agg): number {
  const pairs: [number, number][] = [
    [mine.items, theirs.items],
    [mine.nms, theirs.nms],
    [mine.pf, theirs.pf],
  ];
  const sims = pairs.map(([a, b]) => (a + b === 0 ? 1 : (2 * Math.min(a, b)) / (a + b)));
  return Math.round((sims.reduce((s, v) => s + v, 0) / sims.length) * 100);
}

function rivalryMeta(score: number) {
  if (score >= 80) return { label: "Fierce rivals", cls: "text-red-500" };
  if (score >= 60) return { label: "Close rivals", cls: "text-amber-500" };
  if (score >= 30) return { label: "Local rivals", cls: "text-yellow-600 dark:text-yellow-400" };
  return { label: "Different markets", cls: "text-muted-foreground" };
}

export function CompetitorDeepDive({ pharmacyId, pharmacyOds, pharmacyName, country, onClose }: Props) {
  const [competitor, setCompetitor] = useState<SearchPharmacy | null>(null);
  const [myRows, setMyRows] = useState<MetricRow[]>([]);
  const [theirRows, setTheirRows] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(false);

  const isEngland = country === "England";

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("dispensing_data")
        .select("month,year,items_dispensed,nms_count,pharmacy_first_count,flu_vaccinations,eps_items,eps_nominations")
        .eq("pharmacy_id", pharmacyId)
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .limit(24);
      setMyRows((data as MetricRow[]) ?? []);
    })();
  }, [pharmacyId]);

  const handleSelect = (p: SearchPharmacy) => {
    if (p.ods_code === pharmacyOds) return;
    setCompetitor(p);
    setLoading(true);
    setTheirRows([]);
    (async () => {
      const { data: phData } = await supabase
        .from("pharmacies")
        .select("id")
        .eq("ods_code", p.ods_code)
        .maybeSingle();
      if (!phData) { setLoading(false); return; }
      const { data } = await supabase
        .from("dispensing_data")
        .select("month,year,items_dispensed,nms_count,pharmacy_first_count,flu_vaccinations,eps_items,eps_nominations")
        .eq("pharmacy_id", phData.id)
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .limit(24);
      setTheirRows((data as MetricRow[]) ?? []);
      setLoading(false);
    })();
  };

  const myAgg = myRows.length > 0 ? aggregate(myRows) : null;
  const theirAgg = theirRows.length > 0 ? aggregate(theirRows) : null;
  const score = myAgg && theirAgg ? rivalryScore(myAgg, theirAgg) : null;
  const meta = score !== null ? rivalryMeta(score) : null;

  type MetricDef = { key: keyof Agg; label: string; englandOnly?: boolean };
  const METRICS: MetricDef[] = [
    { key: "items", label: "Items dispensed" },
    { key: "nms", label: "NMS", englandOnly: true },
    { key: "pf", label: "Pharmacy First" },
    { key: "flu", label: "Flu vaccinations" },
    { key: "eps", label: "EPS items", englandOnly: true },
    { key: "nom", label: "EPS nominations", englandOnly: true },
  ];

  const visibleMetrics = METRICS.filter(m => !m.englandOnly || isEngland);

  const chartData = myAgg && theirAgg
    ? visibleMetrics.map(m => ({
        metric: m.label,
        [pharmacyName]: myAgg[m.key],
        [competitor?.name ?? "Competitor"]: theirAgg[m.key],
      }))
    : [];

  return (
    <div className="mt-4 rounded-lg bg-card border border-border shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold">Competitor deep dive</h3>
        <button onClick={onClose} className="p-1 hover:bg-secondary rounded transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <p className="text-xs text-muted-foreground mb-2">Search for a competitor pharmacy</p>
          <PharmacySearch onSelect={handleSelect} clearOnSelect={false} placeholder="Search competitor…" />
        </div>

        {loading && (
          <div className="text-sm text-muted-foreground animate-pulse py-6 text-center">Loading competitor data…</div>
        )}

        {!loading && competitor && myAgg && theirAgg && (
          <>
            {score !== null && meta && (
              <div className="flex items-center gap-4 rounded-md bg-secondary/40 p-3">
                <div className="text-center shrink-0">
                  <p className="text-3xl font-bold tabular-nums">{score}</p>
                  <p className="text-xs text-muted-foreground">/ 100</p>
                </div>
                <div>
                  <p className={`text-sm font-semibold ${meta.cls}`}>{meta.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Comparing {pharmacyName} vs {competitor.name}
                  </p>
                </div>
              </div>
            )}

            <div>
              <div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 text-xs font-semibold pb-2 border-b border-border">
                <span className="truncate">{pharmacyName}</span>
                <span className="text-center text-muted-foreground text-[10px]">Metric · 12M</span>
                <span className="text-right truncate">{competitor.name}</span>
              </div>
              {visibleMetrics.map(m => {
                const mine = myAgg[m.key];
                const theirs = theirAgg[m.key];
                const winner = mine > theirs ? "mine" : theirs > mine ? "theirs" : null;
                return (
                  <div key={m.key} className="grid grid-cols-[1fr_auto_1fr] gap-x-3 text-xs py-1.5 border-b border-border/50 items-center">
                    <span className={`font-mono tabular-nums flex items-center gap-1 ${winner === "mine" ? "text-emerald-600 dark:text-emerald-400 font-semibold" : ""}`}>
                      {mine.toLocaleString()}
                      {winner === "mine" && <TrendingUp className="h-3 w-3 shrink-0" />}
                    </span>
                    <span className="text-center text-muted-foreground whitespace-nowrap text-[10px]">{m.label}</span>
                    <span className={`font-mono tabular-nums text-right flex items-center justify-end gap-1 ${winner === "theirs" ? "text-red-600 dark:text-red-400 font-semibold" : ""}`}>
                      {winner === "theirs" && <TrendingDown className="h-3 w-3 shrink-0" />}
                      {theirs.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>

            {chartData.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Side-by-side (12-month total)</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 50, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="metric" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis tick={{ fontSize: 9 }} tickLine={false} />
                    <Tooltip formatter={(v: number) => v.toLocaleString()} />
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                    <Bar dataKey={pharmacyName} fill="hsl(var(--primary))" opacity={0.85} />
                    <Bar dataKey={competitor.name} fill="hsl(var(--muted-foreground))" opacity={0.5} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}

        {!competitor && !loading && (
          <p className="text-xs text-muted-foreground text-center py-6">
            Search for a pharmacy above to see a detailed side-by-side breakdown
          </p>
        )}
      </div>
    </div>
  );
}

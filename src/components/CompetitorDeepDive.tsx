import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PharmacySearch, type Pharmacy as SearchPharmacy } from "@/components/PharmacySearch";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { X, Trophy, TrendingUp, TrendingDown, Minus } from "lucide-react";

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
type MonthlyTrend = { label: string; mine: number; theirs: number };

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function aggregate(rows: MetricRow[]): Agg {
  const recent = [...rows]
    .sort((a, b) => b.year * 100 + b.month - (a.year * 100 + a.month))
    .slice(0, 12);
  return {
    items: recent.reduce((s, r) => s + (r.items_dispensed ?? 0), 0),
    nms:   recent.reduce((s, r) => s + (r.nms_count ?? 0), 0),
    pf:    recent.reduce((s, r) => s + (r.pharmacy_first_count ?? 0), 0),
    flu:   recent.reduce((s, r) => s + (r.flu_vaccinations ?? 0), 0),
    eps:   recent.reduce((s, r) => s + (r.eps_items ?? 0), 0),
    nom:   recent.reduce((s, r) => s + (r.eps_nominations ?? 0), 0),
  };
}

function buildTrend(myRows: MetricRow[], theirRows: MetricRow[]): MonthlyTrend[] {
  const myMap = new Map(myRows.map(r => [`${r.year}-${r.month}`, r.items_dispensed ?? 0]));
  const theirMap = new Map(theirRows.map(r => [`${r.year}-${r.month}`, r.items_dispensed ?? 0]));
  const keys = Array.from(new Set([...myMap.keys(), ...theirMap.keys()])).sort();
  return keys.slice(-12).map(k => {
    const [y, m] = k.split("-").map(Number);
    return { label: `${MONTHS[m - 1]} ${String(y).slice(2)}`, mine: myMap.get(k) ?? 0, theirs: theirMap.get(k) ?? 0 };
  });
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

type RivalryTier = { label: string; description: string; color: string; arcColor: string };
function rivalryTier(score: number): RivalryTier {
  if (score >= 80) return { label: "Fierce rivals", description: "Nearly identical market footprint — direct head-to-head competition.", color: "text-red-500", arcColor: "#ef4444" };
  if (score >= 60) return { label: "Close rivals", description: "Significant overlap in volume and services — worth monitoring closely.", color: "text-amber-500", arcColor: "#f59e0b" };
  if (score >= 30) return { label: "Local rivals", description: "Some overlap in core dispensing volume but different service mix.", color: "text-yellow-500", arcColor: "#eab308" };
  return { label: "Different markets", description: "Low overlap — likely serving different patient populations or service types.", color: "text-muted-foreground", arcColor: "#6b7280" };
}

function RivalryGauge({ score }: { score: number }) {
  const R = 52;
  const CX = 70;
  const CY = 68;
  const circumference = Math.PI * R;
  const filled = (score / 100) * circumference;
  const tier = rivalryTier(score);

  // Semi-circle: starts at left (180°), ends at right (0°) going clockwise top
  // Path: M (cx-r, cy) arc to (cx+r, cy) with sweep=1
  const trackD = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;

  return (
    <div className="flex flex-col items-center">
      <svg width={140} height={80} overflow="visible">
        {/* Track */}
        <path d={trackD} fill="none" stroke="hsl(var(--border))" strokeWidth={10} strokeLinecap="round" />
        {/* Fill */}
        <path
          d={trackD}
          fill="none"
          stroke={tier.arcColor}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
        {/* Score */}
        <text x={CX} y={CY - 6} textAnchor="middle" fontSize={28} fontWeight="700" fill="currentColor" className="text-foreground">
          {score}
        </text>
        <text x={CX} y={CY + 10} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))">
          / 100
        </text>
      </svg>
      <p className={`text-sm font-bold mt-1 ${tier.color}`}>{tier.label}</p>
      <p className="text-[11px] text-muted-foreground text-center mt-1 max-w-[200px] leading-snug">{tier.description}</p>
    </div>
  );
}

type MetricDef = { key: keyof Agg; label: string; group: string; englandOnly?: boolean };
const METRIC_DEFS: MetricDef[] = [
  { key: "items", label: "Items dispensed",     group: "Volume" },
  { key: "eps",   label: "EPS items",           group: "Volume",   englandOnly: true },
  { key: "nom",   label: "EPS nominations",     group: "Volume",   englandOnly: true },
  { key: "pf",    label: "Pharmacy First",      group: "Services" },
  { key: "nms",   label: "NMS interventions",   group: "Services", englandOnly: true },
  { key: "flu",   label: "Flu vaccinations",    group: "Services" },
];

function DuelBar({
  label,
  mine,
  theirs,
  myName,
  theirName,
}: {
  label: string;
  mine: number;
  theirs: number;
  myName: string;
  theirName: string;
}) {
  const total = mine + theirs;
  const myPct = total > 0 ? (mine / total) * 100 : 50;
  const theirPct = total > 0 ? (theirs / total) * 100 : 50;
  const winner = mine > theirs ? "mine" : theirs > mine ? "theirs" : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {/* My value */}
        <span className={`text-sm font-bold tabular-nums w-20 text-right shrink-0 ${winner === "mine" ? "text-primary" : ""}`}>
          {mine.toLocaleString()}
        </span>
        {/* Duel bar */}
        <div className="flex-1 flex rounded-full overflow-hidden h-4 bg-secondary">
          <div
            className="bg-primary/80 transition-all duration-500 flex items-center justify-end pr-1"
            style={{ width: `${myPct}%` }}
          >
            {winner === "mine" && myPct > 15 && (
              <Trophy className="h-2.5 w-2.5 text-white/80" />
            )}
          </div>
          <div
            className="bg-amber-500/70 transition-all duration-500 flex items-center justify-start pl-1"
            style={{ width: `${theirPct}%` }}
          >
            {winner === "theirs" && theirPct > 15 && (
              <Trophy className="h-2.5 w-2.5 text-white/80" />
            )}
          </div>
        </div>
        {/* Their value */}
        <span className={`text-sm font-bold tabular-nums w-20 shrink-0 ${winner === "theirs" ? "text-amber-600 dark:text-amber-400" : ""}`}>
          {theirs.toLocaleString()}
        </span>
      </div>
      {winner && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          {winner === "mine" ? (
            <><TrendingUp className="h-3 w-3 text-primary" /><span className="text-primary font-medium">{myName}</span> leads by {(mine - theirs).toLocaleString()} ({myPct > 0 && theirPct > 0 ? `${(myPct / theirPct * 100 - 100).toFixed(0)}% more` : ""})</>
          ) : (
            <><TrendingDown className="h-3 w-3 text-amber-500" /><span className="text-amber-600 dark:text-amber-400 font-medium">{theirName}</span> leads by {(theirs - mine).toLocaleString()} ({myPct > 0 && theirPct > 0 ? `${(theirPct / myPct * 100 - 100).toFixed(0)}% more` : ""})</>
          )}
        </p>
      )}
      {!winner && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Minus className="h-3 w-3" /> Identical volume
        </p>
      )}
    </div>
  );
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
  const trendData = myRows.length > 0 && theirRows.length > 0 ? buildTrend(myRows, theirRows) : [];

  const visibleMetrics = METRIC_DEFS.filter(m => !m.englandOnly || isEngland);
  const groups = Array.from(new Set(visibleMetrics.map(m => m.group)));

  const shortName = (name: string) => name.length > 28 ? name.slice(0, 28) + "…" : name;

  return (
    <div className="mt-4 rounded-xl bg-card border border-border shadow-md overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold">Competitor deep dive</h3>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-5 space-y-6">
        {/* Search */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-2">
            Search for a competitor pharmacy to compare
          </label>
          <PharmacySearch onSelect={handleSelect} clearOnSelect={false} placeholder="Type pharmacy name, postcode, or ODS code…" />
        </div>

        {loading && (
          <div className="text-sm text-muted-foreground animate-pulse py-8 text-center">
            Loading competitor data…
          </div>
        )}

        {!loading && competitor && myAgg && theirAgg && score !== null && (
          <>
            {/* Versus banner */}
            <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center rounded-xl bg-secondary/40 border border-border px-4 py-4">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-primary mb-0.5">Your pharmacy</p>
                <p className="text-sm font-bold leading-tight truncate">{pharmacyName}</p>
              </div>
              <div className="text-center shrink-0">
                <span className="text-xl font-black text-muted-foreground">VS</span>
              </div>
              <div className="min-w-0 text-right">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-600 dark:text-amber-400 mb-0.5">Competitor</p>
                <p className="text-sm font-bold leading-tight truncate">{shortName(competitor.name)}</p>
                {competitor.postcode && (
                  <p className="text-[11px] text-muted-foreground">{competitor.postcode}</p>
                )}
              </div>
            </div>

            {/* Rivalry gauge */}
            <div className="flex flex-col items-center py-2">
              <RivalryGauge score={score} />
            </div>

            {/* Duel bars — legend */}
            <div className="flex items-center justify-center gap-6 text-[11px] font-medium">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-primary/80" />
                <span>{shortName(pharmacyName)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-amber-500/70" />
                <span>{shortName(competitor.name)}</span>
              </div>
            </div>

            {/* Metric groups */}
            {groups.map(group => (
              <div key={group}>
                <h4 className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-3">
                  {group}
                </h4>
                <div className="space-y-4">
                  {visibleMetrics
                    .filter(m => m.group === group)
                    .map(m => (
                      <DuelBar
                        key={m.key}
                        label={m.label}
                        mine={myAgg[m.key]}
                        theirs={theirAgg[m.key]}
                        myName={shortName(pharmacyName)}
                        theirName={shortName(competitor.name)}
                      />
                    ))
                  }
                </div>
              </div>
            ))}

            {/* 12-month items trend */}
            {trendData.length > 2 && (
              <div>
                <h4 className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-3">
                  Items dispensed — 12-month trend
                </h4>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                    />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => v.toLocaleString()}
                    />
                    <Line
                      type="monotone"
                      dataKey="mine"
                      name={shortName(pharmacyName)}
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="theirs"
                      name={shortName(competitor.name)}
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={false}
                      strokeDasharray="5 3"
                    />
                  </LineChart>
                </ResponsiveContainer>
                <div className="mt-2 flex items-center justify-center gap-6 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-primary rounded" /> {shortName(pharmacyName)}</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-amber-500 rounded border-dashed" style={{ borderBottom: "2px dashed #f59e0b", background: "none" }} /> {shortName(competitor.name)}</span>
                </div>
              </div>
            )}

            {/* Summary wins */}
            {(() => {
              const myWins = visibleMetrics.filter(m => myAgg[m.key] > theirAgg[m.key]).length;
              const theirWins = visibleMetrics.filter(m => theirAgg[m.key] > myAgg[m.key]).length;
              return (
                <div className="rounded-lg bg-secondary/40 border border-border px-4 py-3 text-sm">
                  <p className="font-medium">Summary</p>
                  <p className="text-muted-foreground text-xs mt-1">
                    {pharmacyName} leads on <strong className="text-foreground">{myWins} of {visibleMetrics.length}</strong> metrics
                    {theirWins > 0 ? `, while ${competitor.name} leads on ${theirWins}` : ", outperforming on all measured dimensions"}.
                  </p>
                </div>
              );
            })()}
          </>
        )}

        {!competitor && !loading && (
          <div className="py-10 text-center text-sm text-muted-foreground border-2 border-dashed border-border rounded-xl">
            <p className="font-medium">No competitor selected</p>
            <p className="mt-1 text-xs">Search for a pharmacy above to see a head-to-head comparison</p>
          </div>
        )}
      </div>
    </div>
  );
}

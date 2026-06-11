import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PharmacySearch, type Pharmacy as SearchPharmacy } from "@/components/PharmacySearch";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { X, ChevronDown, ChevronUp } from "lucide-react";

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
  pharmacy_first_payment: number | string | null;
  gross_cost: number | string | null;
  final_payment: number | string | null;
  mcr_registrations: number;
  methadone_items: number;
  smoking_cessation: number;
};

type Agg = {
  items: number; eps: number; nom: number;
  pf: number; nms: number; flu: number;
  pfPayment: number; grossCost: number; finalPayment: number;
  mcr: number; meth: number; smoke: number;
};

type Computed = Agg & {
  digitRate: number;   // eps / items %
  nomRate: number;     // nominations / items %
  pfRate: number;      // pf / items per 100
  nmsRate: number;     // nms / items per 100
  revenuePerItem: number;
  nmsCapUtil: number;  // nms / (items * 0.01) %
};

type MonthPoint = { label: string; mine: number; theirs: number };

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function toNum(v: number | string | null | undefined): number {
  return Number(v ?? 0) || 0;
}

function fmtN(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 100_000) return Math.round(n / 1000) + "k";
  if (n >= 10_000) return (n / 1000).toFixed(1) + "k";
  return Math.round(n).toLocaleString();
}
function fmtGbp(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000) return "£" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 100_000) return "£" + Math.round(n / 1000) + "k";
  if (n >= 10_000) return "£" + (n / 1000).toFixed(1) + "k";
  return "£" + Math.round(n).toLocaleString();
}
function fmtPct(n: number, dp = 1): string { return n.toFixed(dp) + "%"; }
function fmtRate(n: number): string { return n.toFixed(2); }

function aggregate(rows: MetricRow[]): Computed {
  const recent = [...rows]
    .sort((a, b) => b.year * 100 + b.month - (a.year * 100 + a.month))
    .slice(0, 12);

  const agg: Agg = {
    items:       recent.reduce((s, r) => s + (r.items_dispensed ?? 0), 0),
    eps:         recent.reduce((s, r) => s + (r.eps_items ?? 0), 0),
    nom:         recent.reduce((s, r) => s + (r.eps_nominations ?? 0), 0),
    pf:          recent.reduce((s, r) => s + (r.pharmacy_first_count ?? 0), 0),
    nms:         recent.reduce((s, r) => s + (r.nms_count ?? 0), 0),
    flu:         recent.reduce((s, r) => s + (r.flu_vaccinations ?? 0), 0),
    pfPayment:   recent.reduce((s, r) => s + toNum(r.pharmacy_first_payment), 0),
    grossCost:   recent.reduce((s, r) => s + toNum(r.gross_cost), 0),
    finalPayment:recent.reduce((s, r) => s + toNum(r.final_payment), 0),
    mcr:         recent.reduce((s, r) => s + (r.mcr_registrations ?? 0), 0),
    meth:        recent.reduce((s, r) => s + (r.methadone_items ?? 0), 0),
    smoke:       recent.reduce((s, r) => s + (r.smoking_cessation ?? 0), 0),
  };

  return {
    ...agg,
    digitRate:      agg.items > 0 ? (agg.eps / agg.items) * 100 : 0,
    nomRate:        agg.items > 0 ? (agg.nom / agg.items) * 100 : 0,
    pfRate:         agg.items > 0 ? (agg.pf / agg.items) * 100 : 0,
    nmsRate:        agg.items > 0 ? (agg.nms / agg.items) * 100 : 0,
    revenuePerItem: agg.items > 0 ? agg.finalPayment / agg.items : 0,
    nmsCapUtil:     agg.items > 0 ? (agg.nms / (agg.items * 0.01)) * 100 : 0,
  };
}

function buildTrend(myRows: MetricRow[], theirRows: MetricRow[]): MonthPoint[] {
  const myMap  = new Map(myRows.map(r => [`${r.year}-${String(r.month).padStart(2,"0")}`, r.items_dispensed ?? 0]));
  const thMap  = new Map(theirRows.map(r => [`${r.year}-${String(r.month).padStart(2,"0")}`, r.items_dispensed ?? 0]));
  const keys = Array.from(new Set([...myMap.keys(), ...thMap.keys()])).sort().slice(-12);
  return keys.map(k => {
    const [y, m] = k.split("-").map(Number);
    return { label: `${MONTHS[m - 1]} '${String(y).slice(2)}`, mine: myMap.get(k) ?? 0, theirs: thMap.get(k) ?? 0 };
  });
}

function rivalryScore(a: Computed, b: Computed): number {
  const sim = (x: number, y: number) => (x + y === 0 ? 1 : (2 * Math.min(x, y)) / (x + y));
  const scores = [
    sim(a.items, b.items),
    sim(a.pf, b.pf),
    sim(a.nms, b.nms),
    sim(a.pfRate, b.pfRate),
    sim(a.digitRate, b.digitRate),
  ];
  return Math.round(scores.reduce((s, v) => s + v, 0) / scores.length * 100);
}

type Tier = { label: string; sub: string; textCls: string; arcColor: string };
function tier(score: number): Tier {
  if (score >= 80) return { label: "Fierce rivals",     sub: "Nearly identical footprint — head-to-head competition.",            textCls: "text-red-500",    arcColor: "#ef4444" };
  if (score >= 60) return { label: "Close rivals",      sub: "Significant overlap — worth monitoring month-on-month.",           textCls: "text-amber-500",  arcColor: "#f59e0b" };
  if (score >= 30) return { label: "Local rivals",      sub: "Some volume overlap but different service profile.",               textCls: "text-yellow-500", arcColor: "#eab308" };
  return             { label: "Different markets",  sub: "Low overlap — likely serving different patients or geographies.",  textCls: "text-muted-foreground", arcColor: "#6b7280" };
}

function RivalryGauge({ score }: { score: number }) {
  const t = tier(score);
  const R = 52, CX = 70, CY = 68;
  const circ = Math.PI * R;
  const filled = (score / 100) * circ;
  const trackD = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={140} height={80} overflow="visible" className="[color:currentColor]">
        <path d={trackD} fill="none" stroke="hsl(var(--border))" strokeWidth={10} strokeLinecap="round" />
        <path d={trackD} fill="none" stroke={t.arcColor} strokeWidth={10} strokeLinecap="round"
          strokeDasharray={`${filled} ${circ}`} style={{ transition: "stroke-dasharray 0.7s ease" }} />
        <text x={CX} y={CY - 6} textAnchor="middle" fontSize={30} fontWeight="700" fill="hsl(var(--foreground))">{score}</text>
        <text x={CX} y={CY + 11} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))">/ 100</text>
      </svg>
      <div className="text-center">
        <p className={`text-base font-bold ${t.textCls}`}>{t.label}</p>
        <p className="text-[11px] text-muted-foreground max-w-[220px] leading-snug mt-0.5">{t.sub}</p>
      </div>
    </div>
  );
}

function MetricCard({
  label, note, mine, theirs, myName, theirName, format, higherIsBetter = true,
}: {
  label: string; note?: string;
  mine: number; theirs: number;
  myName: string; theirName: string;
  format: (n: number) => string;
  higherIsBetter?: boolean;
}) {
  const total = mine + theirs;
  const myPct = total > 0 ? (mine / total) * 100 : 50;
  const winner = higherIsBetter
    ? (mine > theirs ? "mine" : theirs > mine ? "theirs" : null)
    : (mine < theirs ? "mine" : theirs < mine ? "theirs" : null);

  return (
    <div className="rounded-xl border border-border overflow-hidden bg-card">
      <div className="px-4 py-2.5 border-b border-border bg-secondary/30">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        {note && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{note}</p>}
      </div>
      <div className="grid grid-cols-2 divide-x divide-border">
        <div className={`px-4 py-3.5 ${winner === "mine" ? "bg-primary/[0.07]" : ""}`}>
          <p className="text-[10px] text-muted-foreground font-medium truncate mb-1">{myName}</p>
          <p className={`text-2xl font-bold tabular-nums leading-none ${winner === "mine" ? "text-primary" : "text-foreground"}`}>
            {format(mine)}
          </p>
          {winner === "mine" && (
            <span className="inline-block mt-1.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 rounded px-1.5 py-0.5">
              ▲ Ahead
            </span>
          )}
        </div>
        <div className={`px-4 py-3.5 ${winner === "theirs" ? "bg-amber-500/[0.07]" : ""}`}>
          <p className="text-[10px] text-muted-foreground font-medium truncate mb-1">{theirName}</p>
          <p className={`text-2xl font-bold tabular-nums leading-none ${winner === "theirs" ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
            {format(theirs)}
          </p>
          {winner === "theirs" && (
            <span className="inline-block mt-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded px-1.5 py-0.5">
              ▲ Ahead
            </span>
          )}
        </div>
      </div>
      <div className="h-2.5 flex">
        <div className={`transition-all duration-500 ${winner === "mine" ? "bg-primary" : "bg-primary/40"}`} style={{ width: `${myPct}%` }} />
        <div className={`transition-all duration-500 ${winner === "theirs" ? "bg-amber-500" : "bg-amber-400/35"}`} style={{ width: `${100 - myPct}%` }} />
      </div>
    </div>
  );
}

function RateRow({
  label, mine, theirs, format, higherIsBetter = true,
}: {
  label: string; mine: number; theirs: number; format: (n: number) => string; higherIsBetter?: boolean;
}) {
  const winner = higherIsBetter
    ? (mine > theirs ? "mine" : theirs > mine ? "theirs" : null)
    : (mine < theirs ? "mine" : theirs < mine ? "theirs" : null);
  return (
    <div className="grid grid-cols-3 gap-3 py-3 border-b border-border/50 last:border-0 items-center">
      <div className="min-w-0">
        <p className={`text-sm font-bold tabular-nums ${winner === "mine" ? "text-primary" : "text-foreground"}`}>
          {format(mine)}
        </p>
        {winner === "mine" && <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">▲ better</p>}
      </div>
      <p className="text-[11px] text-muted-foreground text-center leading-tight font-medium">{label}</p>
      <div className="text-right min-w-0">
        <p className={`text-sm font-bold tabular-nums ${winner === "theirs" ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
          {format(theirs)}
        </p>
        {winner === "theirs" && <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">▲ better</p>}
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="h-px flex-1 bg-border" />
      <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">{title}</p>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

export function CompetitorDeepDive({ pharmacyId, pharmacyOds, pharmacyName, country, onClose }: Props) {
  const [competitor, setCompetitor] = useState<SearchPharmacy | null>(null);
  const [myRows, setMyRows] = useState<MetricRow[]>([]);
  const [theirRows, setTheirRows] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showRates, setShowRates] = useState(true);

  const isEngland  = country === "England";
  const isScotland = country === "Scotland";
  const isWales    = country === "Wales";
  const hasRevenue = isScotland || isWales;

  const SELECT = "month,year,items_dispensed,nms_count,pharmacy_first_count,flu_vaccinations,eps_items,eps_nominations,pharmacy_first_payment,gross_cost,final_payment,mcr_registrations,methadone_items,smoking_cessation";

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("dispensing_data")
        .select(SELECT)
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
      const { data: ph } = await supabase.from("pharmacies").select("id").eq("ods_code", p.ods_code).maybeSingle();
      if (!ph) { setLoading(false); return; }
      const { data } = await supabase
        .from("dispensing_data")
        .select(SELECT)
        .eq("pharmacy_id", ph.id)
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .limit(24);
      setTheirRows((data as MetricRow[]) ?? []);
      setLoading(false);
    })();
  };

  const myC    = myRows.length > 0 ? aggregate(myRows) : null;
  const theirC = theirRows.length > 0 ? aggregate(theirRows) : null;
  const score  = myC && theirC ? rivalryScore(myC, theirC) : null;
  const trend  = myRows.length > 0 && theirRows.length > 0 ? buildTrend(myRows, theirRows) : [];

  const myShort    = pharmacyName.length > 22 ? pharmacyName.slice(0, 22) + "…" : pharmacyName;
  const theirShort = competitor ? (competitor.name.length > 22 ? competitor.name.slice(0, 22) + "…" : competitor.name) : "Competitor";

  // Win tally
  type Pair = [keyof Computed, boolean]; // [key, higherIsBetter]
  const tallyPairs: Pair[] = [
    ["items", true], ["pf", true], ["nms", true], ["flu", true],
    ["pfRate", true], ["nmsRate", true], ["digitRate", true],
  ];
  const myWins    = myC && theirC ? tallyPairs.filter(([k, h]) => h ? myC[k] > theirC[k] : myC[k] < theirC[k]).length : 0;
  const theirWins = myC && theirC ? tallyPairs.filter(([k, h]) => h ? theirC[k] > myC[k] : theirC[k] < myC[k]).length : 0;

  return (
    <div className="mt-4 rounded-xl bg-card border border-border shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold">Competitor deep dive</h3>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-5 space-y-6">
        {/* Search */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-2">
            Search for a competitor pharmacy
          </label>
          <PharmacySearch onSelect={handleSelect} clearOnSelect={false} placeholder="Pharmacy name, postcode, or ODS code…" />
        </div>

        {loading && (
          <div className="py-10 text-sm text-muted-foreground animate-pulse text-center">Loading competitor data…</div>
        )}

        {!loading && !competitor && (
          <div className="py-10 text-center border-2 border-dashed border-border rounded-xl text-sm text-muted-foreground">
            <p className="font-medium">No competitor selected</p>
            <p className="text-xs mt-1">Search for a pharmacy above to start the comparison</p>
          </div>
        )}

        {!loading && competitor && myC && theirC && score !== null && (
          <>
            {/* VS banner */}
            <div className="grid grid-cols-[1fr_56px_1fr] gap-2 items-center rounded-xl border border-border bg-secondary/40 px-4 py-4">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-widest font-bold text-primary mb-1">You</p>
                <p className="text-sm font-bold leading-snug">{pharmacyName}</p>
                {country && <p className="text-[11px] text-muted-foreground mt-0.5">{country}</p>}
              </div>
              <p className="text-center text-lg font-black text-muted-foreground">VS</p>
              <div className="min-w-0 text-right">
                <p className="text-[10px] uppercase tracking-widest font-bold text-amber-600 dark:text-amber-400 mb-1">Them</p>
                <p className="text-sm font-bold leading-snug">{competitor.name}</p>
                {competitor.postcode && <p className="text-[11px] text-muted-foreground mt-0.5">{competitor.postcode}</p>}
              </div>
            </div>

            {/* Gauge */}
            <div className="flex justify-center py-2">
              <RivalryGauge score={score} />
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-6 text-[11px] font-semibold">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-primary/80 inline-block" />{myShort}</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-500/70 inline-block" />{theirShort}</span>
            </div>

            {/* ── Volume ── */}
            <div className="space-y-3">
              <SectionHeader title="Dispensing volume · 12-month total" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <MetricCard label="Items dispensed" mine={myC.items} theirs={theirC.items}
                  myName={myShort} theirName={theirShort} format={fmtN} />
                {isEngland && (
                  <MetricCard label="EPS items" note="Electronic prescriptions"
                    mine={myC.eps} theirs={theirC.eps}
                    myName={myShort} theirName={theirShort} format={fmtN} />
                )}
                {isEngland && (
                  <MetricCard label="EPS nominations"
                    mine={myC.nom} theirs={theirC.nom}
                    myName={myShort} theirName={theirShort} format={fmtN} />
                )}
              </div>
            </div>

            {/* ── Clinical services ── */}
            <div className="space-y-3">
              <SectionHeader title="Clinical services · 12-month total" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <MetricCard label="Pharmacy First" mine={myC.pf} theirs={theirC.pf}
                  myName={myShort} theirName={theirShort} format={fmtN} />
                {isEngland && (
                  <MetricCard label="New Medicine Service (NMS)"
                    mine={myC.nms} theirs={theirC.nms}
                    myName={myShort} theirName={theirShort} format={fmtN} />
                )}
                <MetricCard label="Flu vaccinations" mine={myC.flu} theirs={theirC.flu}
                  myName={myShort} theirName={theirShort} format={fmtN} />
                {isScotland && myC.mcr + theirC.mcr > 0 && (
                  <MetricCard label="MCR registrations" note="Medicines: Care & Review"
                    mine={myC.mcr} theirs={theirC.mcr}
                    myName={myShort} theirName={theirShort} format={fmtN} />
                )}
                {isScotland && myC.meth + theirC.meth > 0 && (
                  <MetricCard label="Methadone items" mine={myC.meth} theirs={theirC.meth}
                    myName={myShort} theirName={theirShort} format={fmtN} />
                )}
                {isScotland && myC.smoke + theirC.smoke > 0 && (
                  <MetricCard label="Smoking cessation" mine={myC.smoke} theirs={theirC.smoke}
                    myName={myShort} theirName={theirShort} format={fmtN} />
                )}
              </div>
            </div>

            {/* ── Efficiency rates ── */}
            <div className="space-y-2">
              <button
                className="w-full flex items-center justify-between"
                onClick={() => setShowRates(r => !r)}
              >
                <SectionHeader title="Efficiency rates" />
                <span className="text-muted-foreground shrink-0 ml-2">
                  {showRates ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </span>
              </button>

              {showRates && (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="grid grid-cols-3 gap-3 px-4 py-2.5 bg-secondary/30 border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <span>{myShort}</span>
                    <span className="text-center">Metric</span>
                    <span className="text-right">{theirShort}</span>
                  </div>
                  <div className="px-4">
                    <RateRow label="PF per 100 items" mine={myC.pfRate} theirs={theirC.pfRate}
                      format={n => fmtRate(n)} />
                    {isEngland && (
                      <RateRow label="NMS per 100 items" mine={myC.nmsRate} theirs={theirC.nmsRate}
                        format={n => fmtRate(n)} />
                    )}
                    {isEngland && (
                      <RateRow label="NMS cap utilisation (vs 1% cap)"
                        mine={myC.nmsCapUtil} theirs={theirC.nmsCapUtil}
                        format={fmtPct} />
                    )}
                    {isEngland && (
                      <RateRow label="EPS digitisation" mine={myC.digitRate} theirs={theirC.digitRate}
                        format={fmtPct} />
                    )}
                    {isEngland && (
                      <RateRow label="Nomination rate" mine={myC.nomRate} theirs={theirC.nomRate}
                        format={fmtPct} />
                    )}
                    {hasRevenue && myC.revenuePerItem + theirC.revenuePerItem > 0 && (
                      <RateRow label="Revenue per item" mine={myC.revenuePerItem} theirs={theirC.revenuePerItem}
                        format={n => `£${n.toFixed(2)}`} />
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ── Revenue (Scotland/Wales) ── */}
            {hasRevenue && myC.finalPayment + theirC.finalPayment > 0 && (
              <div className="space-y-3">
                <SectionHeader title="Revenue · 12-month total" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {myC.grossCost + theirC.grossCost > 0 && (
                    <MetricCard label="Gross drug cost" mine={myC.grossCost} theirs={theirC.grossCost}
                      myName={myShort} theirName={theirShort} format={fmtGbp} />
                  )}
                  <MetricCard label="Final payment" mine={myC.finalPayment} theirs={theirC.finalPayment}
                    myName={myShort} theirName={theirShort} format={fmtGbp} />
                </div>
              </div>
            )}

            {/* ── 12M trend ── */}
            {trend.length > 2 && (
              <div className="space-y-3">
                <SectionHeader title="Items dispensed — month by month" />
                <ResponsiveContainer width="100%" height={170}>
                  <LineChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false}
                      tickFormatter={v => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number, name: string) => [v.toLocaleString(), name]} />
                    <Line type="monotone" dataKey="mine" name={myShort} stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="theirs" name={theirShort} stroke="#f59e0b" strokeWidth={2.5} dot={false} strokeDasharray="6 3" />
                  </LineChart>
                </ResponsiveContainer>
                <div className="flex items-center justify-center gap-6 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="inline-block w-6 h-[2.5px] bg-primary rounded" />{myShort}</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-6 h-[2.5px] rounded" style={{ background: "repeating-linear-gradient(to right, #f59e0b 0, #f59e0b 5px, transparent 5px, transparent 8px)" }} />{theirShort}</span>
                </div>
              </div>
            )}

            {/* ── Summary verdict ── */}
            <div className="rounded-xl border border-border bg-secondary/40 px-5 py-4 space-y-2">
              <p className="text-sm font-semibold">Summary</p>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-primary">{myShort}</span> leads on{" "}
                <span className="font-semibold text-foreground">{myWins}</span> of{" "}
                {tallyPairs.length} tracked metrics
                {theirWins > 0
                  ? <>, while <span className="font-semibold text-amber-600 dark:text-amber-400">{theirShort}</span> leads on <span className="font-semibold text-foreground">{theirWins}</span>.</>
                  : <>, outperforming on all tracked dimensions.</>
                }
              </p>
              {isEngland && (
                <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                  <div className="rounded-lg bg-card border border-border px-3 py-2.5">
                    <p className="text-muted-foreground">NMS cap utilisation</p>
                    <div className="flex items-end gap-2 mt-1">
                      <span className={`text-lg font-bold tabular-nums ${myC.nmsCapUtil >= 80 ? "text-emerald-600 dark:text-emerald-400" : myC.nmsCapUtil >= 50 ? "text-amber-500" : "text-red-500"}`}>{fmtPct(myC.nmsCapUtil, 0)}</span>
                      <span className="text-muted-foreground text-[10px] mb-0.5">vs {fmtPct(theirC.nmsCapUtil, 0)}</span>
                    </div>
                  </div>
                  <div className="rounded-lg bg-card border border-border px-3 py-2.5">
                    <p className="text-muted-foreground">EPS digitisation</p>
                    <div className="flex items-end gap-2 mt-1">
                      <span className={`text-lg font-bold tabular-nums ${myC.digitRate >= 90 ? "text-emerald-600 dark:text-emerald-400" : myC.digitRate >= 75 ? "text-amber-500" : "text-red-500"}`}>{fmtPct(myC.digitRate, 0)}</span>
                      <span className="text-muted-foreground text-[10px] mb-0.5">vs {fmtPct(theirC.digitRate, 0)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

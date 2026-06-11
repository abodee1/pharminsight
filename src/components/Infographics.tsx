// Editorial / FT-style infographic primitives.
// Built on top of semantic tokens (no hard-coded colors).

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";

export type PeriodWindow = number;
/** Sentinel value meaning "all available history". Large enough that
 *  `Array.prototype.slice(-ALL_PERIOD)` returns the entire series. */
export const ALL_PERIOD: PeriodWindow = 9999;
export const PERIOD_OPTIONS: PeriodWindow[] = [3, 6, 12, 24, ALL_PERIOD];

/* ----------------------------------------------------------------
 * PeriodPills
 * 3M / 6M / 12M / 24M / All selector pills, used to scope every chart.
 * ---------------------------------------------------------------- */
export function PeriodPills({
  value,
  onChange,
  options = PERIOD_OPTIONS,
  className = "",
}: {
  value: PeriodWindow;
  onChange: (v: PeriodWindow) => void;
  options?: PeriodWindow[];
  className?: string;
}) {
  return (
    <div className={`inline-flex items-center gap-1 rounded-md border border-border bg-secondary/40 p-0.5 ${className}`}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={[
            "px-2.5 py-0.5 text-[11px] font-semibold rounded-sm transition-colors",
            value === opt
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          {opt >= ALL_PERIOD ? "All" : `${opt}M`}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------
 * TrendCard
 * Compact line chart with title, headline value, delta vs prior
 * window, an embedded PeriodPills selector and optional comparison
 * series. Use this everywhere instead of bespoke chart blocks.
 * ---------------------------------------------------------------- */
export function TrendCard({
  title,
  subtitle,
  caption,
  points, // last 12 months, oldest -> newest
  window,
  onWindowChange,
  formatValue = (n: number) => Math.round(n).toLocaleString(),
  comparisonLabel,
  primaryLabel = "You",
  options = PERIOD_OPTIONS,
  height = 220,
  altSeries,
}: {
  title: string;
  subtitle?: string;
  caption?: string;
  points: { label: string; value: number; comparison?: number }[];
  window: PeriodWindow;
  onWindowChange: (v: PeriodWindow) => void;
  formatValue?: (n: number) => string;
  comparisonLabel?: string;
  primaryLabel?: string;
  options?: PeriodWindow[];
  height?: number;
  /** Optional second-unit toggle (e.g. £ remuneration alongside a count series).
   *  Same length & order as `points`. When provided, a small unit selector
   *  appears next to the period pills and swaps the displayed series. */
  altSeries?: {
    primaryUnitLabel: string;   // e.g. "#"
    altUnitLabel: string;       // e.g. "£"
    altValues: number[];        // aligned with points
    altFormat?: (n: number) => string;
    altTitleSuffix?: string;    // appended to subtitle when alt is active
  };
}) {
  const [unit, setUnit] = useState<"primary" | "alt">("primary");
  const activeFormat = unit === "alt" && altSeries?.altFormat ? altSeries.altFormat : formatValue;

  const seriesPoints = useMemo(() => {
    if (unit === "alt" && altSeries) {
      return points.map((p, i) => ({
        label: p.label,
        value: altSeries.altValues[i] ?? 0,
        comparison: undefined as number | undefined,
      }));
    }
    return points;
  }, [points, unit, altSeries]);

  const sliced = seriesPoints.slice(-window);

  let lastReportedIdx = -1;
  for (let i = sliced.length - 1; i >= 0; i--) {
    if ((sliced[i]?.value ?? 0) > 0) { lastReportedIdx = i; break; }
  }
  let firstReportedIdx = -1;
  for (let i = 0; i < sliced.length; i++) {
    if ((sliced[i]?.value ?? 0) > 0) { firstReportedIdx = i; break; }
  }
  const hasData = lastReportedIdx >= 0;
  const latest = hasData ? sliced[lastReportedIdx].value : 0;
  const first = firstReportedIdx >= 0 ? sliced[firstReportedIdx].value : 0;
  const canDelta = hasData && firstReportedIdx >= 0 && lastReportedIdx > firstReportedIdx && first > 0;
  const delta = canDelta ? Math.round(((latest - first) / first) * 100) : 0;
  const tone = delta > 0 ? "text-emerald-700" : delta < 0 ? "text-rose-700" : "text-muted-foreground";
  const trailingLag = hasData && lastReportedIdx < sliced.length - 1;
  const latestLabel = hasData ? sliced[lastReportedIdx].label : null;

  let cmpLastIdx = -1;
  for (let i = sliced.length - 1; i >= 0; i--) {
    if ((sliced[i]?.comparison ?? 0) > 0) { cmpLastIdx = i; break; }
  }
  const chartData = sliced.map((p, i) => ({
    label: p.label,
    value: i <= lastReportedIdx ? p.value : null,
    comparison: i <= cmpLastIdx ? p.comparison ?? null : null,
  }));

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight truncate">{title}</h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {subtitle}{unit === "alt" && altSeries?.altTitleSuffix ? ` · ${altSeries.altTitleSuffix}` : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {altSeries && (
            <div className="inline-flex items-center rounded-md border border-border bg-secondary/40 p-0.5">
              <button
                type="button"
                onClick={() => setUnit("primary")}
                className={[
                  "px-2.5 py-0.5 text-[11px] font-semibold rounded-sm transition-colors",
                  unit === "primary" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
                aria-pressed={unit === "primary"}
              >
                {altSeries.primaryUnitLabel}
              </button>
              <button
                type="button"
                onClick={() => setUnit("alt")}
                className={[
                  "px-2.5 py-0.5 text-[11px] font-semibold rounded-sm transition-colors",
                  unit === "alt" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
                aria-pressed={unit === "alt"}
              >
                {altSeries.altUnitLabel}
              </button>
            </div>
          )}
          <PeriodPills value={window} onChange={onWindowChange} options={options} />
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-2xl font-semibold tabular-nums">{activeFormat(latest)}</p>
        {canDelta && (
          <p className={`text-xs font-semibold ${tone}`}>
            {delta >= 0 ? "+" : ""}{delta}% over reported window
          </p>
        )}
      </div>
      {trailingLag && latestLabel && (
        <p className="text-[11px] text-muted-foreground -mt-1 mb-2">
          Latest reported · {latestLabel} (later months awaiting publication)
        </p>
      )}

      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
            <YAxis
              tick={{ fontSize: 10 }}
              stroke="var(--muted-foreground)"
              width={56}
              tickFormatter={(v) => {
                if (unit === "alt") {
                  if (v >= 1e6) return "£" + (v / 1e6).toFixed(1) + "m";
                  if (v >= 1e3) return "£" + (v / 1e3).toFixed(0) + "k";
                  return "£" + v;
                }
                if (v >= 1e6) return (v / 1e6).toFixed(1) + "m";
                if (v >= 1e3) return (v / 1e3).toFixed(0) + "k";
                return String(v);
              }}
            />
            <Tooltip
              contentStyle={{
                background: "var(--card)", border: "1px solid var(--border)",
                borderRadius: 6, fontSize: 12,
              }}
              formatter={(v: number) => activeFormat(v)}
            />
            {comparisonLabel && unit === "primary" && <Legend wrapperStyle={{ fontSize: 11 }} />}
            <Line
              type="monotone" dataKey="value" name={unit === "alt" ? (altSeries?.altUnitLabel || primaryLabel) : primaryLabel}
              stroke="var(--cmp-1, var(--chart-1))" strokeWidth={2} dot={false}
              isAnimationActive={false} connectNulls={false}
            />
            {comparisonLabel && unit === "primary" && (
              <Line
                type="monotone" dataKey="comparison" name={comparisonLabel}
                stroke="var(--cmp-2, var(--chart-2))" strokeWidth={2} dot={false}
                strokeDasharray="4 4" isAnimationActive={false} connectNulls={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {caption && <p className="mt-3 text-xs italic text-muted-foreground border-t border-border pt-2">{caption}</p>}
    </div>
  );
}


/* ----------------------------------------------------------------
 * GpPrescribingCard
 * Items prescribed by GPs whose patients use this pharmacy (linkage
 * data). Self-loading by pharmacy ODS code, with a period selector.
 * ---------------------------------------------------------------- */
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

type GpFeeder = {
  code: string;
  name: string | null;
  postcode: string | null;
  address: string | null;
  items: number;        // window total
  itemsPrev: number;    // previous window total (same length)
  listSize: number | null;
  share: number;        // 0..1 of pharmacy total in window
};

export function GpPrescribingCard({
  pharmacyOds,
  defaultWindow = 12,
  title = "GP scripts feeding this pharmacy",
}: {
  pharmacyOds: string | null | undefined;
  defaultWindow?: PeriodWindow;
  title?: string;
}) {
  const [win, setWin] = useState<PeriodWindow>(defaultWindow);
  const [rows, setRows] = useState<
    { year: number; month: number; items: number; gp_count: number }[]
  >([]);
  const [allLinkage, setAllLinkage] = useState<
    { year: number; month: number; practice_code: string; items_dispensed: number }[]
  >([]);
  const [practiceMeta, setPracticeMeta] = useState<Map<string, { name: string | null; postcode: string | null; address: string | null }>>(new Map());
  const [listSizes, setListSizes] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pharmacyOds) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("gp_pharmacy_linkage")
        .select("year,month,practice_code,items_dispensed")
        .eq("pharmacy_ods_code", pharmacyOds)
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .limit(20000);
      if (cancelled) return;
      if (error || !data) {
        setRows([]); setAllLinkage([]); setLoading(false); return;
      }
      const byMonth = new Map<string, { year: number; month: number; items: number; gps: Set<string> }>();
      const codes = new Set<string>();
      for (const r of data) {
        const k = `${r.year}-${r.month}`;
        const cur = byMonth.get(k) || { year: r.year, month: r.month, items: 0, gps: new Set<string>() };
        cur.items += Number(r.items_dispensed) || 0;
        cur.gps.add(r.practice_code);
        byMonth.set(k, cur);
        codes.add(r.practice_code);
      }
      const sorted = [...byMonth.values()]
        .sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month))
        .map((v) => ({ year: v.year, month: v.month, items: v.items, gp_count: v.gps.size }));

      // Resolve GP metadata + most-recent list size
      const codeArr = [...codes];
      const meta = new Map<string, { name: string | null; postcode: string | null; address: string | null }>();
      const sizes = new Map<string, number>();
      if (codeArr.length) {
        for (let i = 0; i < codeArr.length; i += 200) {
          const slice = codeArr.slice(i, i + 200);
          const [{ data: gps }, { data: ls }] = await Promise.all([
            supabase.from("gp_practices")
              .select("practice_code,practice_name,google_name,postcode,address_line")
              .in("practice_code", slice),
            supabase.from("gp_list_sizes")
              .select("practice_code,registered_patients,list_size_date")
              .in("practice_code", slice)
              .order("list_size_date", { ascending: false }),
          ]);
          (gps || []).forEach((g: { practice_code: string; practice_name: string | null; google_name: string | null; postcode: string | null; address_line: string | null }) => {
            meta.set(g.practice_code, { name: g.google_name || g.practice_name, postcode: g.postcode, address: g.address_line });
          });
          (ls || []).forEach((l: { practice_code: string; registered_patients: number }) => {
            if (!sizes.has(l.practice_code)) sizes.set(l.practice_code, l.registered_patients);
          });
        }
      }

      setRows(sorted);
      setAllLinkage(data as { year: number; month: number; practice_code: string; items_dispensed: number }[]);
      setPracticeMeta(meta);
      setListSizes(sizes);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [pharmacyOds]);

  const points = useMemo(
    () => rows.slice(-Math.max(12, win)).map((r) => ({
      label: `${MONTHS[r.month - 1]} ${String(r.year).slice(2)}`,
      value: r.items,
    })),
    [rows, win],
  );

  // Compute window-bounded top feeders w/ prior-window comparison + share
  const topGps = useMemo<GpFeeder[]>(() => {
    if (!rows.length || !allLinkage.length) return [];
    // Pull most recent N months actually present in data
    const monthKeys = rows.map((r) => r.year * 12 + r.month);
    const latest = monthKeys[monthKeys.length - 1];
    const curStart = latest - (win - 1);
    const prevStart = latest - (2 * win - 1);
    const prevEnd = latest - win;

    const cur = new Map<string, number>();
    const prev = new Map<string, number>();
    let totalCur = 0;
    for (const r of allLinkage) {
      const k = r.year * 12 + r.month;
      const v = Number(r.items_dispensed) || 0;
      if (k >= curStart && k <= latest) {
        cur.set(r.practice_code, (cur.get(r.practice_code) || 0) + v);
        totalCur += v;
      } else if (k >= prevStart && k <= prevEnd) {
        prev.set(r.practice_code, (prev.get(r.practice_code) || 0) + v);
      }
    }
    const named = [...cur.entries()]
      .filter(([code]) => practiceMeta.get(code)?.name)
      .map(([code, items]) => {
        const m = practiceMeta.get(code)!;
        return {
          code,
          name: m.name,
          postcode: m.postcode,
          address: m.address,
          items,
          itemsPrev: prev.get(code) || 0,
          listSize: listSizes.get(code) ?? null,
          share: totalCur > 0 ? items / totalCur : 0,
        };
      })
      .sort((a, b) => b.items - a.items)
      .slice(0, 8);
    return named;
  }, [allLinkage, rows, win, practiceMeta, listSizes]);

  if (!pharmacyOds) return null;
  if (!loading && !rows.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-3 text-xs text-muted-foreground">No GP linkage data reported for this pharmacy yet.</p>
      </div>
    );
  }

  const sliced = rows.slice(-win);
  const totalItems = sliced.reduce((a, r) => a + r.items, 0);
  const avgGps = sliced.length
    ? Math.round(sliced.reduce((a, r) => a + r.gp_count, 0) / sliced.length)
    : 0;

  return (
    <div className="space-y-3">
      <Flippable
        minHeight={340}
        front={
          <TrendCard
            title={title}
            subtitle={loading ? "Loading…" : `${avgGps} GP practices · ${totalItems.toLocaleString()} items over ${win >= ALL_PERIOD ? "all time" : `${win}M`}`}
            caption="From official England, Scotland and NI linkage data — items dispensed against scripts issued by each GP practice."
            points={points}
            window={win}
            onWindowChange={setWin}
            formatValue={(n) => n.toLocaleString()}
          />
        }
        back={
          <ExplainPanel title="How to read this chart">
            <p>
              Each point on the line is the <strong>total number of NHS prescription items</strong> this pharmacy dispensed in that month
              originating from GP practices it has a registered link with.
            </p>
            <ul className="list-disc pl-4 space-y-1">
              <li><strong>{avgGps} GP practices</strong> — on average, this many distinct surgeries sent scripts to this pharmacy each month in the selected window.</li>
              <li><strong>{totalItems.toLocaleString()} items</strong> — total prescription items dispensed over the last {win} months from linked GPs.</li>
              <li>A <strong>rising line</strong> means the pharmacy is capturing more GP-originated scripts; a falling line means script volume from feeders is declining.</li>
            </ul>
            <p className="text-muted-foreground">
              Source: official NHS BSA (England), PHS (Scotland) and BSO (Northern Ireland) GP-to-pharmacy linkage extracts.
            </p>
          </ExplainPanel>
        }
      />
      {topGps.length > 0 && (
        <Flippable
          minHeight={Math.max(240, 72 + topGps.length * 78)}
          front={
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm h-full">
              <div className="flex items-center justify-between mb-3 pr-28">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Top GP feeders · {win >= ALL_PERIOD ? "all-time" : `last ${win} months`}</p>
                <p className="text-[10px] text-muted-foreground hidden sm:block">
                  Items · Share · Items / patient · Δ vs prior {win >= ALL_PERIOD ? "window" : `${win}M`}
                </p>
              </div>
              <ul className="space-y-2 text-xs">
                {topGps.map((g) => {
                  const delta = g.itemsPrev > 0 ? Math.round(((g.items - g.itemsPrev) / g.itemsPrev) * 100) : null;
                  const tone = delta == null ? "text-muted-foreground" : delta > 0 ? "text-emerald-700" : delta < 0 ? "text-rose-700" : "text-muted-foreground";
                  const perPatient = g.listSize && g.listSize > 0 ? g.items / g.listSize : null;
                  return (
                    <li key={g.code} className="border-b border-border last:border-b-0 pb-2 last:pb-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{g.name}</p>
                          <p className="text-[10px] text-muted-foreground font-mono truncate">
                            {g.code}{g.postcode ? ` · ${g.postcode}` : ""}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-semibold tabular-nums">{g.items.toLocaleString()} items</p>
                          <p className="text-[10px] text-muted-foreground tabular-nums">
                            {(g.share * 100).toFixed(1)}% share
                          </p>
                        </div>
                      </div>
                      <div className="mt-1 grid grid-cols-3 gap-2 text-[10px]">
                        <div className="rounded bg-secondary/40 px-2 py-1">
                          <span className="text-muted-foreground">List size · </span>
                          <span className="font-semibold tabular-nums">{g.listSize ? g.listSize.toLocaleString() : "—"}</span>
                        </div>
                        <div className="rounded bg-secondary/40 px-2 py-1">
                          <span className="text-muted-foreground">Items / patient · </span>
                          <span className="font-semibold tabular-nums">{perPatient != null ? perPatient.toFixed(1) : "—"}</span>
                        </div>
                        <div className={`rounded bg-secondary/40 px-2 py-1 ${tone}`}>
                          <span className="text-muted-foreground">Δ · </span>
                          <span className="font-semibold tabular-nums">
                            {delta == null ? "—" : `${delta >= 0 ? "+" : ""}${delta}%`}
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          }
          back={
            <ExplainPanel title="What 'Top GP feeders' tells you">
              <p>
                These are the GP surgeries sending the <strong>most prescription items</strong> to this pharmacy over the last {win} months,
                ranked by volume. Together they show where the pharmacy's NHS dispensing income originates.
              </p>
              <ul className="list-disc pl-4 space-y-1">
                <li><strong>Items</strong> — total prescription items dispensed from that surgery's scripts in the window.</li>
                <li><strong>Share</strong> — that surgery's % of all linked-GP items dispensed by this pharmacy. A high share (e.g. &gt;30%) means heavy reliance on one practice.</li>
                <li><strong>List size</strong> — number of patients registered at the GP practice (latest NHS list-size return).</li>
                <li><strong>Items / patient</strong> — items dispensed per registered patient. Higher numbers suggest the pharmacy is the dominant dispenser for that practice's patients.</li>
                <li><strong>Δ vs prior {win}M</strong> — % change vs the previous equivalent window. Green = growing feeder, red = shrinking feeder (a possible churn signal).</li>
              </ul>
              <p className="text-muted-foreground">
                Use this to spot concentration risk (one surgery dominating revenue), under-served nearby practices, and feeders trending up or down.
              </p>
            </ExplainPanel>
          }
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------
 * Flippable + ExplainPanel
 * Click the ⓘ badge in the corner to flip the card and reveal a
 * plain-language explanation of what the visualisation shows.
 * ---------------------------------------------------------------- */
function Flippable({
  front,
  back,
  minHeight = 280,
}: {
  front: React.ReactNode;
  back: React.ReactNode;
  minHeight?: number;
}) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className="relative [perspective:1600px]" style={{ minHeight }}>
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? "Hide explanation" : "What does this mean?"}
        className="absolute right-2 top-2 z-10 inline-flex h-7 items-center gap-1 rounded-full border border-border bg-background/90 px-2 text-[10px] font-medium text-muted-foreground shadow-sm hover:bg-secondary hover:text-foreground transition"
      >
        {flipped ? "← Back to chart" : "ⓘ What does this mean?"}
      </button>
      <div
        className="relative w-full transition-transform duration-500 [transform-style:preserve-3d]"
        style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)", minHeight }}
      >
        <div className="absolute inset-0 [backface-visibility:hidden]">
          {front}
        </div>
        <div className="absolute inset-0 [backface-visibility:hidden]" style={{ transform: "rotateY(180deg)" }}>
          {back}
        </div>
      </div>
    </div>
  );
}

function ExplainPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="h-full rounded-lg border border-border bg-card p-5 pr-10 shadow-sm overflow-auto">
      <h4 className="text-sm font-semibold mb-2">{title}</h4>
      <div className="space-y-2 text-xs leading-relaxed text-foreground">
        {children}
      </div>
    </div>
  );
}



const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* ----------------------------------------------------------------
 * PercentileRail
 * A horizontal 0–100 track with a marker for "you" and optional
 * tick marks for peer/national averages, plus an editorial caption.
 * ---------------------------------------------------------------- */
export function PercentileRail({
  label,
  value,
  values, // population values to compute percentile against
  caption,
  peerLabel = "Peer avg",
  nationalLabel,
  formatValue = fmt,
}: {
  label: string;
  value: number;
  values: number[];
  caption?: string;
  peerLabel?: string;
  nationalLabel?: string;
  formatValue?: (n: number) => string;
}) {
  const { percentile, peerAvg, max } = useMemo(() => {
    const arr = values.filter((v) => typeof v === "number" && !isNaN(v));
    if (!arr.length) return { percentile: 0, peerAvg: 0, max: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const below = sorted.filter((v) => v < value).length;
    const pct = Math.round((below / sorted.length) * 100);
    const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    return { percentile: pct, peerAvg: avg, max: sorted[sorted.length - 1] };
  }, [values, value]);

  const peerPct = useMemo(() => {
    const arr = values.filter((v) => typeof v === "number" && !isNaN(v));
    if (!arr.length) return 50;
    const sorted = [...arr].sort((a, b) => a - b);
    const below = sorted.filter((v) => v < peerAvg).length;
    return Math.round((below / sorted.length) * 100);
  }, [values, peerAvg]);

  const tone =
    percentile >= 75 ? "text-emerald-700" : percentile <= 25 ? "text-rose-700" : "text-foreground";
  const rank = values.length ? values.length - Math.round((percentile / 100) * values.length) + 1 : 0;

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-semibold tracking-tight">{label}</h3>
        <p className={`text-xs ${tone}`}>
          <span className="font-semibold">{ordinal(percentile)}</span> percentile
          {values.length > 1 && (
            <span className="text-muted-foreground"> · {ordinal(rank)} of {values.length}</span>
          )}
        </p>
      </div>

      {/* Track */}
      <div className="mt-4 relative h-8">
        {/* Quartile band */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 rounded-full bg-secondary/60 overflow-hidden">
          {/* Mid 50% (Q1–Q3) shading */}
          <div className="absolute top-0 bottom-0 left-1/4 right-1/4 bg-secondary" />
          {/* Filled portion to user */}
          <div
            className="absolute top-0 bottom-0 left-0 bg-foreground/80 rounded-full transition-all"
            style={{ width: `${Math.max(2, percentile)}%` }}
          />
        </div>

        {/* Peer avg tick */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-4 w-px bg-muted-foreground/60"
          style={{ left: `${peerPct}%` }}
          title={`${peerLabel}: ${formatValue(peerAvg)}`}
        />

        {/* You marker */}
        <div
          className="absolute -translate-x-1/2 top-0"
          style={{ left: `${Math.max(2, Math.min(98, percentile))}%` }}
        >
          <div className="h-8 w-px bg-foreground" />
          <div className="absolute -translate-x-1/2 -top-1.5 h-3 w-3 rounded-full bg-foreground border-2 border-card" />
        </div>

        {/* Endpoint scale */}
        <div className="absolute -bottom-4 left-0 text-[10px] uppercase tracking-wider text-muted-foreground">
          0
        </div>
        <div className="absolute -bottom-4 right-0 text-[10px] uppercase tracking-wider text-muted-foreground">
          Top
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-1 text-xs">
        <div>
          <p className="text-muted-foreground uppercase tracking-wider text-[10px]">You</p>
          <p className="font-semibold tabular-nums text-sm">{formatValue(value)}</p>
        </div>
        <div>
          <p className="text-muted-foreground uppercase tracking-wider text-[10px]">{peerLabel}</p>
          <p className="tabular-nums">{formatValue(peerAvg)}</p>
        </div>
        <div className="text-right">
          <p className="text-muted-foreground uppercase tracking-wider text-[10px]">
            {nationalLabel || "Highest"}
          </p>
          <p className="tabular-nums">{formatValue(max)}</p>
        </div>
      </div>

      {caption && <p className="mt-3 text-xs italic text-muted-foreground border-t border-border pt-2">{caption}</p>}
    </div>
  );
}

/* ----------------------------------------------------------------
 * DistributionStrip
 * Small histogram of the population with a vertical marker for the
 * highlighted subject. Editorial caption underneath.
 * ---------------------------------------------------------------- */
export function DistributionStrip({
  label,
  values,
  highlightValue,
  highlightLabel = "You",
  bins = 24,
  caption,
}: {
  label: string;
  values: number[];
  highlightValue?: number;
  highlightLabel?: string;
  bins?: number;
  caption?: string;
}) {
  const { buckets, max, min, peakIdx, highlightIdx } = useMemo(() => {
    const arr = values.filter((v) => typeof v === "number" && !isNaN(v));
    if (!arr.length) return { buckets: [] as number[], max: 0, min: 0, peakIdx: -1, highlightIdx: -1 };
    const lo = Math.min(...arr);
    const hi = Math.max(...arr);
    // Log-scale binning so right-skewed dispensing data spreads evenly across bins.
    const logLo = Math.log1p(lo);
    const logHi = Math.log1p(hi);
    const logRange = logHi - logLo || 1;
    const buckets = new Array(bins).fill(0);
    arr.forEach((v) => {
      const idx = Math.min(bins - 1, Math.floor(((Math.log1p(v) - logLo) / logRange) * bins));
      buckets[idx] += 1;
    });
    const peak = buckets.indexOf(Math.max(...buckets));
    const hIdx =
      typeof highlightValue === "number"
        ? Math.min(bins - 1, Math.max(0, Math.floor(((Math.log1p(highlightValue) - logLo) / logRange) * bins)))
        : -1;
    return { buckets, max: hi, min: lo, peakIdx: peak, highlightIdx: hIdx };
  }, [values, bins, highlightValue]);

  if (!buckets.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-semibold">{label}</h3>
        <p className="mt-3 text-xs text-muted-foreground">No data to display.</p>
      </div>
    );
  }

  const peakValue = Math.max(...buckets);

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-semibold tracking-tight">{label}</h3>
        <p className="text-xs text-muted-foreground">{values.length.toLocaleString()} pharmacies</p>
      </div>

      <div className="mt-4 flex items-end gap-[2px] h-24">
        {buckets.map((count, i) => {
          const h = (count / peakValue) * 100;
          const isPeak = i === peakIdx;
          const isHighlight = i === highlightIdx;
          return (
            <div
              key={i}
              className={[
                "flex-1 rounded-sm transition-all",
                isHighlight
                  ? "bg-foreground"
                  : isPeak
                  ? "bg-muted-foreground/70"
                  : "bg-secondary",
              ].join(" ")}
              style={{ height: `${Math.max(2, h)}%` }}
              title={`${count} pharmacies`}
            />
          );
        })}
      </div>

      <div className="mt-2 flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{fmt(min)}</span>
        <span>{fmt(max)}</span>
      </div>

      {highlightIdx >= 0 && (
        <p className="mt-3 text-xs">
          <span className="inline-block h-2 w-2 rounded-sm bg-foreground mr-2 align-middle" />
          <span className="font-semibold">{highlightLabel}</span>{" "}
          <span className="text-muted-foreground">sits in the {ordinal(Math.round(((highlightIdx + 0.5) / bins) * 100))} percentile band.</span>
        </p>
      )}

      {caption && <p className="mt-2 text-xs italic text-muted-foreground border-t border-border pt-2">{caption}</p>}
    </div>
  );
}

/* ----------------------------------------------------------------
 * AnnotatedSparkline
 * Sparkline with peak/trough call-outs and a YoY headline figure.
 * ---------------------------------------------------------------- */
export function AnnotatedSparkline({
  label,
  points,
  unit = "",
  caption,
}: {
  label: string;
  points: { period: string; value: number }[];
  unit?: string;
  caption?: string;
}) {
  // Drop months with no reported activity so the trough doesn't sit at 0
  // for metrics (Pharmacy First, NMS, EPS) that started later in the window.
  const filtered = points.filter((p) => p.value > 0);
  const usable = filtered.length >= 2 ? filtered : points;

  if (usable.length < 2) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-semibold">{label}</h3>
        <p className="mt-3 text-xs text-muted-foreground">Not enough data.</p>
      </div>
    );
  }

  const w = 320;
  const h = 80;
  const pad = 8;
  const vals = usable.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const xs = usable.map((_, i) => pad + (i / (usable.length - 1)) * (w - pad * 2));
  const ys = usable.map((p) => h - pad - ((p.value - min) / range) * (h - pad * 2));

  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x},${ys[i]}`).join(" ");
  const area = `${path} L${xs[xs.length - 1]},${h - pad} L${xs[0]},${h - pad} Z`;

  const peakIdx = vals.indexOf(max);
  const troughIdx = vals.indexOf(min);
  const first = vals[0];
  const last = vals[vals.length - 1];
  const hasChange = first > 0;
  const yoy = hasChange ? Math.round(((last - first) / first) * 100) : 0;
  const tone = !hasChange ? "text-muted-foreground" : yoy > 0 ? "text-emerald-700" : yoy < 0 ? "text-rose-700" : "text-muted-foreground";

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-semibold tracking-tight">{label}</h3>
        <p className={`text-xs font-semibold ${tone}`}>
          {hasChange ? `${yoy >= 0 ? "+" : ""}${yoy}% over the period` : "Insufficient reported data"}
        </p>
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} className="w-full mt-3 h-20">
        <path d={area} fill="var(--muted)" opacity={0.35} />
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-foreground" />
        <circle cx={xs[peakIdx]} cy={ys[peakIdx]} r={3} className="fill-foreground" />
        <circle cx={xs[troughIdx]} cy={ys[troughIdx]} r={3} className="fill-muted-foreground" />
      </svg>

      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>
          Peak: <span className="font-semibold text-foreground">{fmt(max)}{unit}</span> · {usable[peakIdx].period}
        </span>
        <span>
          Low: <span className="font-semibold text-foreground">{fmt(min)}{unit}</span> · {usable[troughIdx].period}
        </span>
      </div>
      {caption && <p className="mt-3 text-xs italic text-muted-foreground border-t border-border pt-2">{caption}</p>}
    </div>
  );
}


/* ----------------------------------------------------------------
 * ShareDonut
 * SVG donut chart with FT-style legend rows showing share + value.
 * ---------------------------------------------------------------- */
export function ShareDonut({
  label,
  segments,
  caption,
  formatValue = fmt,
}: {
  label: string;
  segments: { label: string; value: number }[];
  caption?: string;
  formatValue?: (n: number) => string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const filtered = segments.filter((s) => s.value > 0);
  if (!total || !filtered.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-semibold">{label}</h3>
        <p className="mt-3 text-xs text-muted-foreground">No data to display.</p>
      </div>
    );
  }

  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const tones = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
    "var(--muted-foreground)",
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h3 className="text-sm font-semibold tracking-tight">{label}</h3>

      <div className="mt-4 flex flex-wrap items-center gap-6">
        <svg viewBox="0 0 100 100" className="h-32 w-32 -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--secondary)" strokeWidth="14" />
          {filtered.map((s, i) => {
            const len = (s.value / total) * c;
            const seg = (
              <circle
                key={s.label}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={tones[i % tones.length]}
                strokeWidth="14"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return seg;
          })}
        </svg>

        <ul className="flex-1 min-w-[200px] space-y-1.5 text-sm">
          {filtered
            .slice()
            .sort((a, b) => b.value - a.value)
            .map((s) => {
              const idx = filtered.findIndex((x) => x.label === s.label);
              const pct = Math.round((s.value / total) * 100);
              return (
                <li key={s.label} className="flex items-center justify-between gap-3 border-b border-border last:border-b-0 pb-1.5 last:pb-0">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: tones[idx % tones.length] }} />
                    <span className="text-xs">{s.label}</span>
                  </span>
                  <span className="text-xs tabular-nums">
                    {formatValue(s.value)} <span className="text-muted-foreground">· {pct}%</span>
                  </span>
                </li>
              );
            })}
        </ul>
      </div>

      {caption && <p className="mt-3 text-xs italic text-muted-foreground border-t border-border pt-2">{caption}</p>}
    </div>
  );
}


/* ----------------------------------------------------------------
 * MetricSpotlight
 * Customisable per-metric cohort lens. Users pick a metric from the
 * toggle pills and see their percentile rail + peer distribution for
 * the same reporting period, side by side. Replaces a fixed PF-only
 * spread chart with a single configurable surface.
 * ---------------------------------------------------------------- */
export type SpotlightMetric = {
  key: string;
  label: string;
  values: number[];
  yourValue: number;
  format?: (n: number) => string;
  period?: string;
  /** Optional secondary figure to display under the main value (e.g. £ remuneration alongside a count). */
  companion?: { label: string; value: string };
};

export function MetricSpotlight({
  title,
  metrics,
  defaultKey,
  highlightLabel,
  peerLabel = "Cohort avg",
  caption,
}: {
  title: string;
  metrics: SpotlightMetric[];
  defaultKey?: string;
  highlightLabel?: string;
  peerLabel?: string;
  caption?: string;
}) {
  const available = metrics.filter((m) => m.values.length > 0);
  const [activeKey, setActiveKey] = useState<string>(defaultKey || available[0]?.key || "");
  const active = available.find((m) => m.key === activeKey) || available[0];

  // All hooks must run before any early return.
  const stats = useMemo(() => {
    if (!active) {
      return {
        sorted: [] as number[],
        avg: 0,
        max: 0,
        min: 0,
        percentile: 0,
        avgPercentile: 0,
        rank: 0,
        n: 0,
      };
    }
    const arr = active.values.filter((v) => typeof v === "number" && !isNaN(v));
    if (!arr.length) {
      return { sorted: [], avg: 0, max: 0, min: 0, percentile: 0, avgPercentile: 0, rank: 0, n: 0 };
    }
    const sorted = [...arr].sort((a, b) => a - b);
    const max = sorted[sorted.length - 1];
    const min = sorted[0];
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const below = sorted.filter((v) => v < active.yourValue).length;
    const percentile = Math.round((below / sorted.length) * 100);
    const belowAvg = sorted.filter((v) => v < avg).length;
    const avgPercentile = Math.round((belowAvg / sorted.length) * 100);
    const rank = sorted.length - Math.round((percentile / 100) * sorted.length) + 1;
    return { sorted, avg, max, min, percentile, avgPercentile, rank, n: sorted.length };
  }, [active]);

  // Log-binned histogram so heavily-skewed metrics (PF, NMS) actually spread.
  const histogram = useMemo(() => {
    if (!active || !stats.sorted.length) return { bins: [] as number[], edges: [] as number[], yourBin: -1, useLog: false };
    const arr = stats.sorted;
    const lo = Math.max(arr[0], 0);
    const hi = arr[arr.length - 1];
    const range = hi - lo || 1;
    const positive = arr.filter((v) => v > 0);
    // Use a log scale when the spread between 5th and 95th percentile spans >20x.
    const p05 = positive[Math.floor(positive.length * 0.05)] || lo;
    const p95 = positive[Math.floor(positive.length * 0.95)] || hi;
    const useLog = positive.length > 5 && p05 > 0 && p95 / p05 > 20;
    const BIN_COUNT = 26;
    const bins = new Array(BIN_COUNT).fill(0);
    const edges = new Array(BIN_COUNT + 1).fill(0);
    if (useLog) {
      const logLo = Math.log(Math.max(p05 * 0.6, 1));
      const logHi = Math.log(hi);
      const step = (logHi - logLo) / BIN_COUNT;
      for (let i = 0; i <= BIN_COUNT; i++) edges[i] = Math.exp(logLo + step * i);
      arr.forEach((v) => {
        const x = Math.max(v, edges[0] + 0.001);
        const idx = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor((Math.log(x) - logLo) / step)));
        bins[idx] += 1;
      });
    } else {
      for (let i = 0; i <= BIN_COUNT; i++) edges[i] = lo + (range * i) / BIN_COUNT;
      arr.forEach((v) => {
        const idx = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor(((v - lo) / range) * BIN_COUNT)));
        bins[idx] += 1;
      });
    }
    let yourBin = -1;
    if (active.yourValue > 0 || !useLog) {
      const yv = active.yourValue;
      for (let i = 0; i < BIN_COUNT; i++) {
        if (yv >= edges[i] && yv <= edges[i + 1]) { yourBin = i; break; }
      }
      if (yourBin < 0 && yv >= edges[BIN_COUNT]) yourBin = BIN_COUNT - 1;
      if (yourBin < 0 && yv > 0) yourBin = 0;
    }
    return { bins, edges, yourBin, useLog };
  }, [active, stats.sorted]);

  if (!active) return null;
  const fmtFn = active.format || fmt;

  // Bell-curve SVG points — a stylised normal distribution for the percentile arc.
  const curveW = 100;
  const curveH = 36;
  const curvePts: string[] = [];
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    // Normal density centered at 0.5
    const y = Math.exp(-Math.pow((x - 0.5) / 0.18, 2));
    const px = (x * curveW).toFixed(2);
    const py = (curveH - y * (curveH - 4) - 2).toFixed(2);
    curvePts.push(`${px},${py}`);
  }
  const curvePath = "M" + curvePts.join(" L");
  const areaPath = `${curvePath} L${curveW},${curveH} L0,${curveH} Z`;
  const yPct = Math.max(2, Math.min(98, stats.percentile));
  const avgPct = Math.max(2, Math.min(98, stats.avgPercentile));

  const peakBin = Math.max(...histogram.bins, 1);

  return (
    <div className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight truncate">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Where you sit in the cohort distribution{active.period ? ` · ${active.period}` : ""}
          </p>
        </div>
        {/* Segmented metric control */}
        <div className="inline-flex flex-wrap items-center rounded-lg border border-border bg-secondary/40 p-0.5">
          {available.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setActiveKey(m.key)}
              className={[
                "px-3 py-1 text-[11px] font-semibold rounded-md transition-all",
                active.key === m.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
              aria-pressed={active.key === m.key}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Companion remuneration callout */}
      {active.companion && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900 px-4 py-2.5">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-emerald-800 dark:text-emerald-300">
            {active.companion.label}
          </p>
          <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200 tabular-nums">
            {active.companion.value}
          </p>
        </div>
      )}

      {/* Bell curve / distribution arc with you · avg · top markers */}
      <div className="mb-2">
        <div className="flex items-baseline justify-between mb-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Percentile position</p>
          <p className="text-[11px] font-semibold tabular-nums">
            {ordinal(stats.percentile)} <span className="text-muted-foreground font-normal">· {ordinal(stats.rank)} of {stats.n}</span>
          </p>
        </div>
        <div className="relative">
          <svg viewBox={`0 0 ${curveW} ${curveH + 14}`} preserveAspectRatio="none" className="w-full h-20">
            {/* Area + curve */}
            <path d={areaPath} fill="var(--secondary)" opacity={0.55} />
            <path d={curvePath} fill="none" stroke="var(--muted-foreground)" strokeWidth={0.6} opacity={0.7} />
            {/* Cohort avg marker */}
            <line x1={avgPct} y1={2} x2={avgPct} y2={curveH} stroke="var(--muted-foreground)" strokeWidth={0.5} strokeDasharray="1.2 1.2" />
            {/* Top performer marker */}
            <line x1={98} y1={2} x2={98} y2={curveH} stroke="var(--muted-foreground)" strokeWidth={0.5} strokeDasharray="1.2 1.2" />
            {/* You marker (solid) */}
            <line x1={yPct} y1={0} x2={yPct} y2={curveH} stroke="currentColor" strokeWidth={0.9} className="text-foreground" />
            <circle cx={yPct} cy={2} r={1.6} className="fill-foreground" />
          </svg>
          {/* Inline labels */}
          <div className="relative h-0">
            <span
              className="absolute -top-1 text-[9px] font-semibold uppercase tracking-wider text-foreground"
              style={{ left: `${yPct}%`, transform: "translateX(-50%)" }}
            >
              You
            </span>
            <span
              className="absolute -top-1 text-[9px] uppercase tracking-wider text-muted-foreground"
              style={{ left: `${avgPct}%`, transform: "translateX(-50%)" }}
            >
              Avg
            </span>
            <span
              className="absolute -top-1 text-[9px] uppercase tracking-wider text-muted-foreground"
              style={{ right: 0 }}
            >
              Top
            </span>
          </div>
        </div>
      </div>

      {/* Log-binned histogram */}
      <div className="mt-5">
        <div className="flex items-baseline justify-between mb-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Cohort spread {histogram.useLog ? "(log scale)" : ""}
          </p>
          <p className="text-[10px] text-muted-foreground tabular-nums">{stats.n.toLocaleString()} pharmacies</p>
        </div>
        <div className="flex items-end gap-[2px] h-20">
          {histogram.bins.map((count, i) => {
            const h = (count / peakBin) * 100;
            const isYou = i === histogram.yourBin;
            return (
              <div
                key={i}
                className={[
                  "flex-1 rounded-sm transition-all",
                  isYou ? "bg-foreground" : "bg-secondary hover:bg-secondary/80",
                ].join(" ")}
                style={{ height: `${Math.max(3, h)}%` }}
                title={`${count} pharmacies`}
              />
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
          <span>{fmtFn(histogram.edges[0] || 0)}</span>
          <span>{fmtFn(histogram.edges[histogram.edges.length - 1] || stats.max)}</span>
        </div>
      </div>

      {/* Three stat blocks */}
      <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
        <StatBlock
          label={highlightLabel ? "You" : "You"}
          value={fmtFn(active.yourValue)}
          accent="foreground"
        />
        <StatBlock
          label={peerLabel}
          value={fmtFn(stats.avg)}
          accent="muted"
        />
        <StatBlock
          label="Highest"
          value={fmtFn(stats.max)}
          accent="muted"
        />
      </div>

      {caption && <p className="mt-4 text-xs italic text-muted-foreground border-t border-border pt-3">{caption}</p>}
    </div>
  );
}

function StatBlock({
  label,
  value,
  accent = "muted",
}: {
  label: string;
  value: string;
  accent?: "foreground" | "muted";
}) {
  return (
    <div
      className={[
        "rounded-lg px-3 py-2.5 border",
        accent === "foreground"
          ? "bg-foreground text-background border-foreground"
          : "bg-secondary/40 text-foreground border-border",
      ].join(" ")}
    >
      <p
        className={[
          "text-[9px] uppercase tracking-wider font-semibold",
          accent === "foreground" ? "text-background/70" : "text-muted-foreground",
        ].join(" ")}
      >
        {label}
      </p>
      <p className="text-base font-bold tabular-nums leading-tight mt-0.5 truncate">{value}</p>
    </div>
  );
}


/* ----------------------------------------------------------------
 * ServiceIntensityCard
 * Customisable "per 1,000 items" rates — Pharmacy First, NMS, EPS —
 * comparing your pharmacy against the country mean and the cohort
 * top quartile. Toggle which rate is featured on the headline.
 * ---------------------------------------------------------------- */
export type IntensityRate = {
  key: string;
  label: string;
  yourRate: number;
  peerRate: number;
  topRate: number;
  unit?: string;
};

export function ServiceIntensityCard({
  title = "Service intensity per 1,000 items",
  rates,
  caption,
}: {
  title?: string;
  rates: IntensityRate[];
  caption?: string;
}) {
  const usable = rates.filter((r) => r.topRate > 0);
  const [activeKey, setActiveKey] = useState<string>(usable[0]?.key || "");
  const active = usable.find((r) => r.key === activeKey) || usable[0];

  if (!active) return null;

  const max = Math.max(active.yourRate, active.peerRate, active.topRate, 0.0001);
  const w = (v: number) => `${Math.max(2, Math.round((v / max) * 100))}%`;
  const vsPeer = active.peerRate > 0
    ? Math.round(((active.yourRate - active.peerRate) / active.peerRate) * 100)
    : 0;
  const tone = vsPeer > 0 ? "text-emerald-700" : vsPeer < 0 ? "text-rose-700" : "text-muted-foreground";

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight truncate">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Rate per 1,000 items dispensed — strips out raw volume so a small busy pharmacy can still shine.
          </p>
        </div>
        <div className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-secondary/40 p-0.5">
          {usable.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setActiveKey(r.key)}
              className={[
                "px-2.5 py-0.5 text-[11px] font-semibold rounded-sm transition-colors",
                active.key === r.key
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-3 mb-3">
        <p className="text-2xl font-semibold tabular-nums">
          {active.yourRate.toFixed(1)}<span className="text-xs text-muted-foreground ml-1">{active.unit || "per 1k items"}</span>
        </p>
        {active.peerRate > 0 && (
          <p className={`text-xs font-semibold ${tone}`}>
            {vsPeer >= 0 ? "+" : ""}{vsPeer}% vs peer avg
          </p>
        )}
      </div>

      <div className="space-y-3">
        {[
          { label: "You", value: active.yourRate, accent: "bg-foreground" },
          { label: "Peer avg", value: active.peerRate, accent: "bg-muted-foreground/70" },
          { label: "Top 25%", value: active.topRate, accent: "bg-gold" },
        ].map((row) => (
          <div key={row.label}>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-muted-foreground uppercase tracking-wider">{row.label}</span>
              <span className="tabular-nums font-semibold">{row.value.toFixed(1)}</span>
            </div>
            <div className="h-2 rounded-full bg-secondary overflow-hidden">
              <div className={`h-full ${row.accent} rounded-full transition-all`} style={{ width: w(row.value) }} />
            </div>
          </div>
        ))}
      </div>

      {caption && <p className="mt-3 text-xs italic text-muted-foreground border-t border-border pt-2">{caption}</p>}
    </div>
  );
}

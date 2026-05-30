// Editorial / FT-style infographic primitives.
// Built on top of semantic tokens (no hard-coded colors).

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";

export type PeriodWindow = 1 | 3 | 6 | 12;
export const PERIOD_OPTIONS: PeriodWindow[] = [1, 3, 6, 12];

/* ----------------------------------------------------------------
 * PeriodPills
 * 1M / 3M / 6M / 12M selector pills, used to scope every chart.
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
          {opt}M
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
}) {
  const sliced = points.slice(-window);

  // Trailing zero handling — many NHS metrics (Pharmacy First, NMS, MCR)
  // are published with a lag, so the most recent months arrive as 0 before
  // the real figure lands. Treat trailing zeros as "not reported yet" so
  // the headline, delta and line don't get dragged to zero.
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

  // For the chart: convert trailing zeros to null so the line stops at the
  // last reported month instead of crashing to the x-axis. Same for the
  // comparison series independently.
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
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight truncate">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        <PeriodPills value={window} onChange={onWindowChange} options={options} />
      </div>

      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-2xl font-semibold tabular-nums">{formatValue(latest)}</p>
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
            <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={48} />
            <Tooltip
              contentStyle={{
                background: "var(--card)", border: "1px solid var(--border)",
                borderRadius: 6, fontSize: 12,
              }}
              formatter={(v: number) => formatValue(v)}
            />
            {comparisonLabel && <Legend wrapperStyle={{ fontSize: 11 }} />}
            <Line
              type="monotone" dataKey="value" name={primaryLabel}
              stroke="var(--cmp-1, var(--chart-1))" strokeWidth={2} dot={false}
              isAnimationActive={false} connectNulls={false}
            />
            {comparisonLabel && (
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
  const [topGps, setTopGps] = useState<{ code: string; name: string | null; items: number }[]>([]);
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
        .limit(5000);
      if (cancelled) return;
      if (error || !data) {
        setRows([]); setTopGps([]); setLoading(false); return;
      }
      const byMonth = new Map<string, { year: number; month: number; items: number; gps: Set<string> }>();
      const byGp = new Map<string, number>();
      for (const r of data) {
        const k = `${r.year}-${r.month}`;
        const cur = byMonth.get(k) || { year: r.year, month: r.month, items: 0, gps: new Set<string>() };
        cur.items += Number(r.items_dispensed) || 0;
        cur.gps.add(r.practice_code);
        byMonth.set(k, cur);
        byGp.set(r.practice_code, (byGp.get(r.practice_code) || 0) + (Number(r.items_dispensed) || 0));
      }
      const sorted = [...byMonth.values()]
        .sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month))
        .map((v) => ({ year: v.year, month: v.month, items: v.items, gp_count: v.gps.size }));
      const topCodes = [...byGp.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      // Resolve human-readable GP practice names. Only surface the list if
      // we can name at least one practice — anonymous codes aren't useful.
      let nameMap = new Map<string, string>();
      if (topCodes.length) {
        const { data: names } = await supabase
          .from("gp_practices")
          .select("practice_code,practice_name")
          .in("practice_code", topCodes.map(([c]) => c));
        (names || []).forEach((n: { practice_code: string; practice_name: string | null }) => {
          if (n.practice_name) nameMap.set(n.practice_code, n.practice_name);
        });
      }
      const named = topCodes
        .filter(([code]) => nameMap.has(code))
        .map(([code, items]) => ({ code, name: nameMap.get(code) || null, items }));

      setRows(sorted);
      setTopGps(named);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [pharmacyOds]);

  const points = useMemo(
    () => rows.slice(-12).map((r) => ({
      label: `${MONTHS[r.month - 1]} ${String(r.year).slice(2)}`,
      value: r.items,
    })),
    [rows],
  );

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
      <TrendCard
        title={title}
        subtitle={loading ? "Loading…" : `${avgGps} GP practices · ${totalItems.toLocaleString()} items over ${win}M`}
        caption="From official England, Scotland and NI linkage data — items dispensed against scripts issued by each GP practice."
        points={points}
        window={win}
        onWindowChange={setWin}
        formatValue={(n) => n.toLocaleString()}
      />
      {topGps.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Top GP feeders (all-time)</p>
          <ul className="space-y-1.5 text-xs">
            {topGps.map((g) => (
              <li key={g.code} className="flex items-center justify-between gap-3 border-b border-border last:border-b-0 pb-1.5 last:pb-0">
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{g.name}</span>
                  <span className="text-muted-foreground font-mono ml-2">{g.code}</span>
                </span>
                <span className="tabular-nums shrink-0">{g.items.toLocaleString()} items</span>
              </li>
            ))}
          </ul>
        </div>
      )}
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
    const range = hi - lo || 1;
    const buckets = new Array(bins).fill(0);
    arr.forEach((v) => {
      const idx = Math.min(bins - 1, Math.floor(((v - lo) / range) * bins));
      buckets[idx] += 1;
    });
    const peak = buckets.indexOf(Math.max(...buckets));
    const hIdx =
      typeof highlightValue === "number"
        ? Math.min(bins - 1, Math.max(0, Math.floor(((highlightValue - lo) / range) * bins)))
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

  if (points.length < 2) {
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
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const xs = points.map((_, i) => pad + (i / (points.length - 1)) * (w - pad * 2));
  const ys = points.map((p) => h - pad - ((p.value - min) / range) * (h - pad * 2));

  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x},${ys[i]}`).join(" ");
  const area = `${path} L${xs[xs.length - 1]},${h - pad} L${xs[0]},${h - pad} Z`;

  const peakIdx = vals.indexOf(max);
  const troughIdx = vals.indexOf(min);
  // Use first/last non-zero values so leading/trailing months with no
  // reported data (common for Pharmacy First, NMS, etc.) don't produce
  // a misleading -100% change.
  const firstNonZeroIdx = vals.findIndex((v) => v > 0);
  let lastNonZeroIdx = -1;
  for (let i = vals.length - 1; i >= 0; i--) {
    if (vals[i] > 0) { lastNonZeroIdx = i; break; }
  }
  const hasChange = firstNonZeroIdx >= 0 && lastNonZeroIdx > firstNonZeroIdx;
  const first = hasChange ? vals[firstNonZeroIdx] : 0;
  const last = hasChange ? vals[lastNonZeroIdx] : 0;
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
          Peak: <span className="font-semibold text-foreground">{fmt(max)}{unit}</span> · {points[peakIdx].period}
        </span>
        <span>
          Low: <span className="font-semibold text-foreground">{fmt(min)}{unit}</span> · {points[troughIdx].period}
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
};

export function MetricSpotlight({
  title,
  metrics,
  defaultKey,
  highlightLabel,
  peerLabel = "Peer avg",
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

  if (!active) return null;
  const fmtFn = active.format || fmt;

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight truncate">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pick a metric to see where you sit across the cohort{active.period ? ` · ${active.period}` : ""}.
          </p>
        </div>
        <div className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-secondary/40 p-0.5">
          {available.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setActiveKey(m.key)}
              className={[
                "px-2.5 py-0.5 text-[11px] font-semibold rounded-sm transition-colors",
                active.key === m.key
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <PercentileRail
          label={`${active.label}${active.period ? ` · ${active.period}` : ""}`}
          value={active.yourValue}
          values={active.values}
          peerLabel={peerLabel}
          nationalLabel="Highest"
          formatValue={fmtFn}
        />
        <DistributionStrip
          label={`${active.label} spread`}
          values={active.values}
          highlightValue={active.yourValue}
          highlightLabel={highlightLabel || "You"}
        />
      </div>

      {caption && <p className="mt-3 text-xs italic text-muted-foreground border-t border-border pt-2">{caption}</p>}
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

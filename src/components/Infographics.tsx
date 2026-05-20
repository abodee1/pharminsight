// Editorial / FT-style infographic primitives.
// Built on top of semantic tokens (no hard-coded colors).

import { useMemo } from "react";

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
  const last = points[points.length - 1].value;
  const first = points[0].value;
  const yoy = first ? Math.round(((last - first) / first) * 100) : 0;
  const tone = yoy > 0 ? "text-emerald-700" : yoy < 0 ? "text-rose-700" : "text-muted-foreground";

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-semibold tracking-tight">{label}</h3>
        <p className={`text-xs font-semibold ${tone}`}>
          {yoy >= 0 ? "+" : ""}
          {yoy}% over the period
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

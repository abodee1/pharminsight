import { useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { PeriodPills, type PeriodWindow, ALL_PERIOD } from "@/components/Infographics";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export type TrendRow = {
  year: number;
  month: number;
  items_dispensed: number;
  pharmacy_first_count: number;
  nms_count: number;
  eps_items: number;
  gross_cost: number | string | null;
  final_payment: number | string | null;
};

type MetricKey = "items" | "pf" | "nms" | "eps" | "gross" | "final";
type MetricDef = {
  key: MetricKey;
  label: string;
  short: string;
  field: (r: TrendRow) => number;
  format: (n: number) => string;
  color: string;
};

const MET: Record<MetricKey, MetricDef> = {
  items: { key: "items", label: "Items dispensed", short: "Items", field: (r) => r.items_dispensed || 0, format: (n) => Math.round(n).toLocaleString(), color: "var(--chart-1)" },
  pf:    { key: "pf",    label: "Pharmacy First",  short: "PF",    field: (r) => r.pharmacy_first_count || 0, format: (n) => Math.round(n).toLocaleString(), color: "var(--chart-2)" },
  nms:   { key: "nms",   label: "NMS",             short: "NMS",   field: (r) => r.nms_count || 0, format: (n) => Math.round(n).toLocaleString(), color: "var(--chart-3, var(--chart-2))" },
  eps:   { key: "eps",   label: "EPS items",       short: "EPS",   field: (r) => r.eps_items || 0, format: (n) => Math.round(n).toLocaleString(), color: "var(--chart-4, var(--chart-1))" },
  gross: { key: "gross", label: "Gross cost (£)",  short: "Gross £", field: (r) => Number(r.gross_cost) || 0, format: (n) => "£" + Math.round(n).toLocaleString(), color: "var(--chart-2)" },
  final: { key: "final", label: "Final NHS payment (£)", short: "Final £", field: (r) => Number(r.final_payment) || 0, format: (n) => "£" + Math.round(n).toLocaleString(), color: "var(--chart-1)" },
};

const DEFAULT_WINDOWS: PeriodWindow[] = [6, 12, 18, 24, ALL_PERIOD];

export function InteractiveTrend({
  rows,
  available,
  title = "Performance over time",
  windows = DEFAULT_WINDOWS,
  initialWindow = 12,
}: {
  rows: TrendRow[];
  available: MetricKey[];
  title?: string;
  windows?: PeriodWindow[];
  initialWindow?: PeriodWindow;
}) {
  const initial = available[0] ?? "items";
  const [metric, setMetric] = useState<MetricKey>(initial);
  const [win, setWin] = useState<PeriodWindow>(initialWindow);

  const def = MET[metric];

  const { points, latest, prior, avg } = useMemo(() => {
    // Trim trailing zero rows for this metric so lag months don't drag the chart.
    let lastIdx = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (def.field(rows[i]) > 0) { lastIdx = i; break; }
    }
    const trimmed = lastIdx >= 0 ? rows.slice(0, lastIdx + 1) : rows;
    const slice = trimmed.slice(-Number(win));
    const points = slice.map((r) => ({
      label: `${MONTHS[r.month - 1]} ${String(r.year).slice(2)}`,
      value: def.field(r),
    }));
    const latest = points.length ? points[points.length - 1].value : 0;
    const prior = points.length > 1 ? points[0].value : 0;
    const total = points.reduce((a, p) => a + p.value, 0);
    const avg = points.length ? total / points.length : 0;
    return { points, latest, prior, avg };
  }, [rows, def, win]);

  const delta = prior > 0 ? ((latest - prior) / prior) * 100 : 0;
  const Trend = delta > 1 ? TrendingUp : delta < -1 ? TrendingDown : Minus;
  const tone = delta > 1 ? "text-emerald-600" : delta < -1 ? "text-rose-600" : "text-muted-foreground";

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pick a metric and window. Dashed line marks the {Number(win)}-month average.
          </p>
        </div>
        <PeriodPills value={win} onChange={setWin} options={windows} />
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {available.map((k) => {
          const m = MET[k];
          const active = k === metric;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setMetric(k)}
              className={[
                "px-2.5 py-1 text-[11px] font-semibold rounded-md border transition-colors",
                active
                  ? "bg-foreground text-background border-foreground"
                  : "bg-secondary/40 text-muted-foreground border-border hover:text-foreground",
              ].join(" ")}
            >
              {m.short}
            </button>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div>
          <p className="text-2xl font-semibold tabular-nums leading-none">{def.format(latest)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Latest reported · {points.length ? points[points.length - 1].label : "—"}
          </p>
        </div>
        {prior > 0 && (
          <span className={`inline-flex items-center gap-1 text-xs font-semibold ${tone}`}>
            <Trend className="h-3 w-3" />
            {delta >= 0 ? "+" : ""}{delta.toFixed(1)}% over window
          </span>
        )}
      </div>

      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: -10 }}>
            <defs>
              <linearGradient id={`gt-${metric}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={def.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={def.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={52} tickFormatter={(v) => {
              if (v >= 1e6) return (v/1e6).toFixed(1) + "m";
              if (v >= 1e3) return (v/1e3).toFixed(0) + "k";
              return String(v);
            }} />
            <Tooltip
              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
              formatter={(v: number) => def.format(v)}
            />
            {avg > 0 && (
              <ReferenceLine y={avg} stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeOpacity={0.5} />
            )}
            <Area
              type="monotone" dataKey="value"
              stroke={def.color} strokeWidth={2} fill={`url(#gt-${metric})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <Stat label="Avg / month" value={def.format(avg)} />
        <Stat label={`${Number(win)}M total`} value={def.format(points.reduce((a, p) => a + p.value, 0))} />
        <Stat label="Window start" value={points[0]?.label ?? "—"} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/30 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums truncate">{value}</p>
    </div>
  );
}

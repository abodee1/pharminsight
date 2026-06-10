import { useMemo, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { PeriodPills, type PeriodWindow, ALL_PERIOD } from "@/components/Infographics";
import { fmtGbpCompact } from "@/lib/utils";

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
  pharmacy_first_payment?: number | string | null;
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
  gross: { key: "gross", label: "Gross cost (£)",  short: "Gross £", field: (r) => Number(r.gross_cost) || 0, format: (n) => "£" + Math.round(n).toLocaleString(), color: "var(--chart-5, var(--chart-2))" },
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
  const [activeMetrics, setActiveMetrics] = useState<MetricKey[]>([initial]);
  const [win, setWin] = useState<PeriodWindow>(initialWindow);
  const [pfUnit, setPfUnit] = useState<"count" | "money">("count");


  const toggleMetric = (k: MetricKey) => {
    setActiveMetrics((cur) => {
      if (cur.includes(k)) {
        // Don't allow zero metrics — keep at least one selected
        return cur.length > 1 ? cur.filter((x) => x !== k) : cur;
      }
      return [...cur, k];
    });
  };

  // Locally swap the PF metric definition when the user toggles to £ remuneration view.
  const M = useMemo<Record<MetricKey, MetricDef>>(() => {
    if (pfUnit === "money") {
      return {
        ...MET,
        pf: {
          key: "pf",
          label: "Pharmacy First (£)",
          short: "PF £",
          field: (r) => Number(r.pharmacy_first_payment) || 0,
          format: (n) => "£" + Math.round(n).toLocaleString(),
          color: MET.pf.color,
        },
      };
    }
    return MET;
  }, [pfUnit]);

  // Build chart data: one row per month with all selected metric values
  const { points, perMetric } = useMemo(() => {
    let lastIdx = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      const anyVal = activeMetrics.some((k) => M[k].field(rows[i]) > 0);
      if (anyVal) { lastIdx = i; break; }
    }
    const trimmed = lastIdx >= 0 ? rows.slice(0, lastIdx + 1) : rows;
    const sliced = trimmed.slice(-Number(win));

    const lastReportedByMetric: Record<string, number> = {};
    activeMetrics.forEach((k) => {
      let li = -1;
      for (let i = sliced.length - 1; i >= 0; i--) {
        if (M[k].field(sliced[i]) > 0) { li = i; break; }
      }
      lastReportedByMetric[k] = li;
    });

    const pts = sliced.map((r, i) => {
      const point: Record<string, any> = {
        label: `${MONTHS[r.month - 1]} ${String(r.year).slice(2)}`,
      };
      activeMetrics.forEach((k) => {
        const li = lastReportedByMetric[k];
        point[k] = i <= li ? M[k].field(r) : null;
      });
      return point;
    });

    const perMetric: Record<string, { latest: number; avg: number; total: number; firstLabel: string; latestLabel: string; delta: number }> = {};
    activeMetrics.forEach((k) => {
      const vals = pts.map((p) => p[k]).filter((v) => typeof v === "number" && v > 0) as number[];
      const total = vals.reduce((a, v) => a + v, 0);
      const avg = vals.length ? total / vals.length : 0;
      const latest = vals.length ? vals[vals.length - 1] : 0;
      const first = vals.length ? vals[0] : 0;
      const delta = first > 0 && vals.length > 1 ? ((latest - first) / first) * 100 : 0;
      const li = lastReportedByMetric[k];
      const fi = pts.findIndex((p) => typeof p[k] === "number" && p[k] > 0);
      perMetric[k] = {
        latest, avg, total,
        firstLabel: fi >= 0 ? pts[fi].label : "—",
        latestLabel: li >= 0 ? pts[li].label : "—",
        delta,
      };
    });

    return { points: pts, perMetric };
  }, [rows, activeMetrics, win, M]);


  // PF £ companion — total + latest remuneration paired with the PF count tile.
  const pfPaymentInfo = useMemo(() => {
    if (!activeMetrics.includes("pf")) return null;
    let lastIdx = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if ((rows[i].pharmacy_first_count || 0) > 0) { lastIdx = i; break; }
    }
    const trimmed = lastIdx >= 0 ? rows.slice(0, lastIdx + 1) : rows;
    const sliced = trimmed.slice(-Number(win));
    let total = 0; let latest = 0;
    for (let i = 0; i < sliced.length; i++) {
      const v = Number(sliced[i].pharmacy_first_payment) || 0;
      total += v;
      if (v > 0) latest = v;
    }
    return { total, latest };
  }, [rows, activeMetrics, win]);

  // Need normalisation when mixing very different scales (e.g. Items + Final £)
  // Use a dual y-axis if mixing £ metrics with count metrics
  const hasMoney = activeMetrics.some((k) => k === "gross" || k === "final");
  const hasCount = activeMetrics.some((k) => k !== "gross" && k !== "final");
  const dualAxis = hasMoney && hasCount;

  // Single-metric: keep the focused average reference line
  const singleMetric = activeMetrics.length === 1 ? activeMetrics[0] : null;
  const singleAvg = singleMetric ? perMetric[singleMetric]?.avg ?? 0 : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Toggle one or more metrics. {singleMetric ? `Dashed line marks the ${win >= ALL_PERIOD ? `all-time (${points.length}-month)` : `${Number(win)}-month`} average.` : "Compare multiple trends at once."}
          </p>
        </div>
        <PeriodPills value={win} onChange={setWin} options={windows} />
      </div>

      {/* Metric toggle pills */}
      <div className="flex flex-wrap gap-1 mb-3">
        {available.map((k) => {
          const m = MET[k];
          const active = activeMetrics.includes(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggleMetric(k)}
              className={[
                "px-2.5 py-1 text-[11px] font-semibold rounded-md border transition-colors inline-flex items-center gap-1.5",
                active
                  ? "bg-foreground text-background border-foreground"
                  : "bg-secondary/40 text-muted-foreground border-border hover:text-foreground",
              ].join(" ")}
              aria-pressed={active}
            >
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: active ? m.color : "var(--muted-foreground)", opacity: active ? 1 : 0.4 }} />
              {m.short}
            </button>
          );
        })}
      </div>

      {/* Headline strip — per active metric */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-3">
        {activeMetrics.map((k) => {
          const m = MET[k];
          const pm = perMetric[k];
          if (!pm) return null;
          const Trend = pm.delta > 1 ? TrendingUp : pm.delta < -1 ? TrendingDown : Minus;
          const tone = pm.delta > 1 ? "text-emerald-600" : pm.delta < -1 ? "text-rose-600" : "text-muted-foreground";
          return (
            <div key={k} className="rounded-md border border-border bg-secondary/30 px-2 py-1.5" style={{ borderLeft: `3px solid ${m.color}` }}>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">{m.short} · latest</p>
              <p className="text-sm font-bold tabular-nums leading-tight">{m.format(pm.latest)}</p>
              {k === "pf" && pfPaymentInfo && (
                <p className="text-[10px] font-semibold tabular-nums text-emerald-700 leading-tight">
                  {fmtGbpCompact(pfPaymentInfo.latest)} paid
                </p>
              )}
              <p className={`text-[10px] font-semibold inline-flex items-center gap-0.5 ${tone}`}>
                <Trend className="h-3 w-3" />
                {pm.delta >= 0 ? "+" : ""}{pm.delta.toFixed(1)}%
              </p>
            </div>
          );
        })}
      </div>

      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 6, right: dualAxis ? 8 : 8, bottom: 0, left: -10 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" interval="preserveStartEnd" />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 10 }}
              stroke="var(--muted-foreground)"
              width={52}
              tickFormatter={(v) => {
                if (v >= 1e6) return (v/1e6).toFixed(1) + "m";
                if (v >= 1e3) return (v/1e3).toFixed(0) + "k";
                return String(v);
              }}
            />
            {dualAxis && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 10 }}
                stroke="var(--muted-foreground)"
                width={56}
                tickFormatter={(v) => {
                  if (v >= 1e6) return "£" + (v/1e6).toFixed(1) + "m";
                  if (v >= 1e3) return "£" + (v/1e3).toFixed(0) + "k";
                  return "£" + v;
                }}
              />
            )}
            <Tooltip
              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
              formatter={(v: number, name: string) => {
                const m = MET[name as MetricKey];
                return [m ? m.format(v) : v, m?.label ?? name];
              }}
            />
            {activeMetrics.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {singleMetric && singleAvg > 0 && (
              <ReferenceLine yAxisId="left" y={singleAvg} stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeOpacity={0.5} />
            )}
            {activeMetrics.map((k) => {
              const m = MET[k];
              const isMoney = k === "gross" || k === "final";
              return (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  name={m.label}
                  stroke={m.color}
                  strokeWidth={2}
                  dot={false}
                  yAxisId={dualAxis && isMoney ? "right" : "left"}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {singleMetric && perMetric[singleMetric] && (
        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
          <Stat label="Avg / month" value={MET[singleMetric].format(perMetric[singleMetric].avg)} />
          <Stat label={win >= ALL_PERIOD ? "All-time total" : `${Number(win)}M total`} value={MET[singleMetric].format(perMetric[singleMetric].total)} />
          <Stat label="Window start" value={perMetric[singleMetric].firstLabel} />
        </div>
      )}
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

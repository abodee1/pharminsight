import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ReferenceLine,
} from "recharts";
import { MapPin, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PeriodPills, type PeriodWindow } from "@/components/Infographics";

type Props = {
  pharmacyId: string;
  pharmacyName: string;
  postcode: string | null;
  lat?: number | null;
  lng?: number | null;
};

type Nearby = {
  id: string;
  ods_code: string;
  name: string;
  distance_m: number;
};

type MetricKey = "items" | "pf" | "nms" | "eps";
const METRIC_LABEL: Record<MetricKey, string> = {
  items: "Items dispensed",
  pf: "Pharmacy First",
  nms: "NMS",
  eps: "EPS items",
};
const METRIC_FIELD: Record<MetricKey, string> = {
  items: "items_dispensed",
  pf: "pharmacy_first_count",
  nms: "nms_count",
  eps: "eps_items",
};

const RADII_M = [1600, 3200, 8000, 16000]; // ~1, 2, 5, 10 miles
const RADIUS_LABEL: Record<number, string> = {
  1600: "1 mi",
  3200: "2 mi",
  8000: "5 mi",
  16000: "10 mi",
};

async function geocode(postcode: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`);
    if (!res.ok) return null;
    const j = await res.json();
    if (j?.result?.latitude && j?.result?.longitude) return { lat: j.result.latitude, lng: j.result.longitude };
  } catch { /* ignore */ }
  return null;
}

export function LocalRadiusInsights({ pharmacyId, pharmacyName, postcode, lat, lng }: Props) {
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(
    lat && lng ? { lat, lng } : null,
  );
  const [radius, setRadius] = useState<number>(3200);
  const [metric, setMetric] = useState<MetricKey>("items");
  const [win, setWin] = useState<PeriodWindow>(3);
  const [nearby, setNearby] = useState<Nearby[]>([]);
  const [perPharm, setPerPharm] = useState<Map<string, number>>(new Map());
  const [period, setPeriod] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Geocode fallback
  useEffect(() => {
    if (origin || !postcode) return;
    let alive = true;
    (async () => {
      const g = await geocode(postcode);
      if (alive && g) setOrigin(g);
    })();
    return () => { alive = false; };
  }, [origin, postcode]);

  // Fetch nearby pharmacies whenever radius / origin changes
  useEffect(() => {
    if (!origin) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase.rpc("pharmacies_near", {
        p_lat: origin.lat, p_lng: origin.lng, p_radius_m: radius, p_limit: 50,
      });
      if (!alive) return;
      const arr = (data as Nearby[] | null) || [];
      setNearby(arr);
    })().finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [origin, radius]);

  // Fetch dispensing aggregates for nearby + this pharmacy across selected window
  useEffect(() => {
    const ids = Array.from(new Set([pharmacyId, ...nearby.map((n) => n.id)]));
    if (!ids.length) return;
    let alive = true;
    (async () => {
      setLoading(true);
      // 1) find latest period available across this cohort for the chosen metric
      const field = METRIC_FIELD[metric];
      const latestRes = await supabase
        .from("dispensing_data")
        .select(`year,month,${field}`)
        .in("pharmacy_id", ids)
        .gt(field, 0)
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .limit(1);
      if (!alive) return;
      const latestRow = (latestRes.data as unknown as Array<{ year: number; month: number }> | null);
      const ly = latestRow?.[0]?.year;
      const lm = latestRow?.[0]?.month;
      if (!ly || !lm) {
        setPerPharm(new Map()); setPeriod(""); setLoading(false); return;
      }
      // 2) Build month window keys (ly,lm) going back N months
      const N = Number(win);
      const months: Array<{ y: number; m: number }> = [];
      let y = ly, m = lm;
      for (let i = 0; i < N; i++) {
        months.push({ y, m });
        m -= 1; if (m === 0) { m = 12; y -= 1; }
      }
      const minYM = months[months.length - 1].y * 12 + months[months.length - 1].m;
      const maxYM = ly * 12 + lm;
      // 3) Fetch dispensing rows for cohort in window, chunked
      const sums = new Map<string, number>();
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const { data } = await supabase
          .from("dispensing_data")
          .select(`pharmacy_id,year,month,${field}`)
          .in("pharmacy_id", chunk)
          .gte("year", months[months.length - 1].y)
          .lte("year", ly);
        if (!alive) return;
        for (const r of (data as Array<Record<string, number | string>> | null) || []) {
          const yy = r.year as number;
          const mm = r.month as number;
          const ym = yy * 12 + mm;
          if (ym < minYM || ym > maxYM) continue;
          const v = Number(r[field]) || 0;
          const pid = r.pharmacy_id as string;
          sums.set(pid, (sums.get(pid) || 0) + v);
        }
      }
      const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const from = months[months.length - 1];
      const periodLabel = N === 1
        ? `${MONTHS[lm - 1]} ${ly}`
        : `${MONTHS[from.m - 1]} ${String(from.y).slice(2)} – ${MONTHS[lm - 1]} ${String(ly).slice(2)}`;
      setPerPharm(sums);
      setPeriod(periodLabel);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [nearby, pharmacyId, metric, win]);

  const rows = useMemo(() => {
    const list = [
      { id: pharmacyId, name: pharmacyName, isYou: true, distance_m: 0 },
      ...nearby.filter((n) => n.id !== pharmacyId).map((n) => ({ id: n.id, name: n.name, isYou: false, distance_m: n.distance_m })),
    ];
    const annotated = list.map((p) => ({
      ...p,
      value: perPharm.get(p.id) || 0,
    }));
    return annotated.sort((a, b) => b.value - a.value);
  }, [nearby, perPharm, pharmacyId, pharmacyName]);

  const yourValue = perPharm.get(pharmacyId) || 0;
  const others = rows.filter((r) => !r.isYou && r.value > 0);
  const cohortAvg = others.length ? Math.round(others.reduce((a, r) => a + r.value, 0) / others.length) : 0;
  const cohortMedian = useMemo(() => {
    if (!others.length) return 0;
    const sorted = [...others].map((r) => r.value).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
  }, [others]);
  const yourRank = rows.findIndex((r) => r.isYou) + 1;
  const reporting = rows.filter((r) => r.value > 0).length;

  const fmt = (n: number) => n.toLocaleString();

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
            Local cohort — within {RADIUS_LABEL[radius]}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {METRIC_LABEL[metric]} over {Number(win)}M{period ? ` · ${period}` : ""}
            {nearby.length ? ` · ${nearby.length} pharmacies` : ""}
          </p>
        </div>
        <PeriodPills value={win} onChange={setWin} options={[1, 3, 6, 12] as PeriodWindow[]} />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/40 p-0.5">
          {RADII_M.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRadius(r)}
              className={[
                "px-2 py-0.5 text-[11px] font-semibold rounded-sm transition-colors",
                radius === r ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {RADIUS_LABEL[r]}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/40 p-0.5">
          {(Object.keys(METRIC_LABEL) as MetricKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setMetric(k)}
              className={[
                "px-2 py-0.5 text-[11px] font-semibold rounded-sm transition-colors",
                metric === k ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {k === "items" ? "Items" : k === "pf" ? "PF" : k === "nms" ? "NMS" : "EPS"}
            </button>
          ))}
        </div>
        {loading && <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />}
      </div>

      {!origin && (
        <p className="text-sm text-muted-foreground">No coordinates available for this pharmacy yet.</p>
      )}

      {origin && reporting === 0 && !loading && (
        <p className="text-sm text-muted-foreground">No {METRIC_LABEL[metric]} reported in this radius yet.</p>
      )}

      {origin && reporting > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 text-xs">
            <Tile label="You" value={fmt(yourValue)} accent />
            <Tile label="Cohort median" value={fmt(cohortMedian)} />
            <Tile label="Cohort average" value={fmt(cohortAvg)} />
            <Tile label="Your rank" value={`#${yourRank} of ${reporting}`} />
          </div>

          <div style={{ height: Math.min(420, 40 + rows.length * 18) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows.slice(0, 20)} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={170}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  stroke="transparent"
                  tickFormatter={(v: string) => v.length > 26 ? v.slice(0, 25) + "…" : v}
                />
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                  formatter={(v: number) => fmt(Number(v))}
                />
                {cohortMedian > 0 && (
                  <ReferenceLine x={cohortMedian} stroke="var(--muted-foreground)" strokeDasharray="3 3" strokeOpacity={0.6} />
                )}
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {rows.slice(0, 20).map((r, i) => (
                    <Cell key={i} fill={r.isYou ? "var(--chart-1)" : "var(--chart-2)"} fillOpacity={r.isYou ? 1 : 0.55} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <p className="mt-3 text-[11px] text-muted-foreground italic border-t border-border pt-2">
            Dashed line = cohort median. Highlighted bar = this pharmacy. Top 20 by {METRIC_LABEL[metric]} over the {Number(win)}-month window.
          </p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={[
      "rounded-md border px-2.5 py-2",
      accent ? "border-foreground/30 bg-foreground/5" : "border-border bg-secondary/30",
    ].join(" ")}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}

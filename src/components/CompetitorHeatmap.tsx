import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis,
  CartesianGrid, Tooltip, Cell,
} from "recharts";
import { Loader2, MapPin, Flame, AlertTriangle } from "lucide-react";

type Pharm = { id: string; name: string; country: string | null; lat?: number | null; lng?: number | null };
type Comp = { id: string; name: string; postcode: string | null; lat: number; lng: number };

const EARTH_KM = 6371;
const RADIUS_KM = 5;
const RING_KM = [1, 2, 3, 5];

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Project competitor positions to km offsets (E/W, N/S) from focal pharmacy
function project(lat0: number, lng0: number, lat: number, lng: number) {
  const dN = haversine(lat0, lng0, lat, lng0) * (lat >= lat0 ? 1 : -1);
  const dE = haversine(lat0, lng0, lat0, lng) * (lng >= lng0 ? 1 : -1);
  return { x: dE, y: dN };
}

export function CompetitorHeatmap({
  pharms,
  colorFor,
}: {
  pharms: Pharm[];
  colorFor: (id: string) => string;
}) {
  const focal = pharms.filter((p) => p.lat != null && p.lng != null) as Pharm[];
  const [focusId, setFocusId] = useState<string>(focal[0]?.id ?? "");
  const [allComps, setAllComps] = useState<Comp[]>([]);
  const [loading, setLoading] = useState(true);

  // When focal list changes, reset focus to the first valid one
  useEffect(() => {
    if (!focal.find((p) => p.id === focusId) && focal[0]) setFocusId(focal[0].id);
  }, [focal, focusId]);

  // Fetch a single bounding-box of competitors covering all focal pharmacies
  useEffect(() => {
    if (focal.length === 0) { setAllComps([]); setLoading(false); return; }
    setLoading(true);
    (async () => {
      const lats = focal.map((p) => p.lat as number);
      const lngs = focal.map((p) => p.lng as number);
      // ~RADIUS_KM padding (1 deg lat ≈ 111km)
      const pad = RADIUS_KM / 100;
      const latMin = Math.min(...lats) - pad;
      const latMax = Math.max(...lats) + pad;
      const lngMin = Math.min(...lngs) - pad * 1.6;
      const lngMax = Math.max(...lngs) + pad * 1.6;
      const { data } = await supabase
        .from("pharmacies")
        .select("id,name,postcode,lat,lng")
        .gte("lat", latMin).lte("lat", latMax)
        .gte("lng", lngMin).lte("lng", lngMax)
        .not("lat", "is", null)
        .not("lng", "is", null)
        .limit(2000);
      setAllComps((data || []) as Comp[]);
      setLoading(false);
    })();
  }, [focal.map((f) => f.id).join(",")]);

  const focusPharm = focal.find((p) => p.id === focusId);

  // Competitors near the focus pharmacy
  const local = useMemo(() => {
    if (!focusPharm?.lat || !focusPharm.lng) return [];
    return allComps
      .filter((c) => c.id !== focusPharm.id)
      .map((c) => {
        const d = haversine(focusPharm.lat as number, focusPharm.lng as number, c.lat, c.lng);
        const { x, y } = project(focusPharm.lat as number, focusPharm.lng as number, c.lat, c.lng);
        const otherFocal = focal.find((p) => p.id === c.id);
        return { ...c, distance: d, x, y, isSelected: !!otherFocal };
      })
      .filter((c) => c.distance <= RADIUS_KM)
      .sort((a, b) => a.distance - b.distance);
  }, [allComps, focusPharm, focal]);

  // Stats per ring
  const ringStats = useMemo(() => {
    return RING_KM.map((r, i) => {
      const inner = i === 0 ? 0 : RING_KM[i - 1];
      const count = local.filter((c) => c.distance > inner && c.distance <= r).length;
      // Area in km² (annulus)
      const area = Math.PI * (r * r - inner * inner);
      const density = area > 0 ? count / area : 0;
      return { ring: r, label: i === 0 ? `≤${r} km` : `${inner}–${r} km`, count, density };
    });
  }, [local]);

  const totalCompetitors = local.length;
  const nearestKm = local[0]?.distance ?? null;
  // Density score: weight nearer rings heavier
  const pressureScore = useMemo(() => {
    const weights = [4, 2, 1, 0.5];
    return ringStats.reduce((s, r, i) => s + r.count * (weights[i] ?? 0.25), 0);
  }, [ringStats]);
  const pressureLabel =
    pressureScore >= 30 ? "Very high" :
    pressureScore >= 15 ? "High" :
    pressureScore >= 6 ? "Moderate" :
    pressureScore > 0 ? "Low" : "Isolated";
  const pressureTone =
    pressureScore >= 30 ? "text-rose-700 border-rose-200 bg-rose-50" :
    pressureScore >= 15 ? "text-amber-800 border-amber-200 bg-amber-50" :
    pressureScore >= 6 ? "text-amber-700 border-amber-100 bg-amber-50/60" :
    "text-emerald-700 border-emerald-200 bg-emerald-50";

  if (focal.length === 0) return null;

  // Scatter colour ramp by distance band
  const colourFor = (c: typeof local[number]) => {
    if (c.isSelected) return colorFor(c.id);
    if (c.distance <= 1) return "#dc2626";
    if (c.distance <= 2) return "#f97316";
    if (c.distance <= 3) return "#f59e0b";
    return "#0ea5e9";
  };

  return (
    <div className="rounded-xl bg-card border border-border p-4 sm:p-5 md:p-6 shadow-sm mb-6">
      <div className="flex items-start gap-3 mb-4 flex-wrap">
        <div className="rounded-lg bg-secondary p-2 shrink-0"><Flame className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Competitor geography heatmap</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Every NHS pharmacy within {RADIUS_KM} km of the focus pharmacy, plotted as distance bands. Closer = redder.</p>
        </div>
        {focal.length > 1 && (
          <div className="inline-flex rounded-md border border-border bg-secondary/40 p-0.5 flex-wrap">
            {focal.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setFocusId(p.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors max-w-[140px] truncate ${
                  focusId === p.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading competitor positions…
        </p>
      ) : !focusPharm?.lat ? (
        <p className="text-sm text-muted-foreground italic">No geolocation available for the selected pharmacy.</p>
      ) : (
        <>
          {/* Headline stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Stat label="Competitors ≤5km" value={String(totalCompetitors)}
              tone={totalCompetitors >= 15 ? "bad" : totalCompetitors >= 6 ? "warn" : "good"}
              sub="Other NHS pharmacies in catchment" />
            <Stat label="Nearest competitor" value={nearestKm != null ? `${nearestKm.toFixed(2)} km` : "—"}
              tone={nearestKm != null && nearestKm < 0.3 ? "bad" : nearestKm != null && nearestKm < 1 ? "warn" : "good"}
              sub="Direct walk-in overlap zone" />
            <Stat label="Within 1 km" value={String(ringStats[0].count)}
              tone={ringStats[0].count >= 3 ? "bad" : ringStats[0].count >= 1 ? "warn" : "good"}
              sub="Highest-pressure ring" />
            <Stat label="Market pressure" value={pressureLabel}
              toneClass={pressureTone}
              sub={`Weighted density score ${pressureScore.toFixed(0)}`} />
          </div>

          {/* Heatmap */}
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    type="number" dataKey="x" name="East/West"
                    domain={[-RADIUS_KM, RADIUS_KM]}
                    tick={{ fontSize: 10 }} stroke="var(--muted-foreground)"
                    label={{ value: "← west · east → (km)", position: "insideBottom", offset: -2, fontSize: 10, fill: "var(--muted-foreground)" }}
                    tickFormatter={(v) => `${v}`}
                  />
                  <YAxis
                    type="number" dataKey="y" name="North/South"
                    domain={[-RADIUS_KM, RADIUS_KM]}
                    tick={{ fontSize: 10 }} stroke="var(--muted-foreground)"
                    label={{ value: "south ↔ north (km)", angle: -90, position: "insideLeft", fontSize: 10, fill: "var(--muted-foreground)" }}
                  />
                  <ZAxis range={[60, 200]} />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    formatter={(_v: any, _n: any, ctx: any) => {
                      const c = ctx?.payload;
                      if (!c) return ["", ""];
                      return [`${c.distance.toFixed(2)} km · ${c.postcode ?? ""}`, c.name];
                    }}
                    labelFormatter={() => ""}
                  />
                  {/* Focal pharmacy marker as a single-point series */}
                  <Scatter
                    name="Focus pharmacy"
                    data={[{ x: 0, y: 0, name: focusPharm.name, postcode: "Focus", distance: 0 }]}
                    fill={colorFor(focusPharm.id)}
                    shape="star"
                  />
                  <Scatter
                    name="Competitors"
                    data={local}
                  >
                    {local.map((c) => (
                      <Cell key={c.id} fill={colourFor(c)} fillOpacity={c.isSelected ? 1 : 0.78} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            {/* Distance band legend */}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-rose-600" /> ≤1 km</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" /> 1–2 km</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> 2–3 km</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-sky-500" /> 3–5 km</span>
              <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" style={{ color: colorFor(focusPharm.id) }} /> Focus pharmacy at (0,0)</span>
            </div>
          </div>

          {/* Ring density breakdown */}
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            {ringStats.map((r) => (
              <div key={r.ring} className="rounded-lg border border-border bg-secondary/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.label}</p>
                <p className="text-xl font-bold tabular-nums mt-1">{r.count}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {r.density.toFixed(2)} per km²
                </p>
              </div>
            ))}
          </div>

          {/* Nearest competitors table */}
          {local.length > 0 && (
            <div className="mt-4 rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-2 bg-secondary text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5" /> Closest 8 competitors
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[440px]">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="text-left px-3 py-2 font-medium">#</th>
                      <th className="text-left px-3 py-2 font-medium">Pharmacy</th>
                      <th className="text-left px-3 py-2 font-medium">Postcode</th>
                      <th className="text-right px-3 py-2 font-medium">Distance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {local.slice(0, 8).map((c, i) => (
                      <tr key={c.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2 font-medium truncate max-w-[260px]" title={c.name}>
                          {c.isSelected && <span className="text-[9px] uppercase mr-1 rounded bg-gold/15 text-gold px-1 py-0.5">Selected</span>}
                          {c.name}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{c.postcode || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{c.distance.toFixed(2)} km</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  label, value, sub, tone = "neutral", toneClass,
}: {
  label: string; value: string; sub?: string;
  tone?: "neutral" | "good" | "warn" | "bad"; toneClass?: string;
}) {
  const cls = toneClass ??
    (tone === "bad" ? "text-rose-700 border-rose-200 bg-rose-50" :
     tone === "warn" ? "text-amber-800 border-amber-200 bg-amber-50" :
     tone === "good" ? "text-emerald-700 border-emerald-200 bg-emerald-50" :
     "border-border bg-secondary/30");
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-xl font-bold tabular-nums mt-1">{value}</p>
      {sub && <p className="text-[11px] opacity-70 mt-0.5 leading-snug">{sub}</p>}
    </div>
  );
}

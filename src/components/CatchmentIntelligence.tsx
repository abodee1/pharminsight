import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  lat: number | null;
  lng: number | null;
  country: string | null;
};

type Agg = {
  zone_count: number;
  avg_overall: number | null;
  avg_income: number | null;
  avg_employment: number | null;
  avg_health: number | null;
  avg_education: number | null;
  avg_crime: number | null;
  avg_housing: number | null;
  avg_access: number | null;
  avg_idaci: number | null;
  avg_idaopi: number | null;
};

const RADII: { label: string; miles: number; metres: number }[] = [
  { label: "0.5 mi", miles: 0.5, metres: 805 },
  { label: "1 mi", miles: 1, metres: 1609 },
  { label: "2 mi", miles: 2, metres: 3219 },
];

const FALLBACK_RADII: { label: string; miles: number; metres: number }[] = [
  ...RADII,
  { label: "5 mi", miles: 5, metres: 8047 },
  { label: "10 mi", miles: 10, metres: 16093 },
];

const DOMAIN_KEYS = [
  { key: "avg_income", label: "Income" },
  { key: "avg_employment", label: "Employment" },
  { key: "avg_health", label: "Health" },
  { key: "avg_education", label: "Education" },
  { key: "avg_crime", label: "Crime" },
  { key: "avg_housing", label: "Housing" },
  { key: "avg_access", label: "Access" },
] as const;

function bandFor(d: number | null): { label: string; cls: string; border: string } {
  if (d == null) return { label: "Unknown", cls: "bg-muted text-muted-foreground", border: "border-muted" };
  if (d >= 9) return { label: "Most Deprived", cls: "bg-red-700 text-white", border: "border-red-700" };
  if (d >= 7) return { label: "High Deprivation", cls: "bg-orange-600 text-white", border: "border-orange-600" };
  if (d >= 5) return { label: "Moderate Deprivation", cls: "bg-amber-500 text-white", border: "border-amber-500" };
  if (d >= 3) return { label: "Low Deprivation", cls: "bg-lime-500 text-white", border: "border-lime-500" };
  return { label: "Least Deprived", cls: "bg-green-600 text-white", border: "border-green-600" };
}

function badgeColor(d: number | null): string {
  if (d == null) return "bg-muted text-muted-foreground";
  if (d >= 7) return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200 border border-red-300/50";
  if (d >= 4) return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 border border-amber-300/50";
  return "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200 border border-green-300/50";
}

function insightFor(key: string, isScotland: boolean, isEngland: boolean): string | null {
  switch (key) {
    case "avg_income":
      return "A significant proportion of your catchment population likely holds a prepayment certificate or qualifies for NHS exemptions — consider prominently signposting exemption eligibility in your dispensary.";
    case "avg_employment":
      return "High employment deprivation in this catchment suggests strong daytime footfall. Walk-in services and flexible opening hours may be particularly valued here.";
    case "avg_health":
      return "Elevated health deprivation points to a high burden of chronic disease in your catchment. This pharmacy is well positioned to maximise Pharmacy First and long-term condition management services.";
    case "avg_education":
      return "Lower education levels in this catchment suggest health literacy may be a barrier. Plain-language counselling and visual medication aids could meaningfully improve adherence.";
    case "avg_crime":
      return "Elevated crime deprivation in this area may indicate demand for needle exchange, substance misuse support, or naloxone provision. Check local commissioned service availability.";
    case "avg_housing":
      if (!isScotland) return null;
      return "Housing deprivation in this catchment may be associated with transient populations and irregular medication adherence. Proactive follow-up and MDS services could be beneficial.";
    case "avg_access":
      if (!isScotland) return null;
      return "Poor geographic access to services makes this pharmacy a critical healthcare resource for its community. Extended hours or delivery services may significantly improve patient outcomes.";
    default:
      return null;
  }
}

export function CatchmentIntelligence({ lat, lng, country }: Props) {
  const nation = (country || "").toLowerCase();
  const isNI = nation === "northern ireland";
  const isScotland = nation === "scotland";
  const isEngland = nation === "england";
  const supported = isEngland || isScotland;

  const [radiusIdx, setRadiusIdx] = useState(1);
  const [agg, setAgg] = useState<Agg | null>(null);
  const [effectiveRadius, setEffectiveRadius] = useState(RADII[1]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const radius = RADII[radiusIdx];

  useEffect(() => {
    if (!supported || lat == null || lng == null) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const attempts = FALLBACK_RADII.filter((r) => r.metres >= radius.metres);
      let selectedAgg: Agg | null = null;
      let selectedRadius = radius;
      let selectedError: string | null = null;

      for (const attempt of attempts) {
        const { data, error } = await supabase.rpc("deprivation_in_radius", {
          p_lat: lat,
          p_lng: lng,
          p_radius_m: attempt.metres,
          p_nation: isScotland ? "scotland" : "england",
        });
        if (error) {
          selectedError = error.message;
          break;
        }
        const row = (Array.isArray(data) ? data[0] : data) as Agg | null;
        selectedAgg = row ?? null;
        selectedRadius = attempt;
        if ((row?.zone_count ?? 0) > 0) break;
      }
      if (cancelled) return;
      if (selectedError) {
        setError(selectedError);
        setAgg(null);
      } else {
        setAgg(selectedAgg);
        setEffectiveRadius(selectedRadius);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [lat, lng, radius.metres, isScotland, supported]);

  if (isNI) {
    return (
      <div className="mt-6 rounded-lg bg-card border border-border shadow-sm p-5">
        <h2 className="text-base font-semibold">Catchment Intelligence</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Catchment intelligence is not yet available for Northern Ireland. We are working to add
          Northern Ireland deprivation data in a future update.
        </p>
      </div>
    );
  }

  if (!supported) return null;

  const overall = agg?.avg_overall != null ? Number(agg.avg_overall) : null;
  const band = bandFor(overall);
  const zoneCount = agg?.zone_count ?? 0;
  const zoneLabel = isEngland ? "LSOAs" : "Data Zones";
  const usingFallback = effectiveRadius.metres !== radius.metres;

  const radarData = DOMAIN_KEYS.map((d) => {
    const v = agg ? (agg as any)[d.key] : null;
    return { domain: d.label, value: v == null ? 0 : Number(v) };
  });

  // Top scoring domains for insights
  const ranked = DOMAIN_KEYS
    .map((d) => ({ key: d.key, label: d.label, value: agg ? Number((agg as any)[d.key] ?? 0) : 0 }))
    .filter((d) => d.value >= 7)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);

  const insights = ranked
    .map((d) => insightFor(d.key, isScotland, isEngland))
    .filter(Boolean) as string[];

  const idaopi = agg?.avg_idaopi != null ? Number(agg.avg_idaopi) : null;
  if (isEngland && idaopi != null && idaopi >= 7) {
    insights.push(
      "High older people income deprivation in this catchment suggests strong demand for MDS dosette box preparation and medication delivery services.",
    );
  }

  return (
    <div className="mt-6 rounded-lg bg-card border border-border shadow-sm overflow-hidden">
      <div className="px-4 md:px-5 py-4 border-b border-border">
        <h2 className="text-base font-semibold">Catchment Intelligence</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Deprivation profile of the population within your catchment area.
        </p>
      </div>

      <div className="p-4 md:p-5 space-y-5">
        {/* Radius toggle */}
        <div className="inline-flex rounded-full border border-border bg-secondary/40 p-1">
          {RADII.map((r, i) => (
            <button
              key={r.label}
              onClick={() => setRadiusIdx(i)}
              className={`px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${
                i === radiusIdx
                  ? "bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Recalculating catchment…
          </div>
        )}

        {!loading && error && (
          <p className="text-sm text-destructive">Could not load catchment data: {error}</p>
        )}

        {!loading && !error && zoneCount === 0 && (
          <div className="rounded-md border border-dashed border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
            No deprivation areas found within {effectiveRadius.label} of this pharmacy.
          </div>
        )}

        {!loading && !error && zoneCount > 0 && (
          <>
            {/* Band headline */}
            <div className={`flex items-center gap-3 rounded-md border-l-4 ${band.border} bg-secondary/30 px-4 py-3`}>
              <div>
                <div className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${band.cls}`}>
                  {band.label}
                </div>
                <div className="text-xs text-muted-foreground mt-1.5">
                  Based on {zoneCount} {zoneCount === 1 ? zoneLabel.slice(0, -1) : zoneLabel.toLowerCase()} within {effectiveRadius.label}.
                  {usingFallback && <> No zones were found inside {radius.label}, so the nearest wider catchment is shown.</>}
                  {overall != null && <> Average overall decile: <span className="font-medium text-foreground">{overall.toFixed(1)}</span> / 10.</>}
                </div>
              </div>
            </div>

            {/* Radar */}
            <div className="w-full h-72">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} outerRadius="75%">
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="domain" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <PolarRadiusAxis domain={[0, 10]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickCount={6} />
                  <Radar
                    name="Catchment"
                    dataKey="value"
                    stroke="hsl(var(--primary))"
                    fill="hsl(var(--primary))"
                    fillOpacity={0.35}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {/* Domain badges */}
            <div className="flex flex-wrap gap-2">
              {DOMAIN_KEYS.map((d) => {
                const v = agg ? Number((agg as any)[d.key] ?? 0) : 0;
                return (
                  <span
                    key={d.key}
                    className={`text-xs px-2.5 py-1 rounded-md font-medium ${badgeColor(v)}`}
                  >
                    {d.label}: <span className="tabular-nums">{v.toFixed(1)}</span>
                  </span>
                );
              })}
            </div>

            {/* Insights */}
            {insights.length > 0 && (
              <ul className="space-y-2 text-sm leading-relaxed">
                {insights.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-primary mt-1">•</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Footer */}
            <p className="text-[11px] text-muted-foreground pt-2 border-t border-border/60">
              {isEngland ? (
                <>Catchment based on {zoneCount} LSOAs within {effectiveRadius.label}. Deprivation data: English Indices of Deprivation 2025 (IMD25), MHCLG. Open Government Licence v3.0.</>
              ) : (
                <>Catchment based on {zoneCount} Data Zones within {effectiveRadius.label}. Deprivation data: Scottish Index of Multiple Deprivation 2020v2 (SIMD), Scottish Government / NHS Scotland. Open Government Licence v3.0.</>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

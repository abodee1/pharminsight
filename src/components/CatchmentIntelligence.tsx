import { useEffect, useState } from "react";
import { Loader2, Users, TrendingDown, TrendingUp, MapPin, Info } from "lucide-react";
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
  total_population: number | null;
};

type Breakdown = {
  distribution: { decile: number; zone_count: number; population: number }[];
  most_deprived: { zone_name: string; overall_decile: number; population: number | null } | null;
  least_deprived: { zone_name: string; overall_decile: number; population: number | null } | null;
  totals: {
    total_pop: number;
    pop_most_deprived_30: number;
    pop_least_deprived_30: number;
    zones_most_deprived_30: number;
    avg_idaci: number | null;
    avg_idaopi: number | null;
  } | null;
};

const RADII: { label: string; miles: number; metres: number }[] = [
  { label: "0.5 mi", miles: 0.5, metres: 805 },
  { label: "1 mi", miles: 1, metres: 1609 },
  { label: "2 mi", miles: 2, metres: 3219 },
  { label: "3 mi", miles: 3, metres: 4828 },
  { label: "5 mi", miles: 5, metres: 8047 },
  { label: "10 mi", miles: 10, metres: 16093 },
];

const FALLBACK_RADII = RADII;

const DOMAIN_KEYS = [
  { key: "avg_income", label: "Income" },
  { key: "avg_employment", label: "Employment" },
  { key: "avg_health", label: "Health" },
  { key: "avg_education", label: "Education" },
  { key: "avg_crime", label: "Crime" },
  { key: "avg_housing", label: "Housing" },
  { key: "avg_access", label: "Access" },
] as const;

function bandFor(d: number | null): { label: string; cls: string; border: string; grad: string; ring: string } {
  if (d == null) return { label: "Unknown", cls: "bg-muted text-muted-foreground", border: "border-muted", grad: "from-muted to-muted", ring: "ring-muted" };
  if (d >= 9) return { label: "Most Deprived", cls: "bg-red-700 text-white", border: "border-red-700", grad: "from-red-700 to-red-500", ring: "ring-red-200" };
  if (d >= 7) return { label: "High Deprivation", cls: "bg-orange-600 text-white", border: "border-orange-600", grad: "from-orange-600 to-amber-400", ring: "ring-orange-200" };
  if (d >= 5) return { label: "Moderate Deprivation", cls: "bg-amber-500 text-white", border: "border-amber-500", grad: "from-amber-500 to-lime-400", ring: "ring-amber-200" };
  if (d >= 3) return { label: "Low Deprivation", cls: "bg-lime-500 text-white", border: "border-lime-500", grad: "from-lime-500 to-green-500", ring: "ring-lime-200" };
  return { label: "Least Deprived", cls: "bg-green-600 text-white", border: "border-green-600", grad: "from-green-600 to-emerald-500", ring: "ring-green-200" };
}

function badgeColor(d: number | null): string {
  if (d == null) return "bg-muted text-muted-foreground";
  if (d >= 7) return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200 border border-red-300/50";
  if (d >= 4) return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 border border-amber-300/50";
  return "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200 border border-green-300/50";
}

function meterColor(d: number | null): string {
  if (d == null) return "bg-muted";
  if (d >= 7) return "bg-red-500";
  if (d >= 4) return "bg-amber-500";
  return "bg-green-500";
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
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [effectiveRadius, setEffectiveRadius] = useState(RADII[1]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDecile, setSelectedDecile] = useState<number | null>(null);
  const [zoneList, setZoneList] = useState<{ zone_code: string; zone_name: string; overall_decile: number; population: number | null; dist_m: number }[] | null>(null);
  const [zoneListLoading, setZoneListLoading] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const radius = RADII[radiusIdx];

  // Reset selection when radius/location changes
  useEffect(() => { setSelectedDecile(null); setZoneList(null); }, [lat, lng, radius.metres]);

  // Fetch zones when decile selected
  useEffect(() => {
    if (selectedDecile == null || lat == null || lng == null) return;
    let cancelled = false;
    (async () => {
      setZoneListLoading(true);
      const { data, error } = await supabase.rpc("catchment_zones_by_decile", {
        p_lat: lat, p_lng: lng, p_radius_m: effectiveRadius.metres,
        p_nation: isScotland ? "scotland" : "england", p_decile: selectedDecile,
      });
      if (cancelled) return;
      if (!error) setZoneList((data as any) ?? []);
      setZoneListLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedDecile, lat, lng, effectiveRadius.metres, isScotland]);

  useEffect(() => {
    if (!supported || lat == null || lng == null) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const nation = isScotland ? "scotland" : "england";
      const attempts = FALLBACK_RADII.filter((r) => r.metres >= radius.metres);
      let selectedAgg: Agg | null = null;
      let selectedBreakdown: Breakdown | null = null;
      let selectedRadius = radius;
      let selectedError: string | null = null;

      for (const attempt of attempts) {
        const [aggRes, brkRes] = await Promise.all([
          supabase.rpc("deprivation_in_radius", {
            p_lat: lat, p_lng: lng, p_radius_m: attempt.metres, p_nation: nation,
          }),
          supabase.rpc("catchment_breakdown", {
            p_lat: lat, p_lng: lng, p_radius_m: attempt.metres, p_nation: nation,
          }),
        ]);
        if (aggRes.error) { selectedError = aggRes.error.message; break; }
        const row = (Array.isArray(aggRes.data) ? aggRes.data[0] : aggRes.data) as Agg | null;
        selectedAgg = row ?? null;
        selectedBreakdown = (brkRes.data as Breakdown | null) ?? null;
        selectedRadius = attempt;
        if ((row?.zone_count ?? 0) > 0) break;
      }
      if (cancelled) return;
      if (selectedError) {
        setError(selectedError);
        setAgg(null);
        setBreakdown(null);
      } else {
        setAgg(selectedAgg);
        setBreakdown(selectedBreakdown);
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
    <div className="mt-6 rounded-xl bg-card border border-border shadow-sm overflow-hidden">
      <div className="relative px-4 md:px-6 py-5 border-b border-border bg-gradient-to-br from-secondary/60 via-card to-card">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Catchment Intelligence</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Deprivation profile of the population within your catchment area.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowInfo(!showInfo)}
            aria-expanded={showInfo}
            className={`shrink-0 inline-flex items-center justify-center rounded-full p-1.5 transition-colors ${showInfo ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
            aria-label="What do these figures mean?"
            title="What do these figures mean?"
          >
            <Info className="h-4 w-4" />
          </button>
        </div>
      </div>


      <div className="p-4 md:p-5 space-y-5">
        {showInfo && (
          <div className="rounded-md border border-border bg-secondary/40 p-4 text-sm leading-relaxed">
            <div className="flex items-center gap-2 mb-3 text-foreground">
              <Info className="h-4 w-4" />
              <span className="font-medium">What these figures mean for this pharmacy</span>
            </div>
            <ul className="space-y-2 text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">Catchment area:</span> The figures describe the population living within{" "}
                <span className="font-medium text-foreground">{effectiveRadius.label}</span> of this pharmacy, using {zoneCount} {zoneCount === 1 ? zoneLabel.slice(0, -1) : zoneLabel.toLowerCase()}. Change the radius above to see how the profile changes with distance.
              </li>
              {overall != null && (
                <li>
                  <span className="font-medium text-foreground">Overall deprivation:</span> The average IMD/SIMD decile for this catchment is{" "}
                  <span className="font-medium text-foreground">{overall.toFixed(1)} / 10</span> ({band.label.toLowerCase()}). Deciles run from 1 (most deprived) to 10 (least deprived), so a lower number indicates a more deprived catchment on average.
                </li>
              )}
              <li>
                <span className="font-medium text-foreground">Radar chart:</span> Each spoke shows how this catchment scores across deprivation domains: income, employment, health, education, crime, housing and access. Higher values mean more deprivation in that domain, with 10 being the most deprived decile nationally.
              </li>
              <li>
                <span className="font-medium text-foreground">Population & concentration:</span> The total population estimate, density per square mile, and the share of residents living in the most/least deprived 30% of areas. These help gauge how many people are likely affected by each type of deprivation.
              </li>
              <li>
                <span className="font-medium text-foreground">Decile distribution:</span> The coloured bar shows how catchment residents are spread across all 10 deprivation deciles. Click any band to see the specific {zoneLabel.toLowerCase()} that make up that segment.
              </li>
              {insights.length > 0 && (
                <li>
                  <span className="font-medium text-foreground">Service opportunities:</span> The suggestions below translate the data into practical service ideas for this pharmacy, such as Pharmacy First, MDS dosette boxes, delivery services or exemption signposting.
                </li>
              )}
            </ul>
          </div>
        )}

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

            {/* Population & concentration stats */}
            {(() => {
              const totals = breakdown?.totals;
              const totalPop = totals?.total_pop ?? agg?.total_population ?? 0;
              const popMost = totals?.pop_most_deprived_30 ?? 0;
              const popLeast = totals?.pop_least_deprived_30 ?? 0;
              const pctMost = totalPop > 0 ? Math.round((popMost / totalPop) * 100) : 0;
              const pctLeast = totalPop > 0 ? Math.round((popLeast / totalPop) * 100) : 0;
              const areaSqMi = Math.PI * effectiveRadius.miles * effectiveRadius.miles;
              const density = areaSqMi > 0 ? Math.round(totalPop / areaSqMi) : 0;
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="rounded-md border border-border bg-secondary/30 p-3">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wide">
                      <Users className="h-3 w-3" /> Population
                    </div>
                    <div className="text-lg font-semibold tabular-nums mt-1">{totalPop.toLocaleString()}</div>
                    <div className="text-[11px] text-muted-foreground">≈{density.toLocaleString()}/sq mi</div>
                  </div>
                  <div className="rounded-md border border-border bg-secondary/30 p-3">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wide">
                      <TrendingDown className="h-3 w-3 text-red-600" /> In most deprived 30%
                    </div>
                    <div className="text-lg font-semibold tabular-nums mt-1">{pctMost}%</div>
                    <div className="text-[11px] text-muted-foreground">{popMost.toLocaleString()} residents</div>
                  </div>
                  <div className="rounded-md border border-border bg-secondary/30 p-3">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wide">
                      <TrendingUp className="h-3 w-3 text-green-600" /> In least deprived 30%
                    </div>
                    <div className="text-lg font-semibold tabular-nums mt-1">{pctLeast}%</div>
                    <div className="text-[11px] text-muted-foreground">{popLeast.toLocaleString()} residents</div>
                  </div>
                  <div className="rounded-md border border-border bg-secondary/30 p-3">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wide">
                      <MapPin className="h-3 w-3" /> Catchment area
                    </div>
                    <div className="text-lg font-semibold tabular-nums mt-1">{areaSqMi.toFixed(1)} <span className="text-xs font-normal text-muted-foreground">sq mi</span></div>
                    <div className="text-[11px] text-muted-foreground">{zoneCount} {zoneLabel.toLowerCase()}</div>
                  </div>
                </div>
              );
            })()}

            {/* Decile distribution bar */}
            {breakdown && breakdown.distribution.length > 0 && (() => {
              const totalPop = breakdown.totals?.total_pop ?? 0;
              const decileColors: Record<number, string> = {
                1: "bg-red-700", 2: "bg-red-600", 3: "bg-orange-600",
                4: "bg-orange-500", 5: "bg-amber-500", 6: "bg-amber-400",
                7: "bg-lime-500", 8: "bg-lime-600", 9: "bg-green-600", 10: "bg-green-700",
              };
              return (
                <div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                    <span className="font-medium text-foreground">Population by deprivation decile</span>
                    <span>1 = most deprived → 10 = least</span>
                  </div>
                  <div className="flex h-6 w-full rounded-md overflow-hidden border border-border">
                    {[1,2,3,4,5,6,7,8,9,10].map((d) => {
                      const row = breakdown.distribution.find((r) => r.decile === d);
                      const pop = row?.population ?? 0;
                      const pct = totalPop > 0 ? (pop / totalPop) * 100 : 0;
                      if (pct <= 0) return null;
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setSelectedDecile(selectedDecile === d ? null : d)}
                          className={`${decileColors[d]} h-full flex items-center justify-center text-[10px] font-medium text-white transition-all hover:opacity-80 ${selectedDecile === d ? "ring-2 ring-foreground ring-inset" : ""}`}
                          style={{ width: `${pct}%` }}
                          title={`Decile ${d}: ${pop.toLocaleString()} (${pct.toFixed(1)}%) · ${row?.zone_count ?? 0} ${zoneLabel.toLowerCase()} — click for details`}
                        >
                          {pct >= 8 ? `${Math.round(pct)}%` : ""}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-0.5">
                    <span>Decile 1</span><span>5</span><span>Decile 10</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1.5">Click a band to see the {zoneLabel.toLowerCase()} in that decile.</p>

                  {/* Decile drill-down */}
                  {selectedDecile != null && (() => {
                    const row = breakdown.distribution.find((r) => r.decile === selectedDecile);
                    const pct = totalPop > 0 && row ? (row.population / totalPop) * 100 : 0;
                    const band = bandFor(selectedDecile);
                    return (
                      <div className="mt-3 rounded-md border border-border bg-background p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${band.cls}`}>Decile {selectedDecile}</span>
                            <span className="text-xs text-muted-foreground">{band.label}</span>
                          </div>
                          <button onClick={() => setSelectedDecile(null)} className="text-xs text-muted-foreground hover:text-foreground">Close ✕</button>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                          <div><div className="text-muted-foreground">Zones</div><div className="font-semibold tabular-nums">{row?.zone_count ?? 0}</div></div>
                          <div><div className="text-muted-foreground">Population</div><div className="font-semibold tabular-nums">{(row?.population ?? 0).toLocaleString()}</div></div>
                          <div><div className="text-muted-foreground">% of catchment</div><div className="font-semibold tabular-nums">{pct.toFixed(1)}%</div></div>
                        </div>
                        {zoneListLoading && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                            <Loader2 className="h-3 w-3 animate-spin" /> Loading {zoneLabel.toLowerCase()}…
                          </div>
                        )}
                        {!zoneListLoading && zoneList && zoneList.length > 0 && (
                          <div className="max-h-56 overflow-y-auto rounded border border-border divide-y divide-border">
                            {zoneList.map((z) => (
                              <div key={z.zone_code} className="px-2.5 py-1.5 text-xs flex items-center justify-between gap-2 hover:bg-secondary/40">
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium truncate">{z.zone_name}</div>
                                  <div className="text-[10px] text-muted-foreground">{z.zone_code}</div>
                                </div>
                                <div className="text-right text-muted-foreground whitespace-nowrap">
                                  <div className="tabular-nums">{(z.population ?? 0).toLocaleString()}</div>
                                  <div className="text-[10px] tabular-nums">{(z.dist_m / 1609).toFixed(2)} mi</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {!zoneListLoading && zoneList && zoneList.length === 0 && (
                          <p className="text-xs text-muted-foreground">No {zoneLabel.toLowerCase()} in this decile.</p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })()}

            {/* Most & least deprived zones */}
            {breakdown && (breakdown.most_deprived || breakdown.least_deprived) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {breakdown.most_deprived && (
                  <div className="rounded-md border-l-4 border-red-600 bg-secondary/30 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Most deprived nearby</div>
                    <div className="text-sm font-medium mt-0.5">{breakdown.most_deprived.zone_name}</div>
                    <div className="text-xs text-muted-foreground">
                      Decile {breakdown.most_deprived.overall_decile}
                      {breakdown.most_deprived.population != null && <> · {breakdown.most_deprived.population.toLocaleString()} residents</>}
                    </div>
                  </div>
                )}
                {breakdown.least_deprived && (
                  <div className="rounded-md border-l-4 border-green-600 bg-secondary/30 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Least deprived nearby</div>
                    <div className="text-sm font-medium mt-0.5">{breakdown.least_deprived.zone_name}</div>
                    <div className="text-xs text-muted-foreground">
                      Decile {breakdown.least_deprived.overall_decile}
                      {breakdown.least_deprived.population != null && <> · {breakdown.least_deprived.population.toLocaleString()} residents</>}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Domain badges */}
            <div>
              <div className="text-xs font-medium text-foreground mb-1.5">Domain deciles</div>
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
                {isEngland && agg?.avg_idaci != null && (
                  <span className={`text-xs px-2.5 py-1 rounded-md font-medium ${badgeColor(Number(agg.avg_idaci))}`}>
                    Children (IDACI): <span className="tabular-nums">{Number(agg.avg_idaci).toFixed(1)}</span>
                  </span>
                )}
                {isEngland && agg?.avg_idaopi != null && (
                  <span className={`text-xs px-2.5 py-1 rounded-md font-medium ${badgeColor(Number(agg.avg_idaopi))}`}>
                    Older people (IDAOPI): <span className="tabular-nums">{Number(agg.avg_idaopi).toFixed(1)}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Insights */}
            {insights.length > 0 && (
              <div>
                <div className="text-xs font-medium text-foreground mb-1.5">Service opportunities</div>
                <ul className="space-y-2 text-sm leading-relaxed">
                  {insights.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-primary mt-1">•</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
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

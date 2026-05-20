import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader } from "@/components/PageHeader";
import { DataAttribution } from "@/components/DataAttribution";
import { useAuth } from "@/hooks/useAuth";
import { X, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { PharmacySearch } from "@/components/PharmacySearch";
import { CountryBadge } from "@/components/CountryBadge";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";

export const Route = createFileRoute("/_authenticated/compare")({ component: Compare });

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

type MetricDef = {
  key: string;
  label: string;
  short: string;
  group: "volume" | "rate";
  compute: (r: Row | undefined) => number;
  format: (v: number) => string;
};

const fmtInt = (v: number) => Math.round(v).toLocaleString();
const fmtRate = (v: number) => v.toFixed(1);
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

const METRICS: MetricDef[] = [
  // Raw volume metrics
  { key: "items_dispensed", label: "Items dispensed", short: "Items", group: "volume",
    compute: (r) => r?.items_dispensed ?? 0, format: fmtInt },
  { key: "nms_count", label: "NMS consultations", short: "NMS", group: "volume",
    compute: (r) => r?.nms_count ?? 0, format: fmtInt },
  { key: "pharmacy_first_count", label: "Pharmacy First", short: "PF", group: "volume",
    compute: (r) => r?.pharmacy_first_count ?? 0, format: fmtInt },
  { key: "eps_items", label: "EPS items", short: "EPS", group: "volume",
    compute: (r) => r?.eps_items ?? 0, format: fmtInt },
  // Derived service-intensity metrics — far more comparable across pharmacy size
  { key: "pf_per_1k", label: "PF per 1k items", short: "PF/1k", group: "rate",
    compute: (r) => {
      const items = r?.items_dispensed ?? 0;
      return items > 0 ? ((r?.pharmacy_first_count ?? 0) * 1000) / items : 0;
    }, format: fmtRate },
  { key: "nms_per_1k", label: "NMS per 1k items", short: "NMS/1k", group: "rate",
    compute: (r) => {
      const items = r?.items_dispensed ?? 0;
      return items > 0 ? ((r?.nms_count ?? 0) * 1000) / items : 0;
    }, format: fmtRate },
  { key: "eps_share", label: "EPS share", short: "EPS %", group: "rate",
    compute: (r) => {
      const items = r?.items_dispensed ?? 0;
      return items > 0 ? ((r?.eps_items ?? 0) / items) * 100 : 0;
    }, format: fmtPct },
];

const SERIES_COLORS = [
  "var(--cmp-1)",
  "var(--cmp-2)",
  "var(--cmp-3)",
  "var(--cmp-4)",
];

type Pharm = { id: string; name: string; region: string | null; country: string | null; postcode: string | null };
type Row = {
  pharmacy_id: string; month: number; year: number;
  items_dispensed: number; nms_count: number; pharmacy_first_count: number;
  flu_vaccinations: number; eps_items: number; eps_nominations: number;
};

const MAX_SELECT = 4;

function Compare() {
  const { user } = useAuth();
  const [pharms, setPharms] = useState<Pharm[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Preload the user's primary pharmacy as the first selection.
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: up } = await supabase
        .from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle();
      if (!up?.pharmacy_id) return;
      const { data: ph } = await supabase
        .from("pharmacies").select("id,name,region,country,postcode")
        .eq("id", up.pharmacy_id).maybeSingle();
      if (ph) {
        setPharms((cur) => (cur.some((x) => x.id === ph.id) ? cur : [...cur, ph as Pharm]));
        setSelected((cur) => (cur.includes(ph.id) ? cur : [...cur, ph.id]));
      }
    })();
  }, [user]);

  // Fetch dispensing data only for the selected pharmacies (last 24 months).
  useEffect(() => {
    if (selected.length === 0) { setRows([]); return; }
    setLoading(true);
    (async () => {
      const now = new Date();
      const cutoff = new Date(now.getFullYear(), now.getMonth() - 24, 1);
      const cutoffYear = cutoff.getFullYear();
      const data = await fetchAll<Row>((from, to) =>
        supabase
          .from("dispensing_data")
          .select("pharmacy_id,month,year,items_dispensed,nms_count,pharmacy_first_count,flu_vaccinations,eps_items,eps_nominations")
          .in("pharmacy_id", selected)
          .gte("year", cutoffYear)
          .order("year", { ascending: true })
          .order("month", { ascending: true })
          .range(from, to)
      );
      setRows(data);
      setLoading(false);
    })();
  }, [selected]);

  const selectedPharms = useMemo(
    () => selected.map((id) => pharms.find((p) => p.id === id)).filter(Boolean) as Pharm[],
    [selected, pharms]
  );

  const periods = useMemo(
    () => Array.from(new Set(rows.map((r) => `${r.year}-${String(r.month).padStart(2, "0")}`))).sort(),
    [rows]
  );
  const latest = periods[periods.length - 1];
  const prev = periods[periods.length - 2];

  // Trend data — one series per metric, x-axis = period, lines = selected pharmacies
  const trendByMetric = useMemo(() => {
    return METRICS.map((mt) => ({
      metric: mt,
      data: periods.map((p) => {
        const [y, m] = p.split("-").map(Number);
        const point: Record<string, any> = { label: `${MONTHS[m - 1]} ${String(y).slice(2)}` };
        selectedPharms.forEach((ph) => {
          const row = rows.find((r) => r.pharmacy_id === ph.id && r.year === y && r.month === m);
          point[ph.id] = mt.compute(row);
        });
        return point;
      }),
    }));
  }, [periods, selectedPharms, rows]);

  // Side-by-side metric data
  const sideBySide = useMemo(() => {
    if (!latest) return [];
    const [y, m] = latest.split("-").map(Number);
    return METRICS.map((mt) => {
      const point: Record<string, any> = { metric: mt.short };
      selectedPharms.forEach((ph) => {
        const row = rows.find((r) => r.pharmacy_id === ph.id && r.year === y && r.month === m);
        point[ph.id] = mt.compute(row);
      });
      return point;
    });
  }, [latest, selectedPharms, rows]);

  // Radar (normalised to max across selected for each metric)
  const radar = useMemo(() => {
    if (!latest) return [];
    const [y, m] = latest.split("-").map(Number);
    return METRICS.map((mt) => {
      const point: Record<string, any> = { metric: mt.short };
      const vals = selectedPharms.map((ph) => {
        const row = rows.find((r) => r.pharmacy_id === ph.id && r.year === y && r.month === m);
        return mt.compute(row);
      });
      const max = Math.max(1, ...vals);
      selectedPharms.forEach((ph, i) => {
        point[ph.id] = Math.round((vals[i] / max) * 100);
      });
      return point;
    });
  }, [latest, selectedPharms, rows]);

  // Headline per pharmacy — all metrics + change vs prior
  const headline = useMemo(() => {
    if (!latest) return [];
    const [ly, lm] = latest.split("-").map(Number);
    const [py, pm] = (prev || "0-0").split("-").map(Number);
    return selectedPharms.map((ph) => {
      const cur = rows.find((r) => r.pharmacy_id === ph.id && r.year === ly && r.month === lm);
      const prv = prev ? rows.find((r) => r.pharmacy_id === ph.id && r.year === py && r.month === pm) : null;
      const metrics = METRICS.map((mt) => {
        const v = mt.compute(cur);
        const p = mt.compute(prv ?? undefined);
        const diff = v - p;
        const pct = p ? Math.round((diff / p) * 100) : 0;
        return { mt, value: v, diff, pct };
      });
      return { ph, metrics };
    });
  }, [latest, prev, selectedPharms, rows]);

  // Winner per metric
  const winners = useMemo(() => {
    if (!latest) return {} as Record<string, string>;
    const [y, m] = latest.split("-").map(Number);
    const out: Record<string, string> = {};
    METRICS.forEach((mt) => {
      let best = -1;
      let id = "";
      selectedPharms.forEach((ph) => {
        const row = rows.find((r) => r.pharmacy_id === ph.id && r.year === y && r.month === m);
        const v = mt.compute(row);
        if (v > best) { best = v; id = ph.id; }
      });
      out[mt.key] = id;
    });
    return out;
  }, [latest, selectedPharms, rows]);


  function remove(id: string) {
    setSelected((cur) => cur.filter((x) => x !== id));
  }

  const colorFor = (id: string) => SERIES_COLORS[selected.indexOf(id) % SERIES_COLORS.length];

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Compare pharmacies"
        subtitle="Pick up to 4 pharmacies to see them side by side across every NHS service."
      />

      {/* Selector */}
      <div className="rounded-xl bg-card border border-border p-5 shadow-sm mb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="md:w-[420px] shrink-0">
            {selected.length < MAX_SELECT ? (
              <PharmacySearch
                placeholder="Search by name, postcode (e.g. KY11), or ODS code…"
                excludeIds={selected}
                clearOnSelect
                onSelect={(p) => {
                  if (selected.includes(p.id)) return;
                  if (selected.length >= MAX_SELECT) return;
                  // Ensure pharmacy exists in local pharms list (it should — fetchAll loads all)
                  setPharms((cur) =>
                    cur.some((x) => x.id === p.id)
                      ? cur
                      : [
                          ...cur,
                          {
                            id: p.id,
                            name: p.name,
                            region: p.region ?? null,
                            country: p.country ?? null,
                            postcode: p.postcode ?? null,
                          },
                        ],
                  );
                  setSelected((cur) => [...cur, p.id]);
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Maximum {MAX_SELECT} pharmacies selected — remove one to add another.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Up to {MAX_SELECT} pharmacies • {selected.length}/{MAX_SELECT} selected
            </p>
          </div>

          <div className="flex-1 flex flex-wrap items-start gap-2 min-h-[36px]">
            {selectedPharms.length === 0 && (
              <span className="text-sm text-muted-foreground self-center">
                Search above and add at least 2 pharmacies to compare.
              </span>
            )}
            {selectedPharms.map((ph) => (
              <span
                key={ph.id}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary pl-3 pr-1 py-1 text-sm max-w-full"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: colorFor(ph.id) }}
                />
                <span className="font-medium truncate max-w-[180px]">{ph.name}</span>
                <CountryBadge country={ph.country} />
                {ph.region && (
                  <span className="text-xs text-muted-foreground truncate max-w-[120px]">{ph.region}</span>
                )}
                <button
                  onClick={() => remove(ph.id)}
                  className="ml-1 rounded-full p-1 hover:bg-background"
                  aria-label="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>

      </div>

      {selectedPharms.length >= 1 && (
        <>
          {/* Headline cards — all metrics per pharmacy */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {headline.map(({ ph, metrics }) => (
              <div
                key={ph.id}
                className="rounded-xl bg-card border border-border p-5 shadow-sm relative overflow-hidden"
                style={{ borderTop: `3px solid ${colorFor(ph.id)}` }}
              >
                <div className="flex items-start gap-2 mb-3">
                  <span
                    className="mt-1 h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ background: colorFor(ph.id) }}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{ph.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{ph.region}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {metrics.map(({ mt, value, diff, pct }) => {
                    const up = diff > 0;
                    const flat = diff === 0;
                    return (
                      <div key={mt.key} className="rounded-md bg-secondary/40 px-2 py-1.5">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{mt.short}</p>
                        <p className="text-base font-semibold tabular-nums leading-tight">{value.toLocaleString()}</p>
                        <div className="mt-0.5 flex items-center gap-0.5 text-[10px]">
                          {flat ? (
                            <Minus className="h-3 w-3 text-muted-foreground" />
                          ) : up ? (
                            <ArrowUpRight className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3 text-rose-600" />
                          )}
                          <span className={flat ? "text-muted-foreground" : up ? "text-emerald-700" : "text-rose-700"}>
                            {flat ? "—" : `${up ? "+" : ""}${pct}%`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {selectedPharms.length >= 2 && (
            <>
              {/* Trend small multiples — one chart per metric */}
              <div className="rounded-xl bg-card border border-border p-6 shadow-sm mb-6">
                <div className="flex items-baseline justify-between mb-4">
                  <h2 className="text-sm font-semibold">24-month trend by service</h2>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {selectedPharms.map((ph) => (
                      <span key={ph.id} className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-3 rounded-sm" style={{ background: colorFor(ph.id) }} />
                        <span className="text-muted-foreground truncate max-w-[120px]">{ph.name}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {trendByMetric.map(({ metric: mt, data }) => (
                    <div key={mt.key}>
                      <p className="text-xs font-medium text-muted-foreground mb-2">{mt.label}</p>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={data} margin={{ top: 5, right: 8, bottom: 0, left: -15 }}>
                            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                            <Tooltip
                              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                              formatter={(v: any, _n: any, ctx: any) => {
                                const ph = pharms.find((p) => p.id === ctx.dataKey);
                                return [Number(v).toLocaleString(), ph?.name ?? ctx.dataKey];
                              }}
                            />
                            {selectedPharms.map((ph) => (
                              <Line
                                key={ph.id}
                                type="monotone"
                                dataKey={ph.id}
                                stroke={colorFor(ph.id)}
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 4 }}
                              />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Side-by-side + Radar */}
              <div className="grid lg:grid-cols-2 gap-6 mb-6">
                <div className="rounded-xl bg-card border border-border p-6 shadow-sm">
                  <h2 className="text-sm font-semibold mb-4">Latest month — every service</h2>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={sideBySide} margin={{ top: 5, right: 12, bottom: 0, left: -10 }}>
                        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                        <XAxis dataKey="metric" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                        <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                        <Tooltip
                          contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                          formatter={(v: any, n: any) => [Number(v).toLocaleString(), pharms.find((p) => p.id === n)?.name ?? n]}
                        />
                        {selectedPharms.map((ph) => (
                          <Bar key={ph.id} dataKey={ph.id} fill={colorFor(ph.id)} radius={[4, 4, 0, 0]} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-xl bg-card border border-border p-6 shadow-sm">
                  <h2 className="text-sm font-semibold mb-4">Performance shape (% of leader per metric)</h2>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radar}>
                        <PolarGrid stroke="var(--border)" />
                        <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                        <PolarRadiusAxis tick={{ fontSize: 10 }} angle={30} domain={[0, 100]} />
                        {selectedPharms.map((ph) => (
                          <Radar
                            key={ph.id}
                            name={ph.name}
                            dataKey={ph.id}
                            stroke={colorFor(ph.id)}
                            fill={colorFor(ph.id)}
                            fillOpacity={0.18}
                          />
                        ))}
                        <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {selectedPharms.length > 1 && latest && (
                <div className="rounded-xl bg-card border border-border shadow-sm p-6 mb-6">
                  <div className="flex items-baseline justify-between mb-4">
                    <h2 className="text-sm font-semibold tracking-tight">Metric leadership · this month</h2>
                    <p className="text-xs text-muted-foreground italic">Who leads, and by how wide a margin.</p>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {METRICS.map((mt) => {
                      const [y, m] = latest.split("-").map(Number);
                      const vals = selectedPharms.map((ph) => {
                        const row = rows.find((r) => r.pharmacy_id === ph.id && r.year === y && r.month === m);
                        return { ph, v: row ? (row[mt.key] as number) : 0 };
                      }).sort((a, b) => b.v - a.v);
                      const leader = vals[0];
                      const runner = vals[1];
                      const margin = runner && runner.v ? Math.round(((leader.v - runner.v) / runner.v) * 100) : null;
                      return (
                        <div key={mt.key} className="border-l-2 pl-3" style={{ borderColor: colorFor(leader.ph.id) }}>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{mt.label}</p>
                          <p className="text-sm font-semibold truncate" title={leader.ph.name}>{leader.ph.name}</p>
                          <p className="text-lg font-bold tabular-nums">{leader.v.toLocaleString()}</p>
                          {runner && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {margin !== null
                                ? `${margin > 0 ? `+${margin}% ahead of` : "tied with"} ${runner.ph.name.split(" ")[0]}`
                                : `vs ${runner.ph.name.split(" ")[0]}`}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}


              {/* Comparison table */}
              <div className="rounded-xl bg-card border border-border shadow-sm overflow-hidden mb-6">
                <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Side-by-side numbers</h2>
                  <span className="text-xs text-muted-foreground">Best per row highlighted</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary text-muted-foreground">
                      <tr>
                        <th className="text-left px-6 py-3 font-medium">Metric</th>
                        {selectedPharms.map((ph) => (
                          <th key={ph.id} className="text-right px-6 py-3 font-medium">
                            <div className="flex items-center justify-end gap-2">
                              <span className="h-2 w-2 rounded-full" style={{ background: colorFor(ph.id) }} />
                              <span className="truncate max-w-[140px]">{ph.name}</span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {METRICS.map((mt) => {
                        const [y, m] = (latest || "0-0").split("-").map(Number);
                        const winnerId = winners[mt.key];
                        return (
                          <tr key={mt.key} className="border-t border-border">
                            <td className="px-6 py-3 font-medium">{mt.label}</td>
                            {selectedPharms.map((ph) => {
                              const row = rows.find((r) => r.pharmacy_id === ph.id && r.year === y && r.month === m);
                              const v = row ? (row[mt.key] as number) : 0;
                              const isWin = ph.id === winnerId && selectedPharms.length > 1;
                              return (
                                <td
                                  key={ph.id}
                                  className={[
                                    "px-6 py-3 text-right tabular-nums",
                                    isWin ? "font-semibold text-foreground" : "text-muted-foreground",
                                  ].join(" ")}
                                >
                                  <div className="inline-flex items-center gap-2 justify-end">
                                    {v.toLocaleString()}
                                    {isWin && <Badge variant="secondary" className="text-[10px] py-0">Best</Badge>}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      <DataAttribution />
    </div>
  );
}

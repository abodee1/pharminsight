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
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  LineChart, Line, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";

export const Route = createFileRoute("/_authenticated/compare")({ component: Compare });

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const METRICS = [
  { key: "items_dispensed", label: "Items dispensed", short: "Items" },
  { key: "nms_count", label: "NMS", short: "NMS" },
  { key: "pharmacy_first_count", label: "Pharmacy First", short: "PF" },
  
  { key: "eps_items", label: "EPS items", short: "EPS" },
] as const;

const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
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
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("items_dispensed");
  

  useEffect(() => {
    (async () => {
      const [p, d] = await Promise.all([
        fetchAll<Pharm>((from, to) =>
          supabase.from("pharmacies").select("id,name,region,country,postcode").order("name").range(from, to)
        ),
        fetchAll<Row>((from, to) =>
          supabase
            .from("dispensing_data")
            .select("pharmacy_id,month,year,items_dispensed,nms_count,pharmacy_first_count,flu_vaccinations,eps_items,eps_nominations")
            .range(from, to)
        ),
      ]);
      setPharms(p);
      setRows(d);

      if (user) {
        const { data: up } = await supabase
          .from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle();
        if (up?.pharmacy_id) setSelected([up.pharmacy_id]);
      }
    })();
  }, [user]);

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

  // Trend data
  const trend = useMemo(() => {
    return periods.map((p) => {
      const [y, m] = p.split("-").map(Number);
      const point: Record<string, any> = { label: `${MONTHS[m - 1]} ${String(y).slice(2)}` };
      selectedPharms.forEach((ph) => {
        const row = rows.find((r) => r.pharmacy_id === ph.id && r.year === y && r.month === m);
        point[ph.id] = row ? (row[metric] as number) : 0;
      });
      return point;
    });
  }, [periods, selectedPharms, rows, metric]);

  // Side-by-side metric data
  const sideBySide = useMemo(() => {
    if (!latest) return [];
    const [y, m] = latest.split("-").map(Number);
    return METRICS.map((mt) => {
      const point: Record<string, any> = { metric: mt.short };
      selectedPharms.forEach((ph) => {
        const row = rows.find((r) => r.pharmacy_id === ph.id && r.year === y && r.month === m);
        point[ph.id] = row ? (row[mt.key] as number) : 0;
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
        return row ? (row[mt.key] as number) : 0;
      });
      const max = Math.max(1, ...vals);
      selectedPharms.forEach((ph, i) => {
        point[ph.id] = Math.round((vals[i] / max) * 100);
      });
      return point;
    });
  }, [latest, selectedPharms, rows]);

  // Headline stats per pharmacy (latest + change)
  const headline = useMemo(() => {
    if (!latest) return [];
    const [ly, lm] = latest.split("-").map(Number);
    const [py, pm] = (prev || "0-0").split("-").map(Number);
    return selectedPharms.map((ph) => {
      const cur = rows.find((r) => r.pharmacy_id === ph.id && r.year === ly && r.month === lm);
      const prv = prev ? rows.find((r) => r.pharmacy_id === ph.id && r.year === py && r.month === pm) : null;
      const v = cur ? (cur[metric] as number) : 0;
      const p = prv ? (prv[metric] as number) : 0;
      const diff = v - p;
      const pct = p ? Math.round((diff / p) * 100) : 0;
      return { ph, value: v, diff, pct };
    });
  }, [latest, prev, selectedPharms, rows, metric]);

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
        const v = row ? (row[mt.key] as number) : 0;
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

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="text-xs text-muted-foreground self-center mr-1">Trend metric:</span>
          {METRICS.map((mt) => (
            <button
              key={mt.key}
              onClick={() => setMetric(mt.key)}
              className={[
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                metric === mt.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {mt.label}
            </button>
          ))}
        </div>
      </div>

      {selectedPharms.length >= 1 && (
        <>
          {/* Headline cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {headline.map(({ ph, value, diff, pct }) => {
              const up = diff > 0;
              const flat = diff === 0;
              return (
                <div key={ph.id} className="rounded-xl bg-card border border-border p-5 shadow-sm relative overflow-hidden">
                  <span
                    className="absolute left-0 top-0 h-full w-1"
                    style={{ background: colorFor(ph.id) }}
                  />
                  <p className="text-xs font-medium text-muted-foreground truncate">{ph.name}</p>
                  <p className="text-xs text-muted-foreground/70 truncate">{ph.region}</p>
                  <p className="mt-3 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
                  <div className="mt-1 flex items-center gap-1 text-xs">
                    {flat ? (
                      <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : up ? (
                      <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <ArrowDownRight className="h-3.5 w-3.5 text-rose-600" />
                    )}
                    <span className={flat ? "text-muted-foreground" : up ? "text-emerald-700" : "text-rose-700"}>
                      {flat ? "no change" : `${up ? "+" : ""}${pct}% vs prior month`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {selectedPharms.length >= 2 && (
            <>
              {/* Trend chart */}
              <div className="rounded-xl bg-card border border-border p-6 shadow-sm mb-6">
                <div className="flex items-baseline justify-between mb-1">
                  <h2 className="text-sm font-semibold">
                    {METRICS.find((m) => m.key === metric)?.label} — 12-month trend
                  </h2>
                  <span className="text-xs text-muted-foreground">Hover to inspect</span>
                </div>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 10, right: 12, bottom: 0, left: -10 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                      <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                      <Tooltip
                        contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                        formatter={(v: any, _n: any, ctx: any) => {
                          const ph = pharms.find((p) => p.id === ctx.dataKey);
                          return [Number(v).toLocaleString(), ph?.name ?? ctx.dataKey];
                        }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 12 }}
                        formatter={(value) => pharms.find((p) => p.id === value)?.name ?? value}
                      />
                      {selectedPharms.map((ph) => (
                        <Line
                          key={ph.id}
                          type="monotone"
                          dataKey={ph.id}
                          stroke={colorFor(ph.id)}
                          strokeWidth={2.5}
                          dot={{ r: 2 }}
                          activeDot={{ r: 5 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
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

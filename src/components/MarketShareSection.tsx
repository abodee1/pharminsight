import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface Props {
  pharmacyId: string;
  pharmacyOds: string;
  pharmacyName: string;
  lat: number | null;
  lng: number | null;
}

const RADIUS_OPTIONS = [
  { label: "1 mile", m: 1609 },
  { label: "2 miles", m: 3218 },
  { label: "5 miles", m: 8047 },
  { label: "10 miles", m: 16093 },
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

type NearbyPharm = { id: string; ods_code: string; name: string; distance_m: number };
type PharmTotals = { id: string; ods_code: string; name: string; totalItems: number; totalNms: number; totalPf: number; share: number; distance_m: number };
type DispensingRow = { pharmacy_id: string; year: number; month: number; items_dispensed: number; nms_count: number; pharmacy_first_count: number };

function fmt(n: number, dp = 1) {
  return n.toFixed(dp);
}

export function MarketShareSection({ pharmacyId, pharmacyOds, pharmacyName, lat, lng }: Props) {
  const [radiusIdx, setRadiusIdx] = useState(1);
  const [loading, setLoading] = useState(false);
  const [nearby, setNearby] = useState<NearbyPharm[]>([]);
  const [shareTimeline, setShareTimeline] = useState<{ label: string; share: number }[]>([]);
  const [leaderboard, setLeaderboard] = useState<PharmTotals[]>([]);
  const [breakdown, setBreakdown] = useState<{ label: string; mine: number }[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const radius = RADIUS_OPTIONS[radiusIdx];

  useEffect(() => {
    if (!lat || !lng) return;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { data: nearbyData, error: nearbyErr } = await supabase.rpc("pharmacies_near", {
          p_lat: lat,
          p_lng: lng,
          p_radius_m: radius.m,
          p_limit: 200,
        });
        if (nearbyErr) throw nearbyErr;

        const nearbyPharms = ((nearbyData ?? []) as NearbyPharm[]).filter(p => p.ods_code !== pharmacyOds);
        setNearby(nearbyPharms);

        const allIds = [pharmacyId, ...nearbyPharms.map(p => p.id)];

        const now = new Date();
        const fromYear = now.getFullYear() - 2;

        const allRows = await fetchAll<DispensingRow>((from, to) =>
          supabase
            .from("dispensing_data")
            .select("pharmacy_id,year,month,items_dispensed,nms_count,pharmacy_first_count")
            .in("pharmacy_id", allIds)
            .gte("year", fromYear)
            .order("year", { ascending: true })
            .order("month", { ascending: true })
            .range(from, to) as any
        );

        // Period-level share
        const byPeriod = new Map<number, { mine: number; total: number }>();
        // Pharmacy-level totals
        const byPharm = new Map<string, { totalItems: number; totalNms: number; totalPf: number }>();

        for (const row of allRows) {
          const key = row.year * 100 + row.month;
          const items = row.items_dispensed ?? 0;

          const p = byPeriod.get(key) ?? { mine: 0, total: 0 };
          p.total += items;
          if (row.pharmacy_id === pharmacyId) p.mine += items;
          byPeriod.set(key, p);

          const ph = byPharm.get(row.pharmacy_id) ?? { totalItems: 0, totalNms: 0, totalPf: 0 };
          ph.totalItems += items;
          ph.totalNms += row.nms_count ?? 0;
          ph.totalPf += row.pharmacy_first_count ?? 0;
          byPharm.set(row.pharmacy_id, ph);
        }

        const timeline = Array.from(byPeriod.entries())
          .sort(([a], [b]) => a - b)
          .slice(-24)
          .map(([key, { mine, total }]) => {
            const year = Math.floor(key / 100);
            const month = key % 100;
            return {
              label: `${MONTHS[month - 1]} ${String(year).slice(2)}`,
              share: total > 0 ? Math.round((mine / total) * 1000) / 10 : 0,
            };
          });
        setShareTimeline(timeline);

        const marketItems = Array.from(byPharm.values()).reduce((s, d) => s + d.totalItems, 0);
        const marketNms = Array.from(byPharm.values()).reduce((s, d) => s + d.totalNms, 0);
        const marketPf = Array.from(byPharm.values()).reduce((s, d) => s + d.totalPf, 0);

        const sorted: PharmTotals[] = Array.from(byPharm.entries()).map(([id, data]) => {
          const info = id === pharmacyId
            ? { ods_code: pharmacyOds, name: pharmacyName, distance_m: 0 }
            : nearbyPharms.find(p => p.id === id) ?? { ods_code: id, name: id, distance_m: 0 };
          return { id, ods_code: info.ods_code, name: info.name, distance_m: info.distance_m, ...data, share: marketItems > 0 ? (data.totalItems / marketItems) * 100 : 0 };
        }).sort((a, b) => b.totalItems - a.totalItems);

        setMyRank((sorted.findIndex(p => p.id === pharmacyId) + 1) || null);
        setLeaderboard(sorted.slice(0, 5));

        const myData = byPharm.get(pharmacyId);
        if (myData) {
          setBreakdown([
            { label: "Items", mine: marketItems > 0 ? myData.totalItems / marketItems * 100 : 0 },
            { label: "NMS", mine: marketNms > 0 ? myData.totalNms / marketNms * 100 : 0 },
            { label: "Pharmacy First", mine: marketPf > 0 ? myData.totalPf / marketPf * 100 : 0 },
          ]);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load market data");
      } finally {
        setLoading(false);
      }
    })();
  }, [lat, lng, pharmacyId, pharmacyOds, pharmacyName, radiusIdx]);

  if (!lat || !lng) {
    return (
      <section className="mt-6 rounded-lg bg-card border border-border shadow-sm px-4 py-3 text-sm text-muted-foreground">
        Market share analysis unavailable — location coordinates not recorded for this pharmacy.
      </section>
    );
  }

  const current = shareTimeline.at(-1)?.share ?? null;
  const prev = shareTimeline.at(-2)?.share ?? null;
  const trend = current !== null && prev !== null ? current - prev : null;

  const summary = current !== null
    ? `${pharmacyName} holds a ${fmt(current)}% share of items dispensed within ${radius.label}` +
      (myRank ? `, ranking #${myRank} of ${nearby.length + 1} pharmacies` : "") +
      (trend !== null
        ? `. Share ${trend > 0.2 ? "grew" : trend < -0.2 ? "declined" : "held steady"} by ${fmt(Math.abs(trend), 2)} pp month-on-month.`
        : ".")
    : null;

  return (
    <section className="mt-6">
      <div className="rounded-lg bg-card border border-border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold">Market share</h2>
          <Select value={String(radiusIdx)} onValueChange={v => setRadiusIdx(Number(v))}>
            <SelectTrigger className="w-32 h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RADIUS_OPTIONS.map((o, i) => (
                <SelectItem key={i} value={String(i)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading && <div className="p-6 text-sm text-muted-foreground animate-pulse">Calculating market share…</div>}
        {error && !loading && <div className="p-4 text-sm text-destructive">{error}</div>}

        {!loading && !error && (
          <div className="p-4 space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-md bg-secondary/40 p-3">
                <p className="text-xs text-muted-foreground">Market share</p>
                <p className="text-xl font-bold mt-1">{current !== null ? `${fmt(current)}%` : "—"}</p>
              </div>
              <div className="rounded-md bg-secondary/40 p-3">
                <p className="text-xs text-muted-foreground">Local rank</p>
                <p className="text-xl font-bold mt-1">
                  {myRank ? `#${myRank}` : "—"}
                  <span className="text-xs font-normal text-muted-foreground ml-1">of {nearby.length + 1}</span>
                </p>
              </div>
              <div className="rounded-md bg-secondary/40 p-3">
                <p className="text-xs text-muted-foreground">MoM trend</p>
                <div className="mt-1 flex items-center gap-1">
                  {trend !== null && trend > 0.2 ? (
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                  ) : trend !== null && trend < -0.2 ? (
                    <TrendingDown className="h-4 w-4 text-red-500" />
                  ) : (
                    <Minus className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-xl font-bold">
                    {trend !== null ? `${trend > 0 ? "+" : ""}${fmt(trend, 2)}pp` : "—"}
                  </span>
                </div>
              </div>
              <div className="rounded-md bg-secondary/40 p-3">
                <p className="text-xs text-muted-foreground">Competitors</p>
                <p className="text-xl font-bold mt-1">{nearby.length}</p>
              </div>
            </div>

            {shareTimeline.length > 1 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">24-month share trend (%)</p>
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={shareTimeline} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 9 }} tickLine={false} domain={["auto", "auto"]} unit="%" />
                    <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, "Share"]} />
                    <Line type="monotone" dataKey="share" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {breakdown.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Share by service type (24-month total)</p>
                <div className="space-y-1.5">
                  {breakdown.map(b => (
                    <div key={b.label} className="flex items-center gap-2 text-xs">
                      <span className="w-24 text-muted-foreground shrink-0">{b.label}</span>
                      <div className="flex-1 h-2 rounded-full bg-secondary relative overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 bg-primary/70 rounded-full"
                          style={{ width: `${Math.min(100, b.mine)}%` }}
                        />
                      </div>
                      <span className="w-12 text-right font-mono tabular-nums shrink-0">{fmt(b.mine)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {leaderboard.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Top-5 pharmacies within {radius.label}</p>
                <div className="space-y-0.5">
                  {leaderboard.map((p, i) => (
                    <div
                      key={p.id}
                      className={`flex items-center gap-2 text-xs rounded px-2 py-1.5 ${
                        p.id === pharmacyId ? "bg-primary/10 font-semibold" : "hover:bg-secondary/60"
                      }`}
                    >
                      <span className="w-4 text-muted-foreground shrink-0">{i + 1}</span>
                      <span className="flex-1 truncate">
                        {p.name}{p.id === pharmacyId ? " ★" : ""}
                      </span>
                      {p.distance_m > 0 && (
                        <span className="font-mono tabular-nums text-muted-foreground shrink-0">
                          {(p.distance_m / 1609).toFixed(1)} mi
                        </span>
                      )}
                      <span className="font-mono tabular-nums w-12 text-right shrink-0">{fmt(p.share)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary && (
              <div className="rounded-md bg-primary/5 border border-primary/20 px-3 py-2 text-xs text-muted-foreground">
                {summary}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

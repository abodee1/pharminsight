import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { pharmacyDisplayName } from "@/lib/pharmacyName";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, Minus, ArrowUpRight } from "lucide-react";

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

type NearbyPharm = { id: string; ods_code: string; name: string; trading_name: string | null; distance_m: number };
type PharmTotals = {
  id: string; ods_code: string; name: string; trading_name: string | null; distance_m: number;
  last12: number; prev12: number; yoyPct: number | null;
  totalNms: number; totalPf: number; share: number;
};
type DispensingRow = { pharmacy_id: string; year: number; month: number; items_dispensed: number; nms_count: number; pharmacy_first_count: number };

function fmtN(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 100_000) return Math.round(n / 1000) + "k";
  if (n >= 10_000) return (n / 1000).toFixed(1) + "k";
  return Math.round(n).toLocaleString();
}
function fmtPct(n: number, dp = 1) { return n.toFixed(dp) + "%"; }
function fmtGbp(n: number) {
  if (n >= 1_000_000) return "£" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return "£" + Math.round(n / 1000) + "k";
  return "£" + Math.round(n).toLocaleString();
}

function YoyBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[10px] text-muted-foreground">—</span>;
  if (Math.abs(pct) < 1) return <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Minus className="h-3 w-3" />Flat</span>;
  return pct > 0
    ? <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5"><TrendingUp className="h-3 w-3" />+{pct.toFixed(0)}%</span>
    : <span className="text-[10px] font-semibold text-red-500 flex items-center gap-0.5"><TrendingDown className="h-3 w-3" />{pct.toFixed(0)}%</span>;
}

export function MarketShareSection({ pharmacyId, pharmacyOds, pharmacyName, lat, lng }: Props) {
  const [radiusIdx, setRadiusIdx] = useState(1);
  const [loading, setLoading] = useState(false);
  const [nearby, setNearby] = useState<NearbyPharm[]>([]);
  const [shareTimeline, setShareTimeline] = useState<{ label: string; share: number; marketTotal: number }[]>([]);
  const [leaderboard, setLeaderboard] = useState<PharmTotals[]>([]);
  const [breakdown, setBreakdown] = useState<{ label: string; mine: number }[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [myLast12, setMyLast12] = useState(0);
  const [myYoy, setMyYoy] = useState<number | null>(null);
  const [marketLast12, setMarketLast12] = useState(0);
  const [marketYoy, setMarketYoy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const radius = RADIUS_OPTIONS[radiusIdx];

  useEffect(() => {
    if (!lat || !lng) return;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { data: nearbyData, error: nearbyErr } = await supabase.rpc("pharmacies_near", {
          p_lat: lat, p_lng: lng, p_radius_m: radius.m, p_limit: 200,
        });
        if (nearbyErr) throw nearbyErr;

        const nearbyPharms = ((nearbyData ?? []) as unknown as NearbyPharm[]).filter(p => p.ods_code !== pharmacyOds);
        setNearby(nearbyPharms);

        const allIds = [pharmacyId, ...nearbyPharms.map(p => p.id)];
        const fromYear = new Date().getFullYear() - 2;

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

        if (allRows.length === 0) { setLoading(false); return; }

        // Find the most recent period across all rows
        const maxKey = Math.max(...allRows.map(r => r.year * 100 + r.month));
        const maxYear = Math.floor(maxKey / 100);
        const maxMonth = maxKey % 100;
        const monthsAgo = (y: number, m: number) => (maxYear - y) * 12 + (maxMonth - m);

        // Per-pharmacy aggregation split into last-12 vs prior-12
        const byPharm = new Map<string, { l12: number; p12: number; lNms: number; lPf: number }>();
        // Period-level for share timeline
        const byPeriod = new Map<number, { mine: number; total: number }>();

        for (const row of allRows) {
          const ago = monthsAgo(row.year, row.month);
          const items = row.items_dispensed ?? 0;
          const key = row.year * 100 + row.month;

          // timeline (all periods, last 24 months)
          if (ago >= 0 && ago < 24) {
            const p = byPeriod.get(key) ?? { mine: 0, total: 0 };
            p.total += items;
            if (row.pharmacy_id === pharmacyId) p.mine += items;
            byPeriod.set(key, p);
          }

          // per-pharmacy split
          const ph = byPharm.get(row.pharmacy_id) ?? { l12: 0, p12: 0, lNms: 0, lPf: 0 };
          if (ago >= 0 && ago < 12) {
            ph.l12 += items;
            ph.lNms += row.nms_count ?? 0;
            ph.lPf += row.pharmacy_first_count ?? 0;
          } else if (ago >= 12 && ago < 24) {
            ph.p12 += items;
          }
          byPharm.set(row.pharmacy_id, ph);
        }

        // Market totals
        const mktL12 = Array.from(byPharm.values()).reduce((s, v) => s + v.l12, 0);
        const mktP12 = Array.from(byPharm.values()).reduce((s, v) => s + v.p12, 0);
        setMarketLast12(mktL12);
        setMarketYoy(mktP12 > 0 ? ((mktL12 - mktP12) / mktP12) * 100 : null);

        // My stats
        const myData = byPharm.get(pharmacyId);
        const mL12 = myData?.l12 ?? 0;
        const mP12 = myData?.p12 ?? 0;
        setMyLast12(mL12);
        setMyYoy(mP12 > 0 ? ((mL12 - mP12) / mP12) * 100 : null);

        // Leaderboard sorted by last 12m items
        const sorted: PharmTotals[] = Array.from(byPharm.entries()).map(([id, data]) => {
          const info = id === pharmacyId
            ? { ods_code: pharmacyOds, name: pharmacyName, trading_name: null as string | null, distance_m: 0 }
            : nearbyPharms.find(p => p.id === id) ?? { ods_code: id, name: id, trading_name: null as string | null, distance_m: 0 };
          const yoyPct = data.p12 > 0 ? ((data.l12 - data.p12) / data.p12) * 100 : null;
          return {
            id, ods_code: info.ods_code, name: info.name, trading_name: info.trading_name, distance_m: info.distance_m,
            last12: data.l12, prev12: data.p12, yoyPct,
            totalNms: data.lNms, totalPf: data.lPf,
            share: mktL12 > 0 ? (data.l12 / mktL12) * 100 : 0,
          };
        }).sort((a, b) => b.last12 - a.last12);

        setMyRank((sorted.findIndex(p => p.id === pharmacyId) + 1) || null);
        setLeaderboard(sorted.slice(0, 8));

        // Service breakdown
        if (myData) {
          const mktNms = Array.from(byPharm.values()).reduce((s, v) => s + v.lNms, 0);
          const mktPf  = Array.from(byPharm.values()).reduce((s, v) => s + v.lPf, 0);
          setBreakdown([
            { label: "Items", mine: mktL12 > 0 ? myData.l12 / mktL12 * 100 : 0 },
            { label: "NMS", mine: mktNms > 0 ? myData.lNms / mktNms * 100 : 0 },
            { label: "Pharmacy First", mine: mktPf > 0 ? myData.lPf / mktPf * 100 : 0 },
          ]);
        }

        // Share timeline
        const timeline = Array.from(byPeriod.entries())
          .sort(([a], [b]) => a - b)
          .map(([key, { mine, total }]) => {
            const year = Math.floor(key / 100);
            const month = key % 100;
            return {
              label: `${MONTHS[month - 1]} '${String(year).slice(2)}`,
              share: total > 0 ? Math.round((mine / total) * 1000) / 10 : 0,
              marketTotal: total,
            };
          });
        setShareTimeline(timeline);

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
        Market share analysis unavailable — location not recorded for this pharmacy.
      </section>
    );
  }

  const currentShare = shareTimeline.at(-1)?.share ?? null;
  const leader = leaderboard[0];
  const isLeader = leader?.id === pharmacyId;
  const gapItems = !isLeader && leader ? Math.max(0, leader.last12 - myLast12) : 0;
  const gapMonthlyItems = Math.round(gapItems / 12);
  const gapMonthlyFee = gapMonthlyItems * 1.27;

  return (
    <section className="mt-6">
      <div className="rounded-lg bg-card border border-border shadow-sm">
        {/* Header */}
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
          <div className="p-4 space-y-6">

            {/* ── Stat cards ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="rounded-lg bg-secondary/40 p-3">
                <p className="text-[11px] text-muted-foreground">Market share</p>
                <p className="text-2xl font-bold tabular-nums mt-1">{currentShare !== null ? fmtPct(currentShare) : "—"}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">of items within {radius.label}</p>
              </div>
              <div className="rounded-lg bg-secondary/40 p-3">
                <p className="text-[11px] text-muted-foreground">Local rank</p>
                <p className="text-2xl font-bold tabular-nums mt-1">
                  {myRank ? `#${myRank}` : "—"}
                  <span className="text-xs font-normal text-muted-foreground ml-1">of {nearby.length + 1}</span>
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">by items dispensed (12m)</p>
              </div>
              <div className="rounded-lg bg-secondary/40 p-3">
                <p className="text-[11px] text-muted-foreground">My items YoY</p>
                <p className="text-2xl font-bold tabular-nums mt-1">{fmtN(myLast12)}</p>
                <div className="mt-0.5"><YoyBadge pct={myYoy} /></div>
              </div>
              <div className="rounded-lg bg-secondary/40 p-3">
                <p className="text-[11px] text-muted-foreground">Market size (12m)</p>
                <p className="text-2xl font-bold tabular-nums mt-1">{fmtN(marketLast12)}</p>
                <div className="mt-0.5"><YoyBadge pct={marketYoy} /></div>
              </div>
              <div className="rounded-lg bg-secondary/40 p-3">
                <p className="text-[11px] text-muted-foreground">Competitors</p>
                <p className="text-2xl font-bold tabular-nums mt-1">{nearby.length}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">within {radius.label}</p>
              </div>
            </div>

            {/* ── Share trend chart ── */}
            {shareTimeline.length > 1 && (
              <div>
                <p className="text-xs font-medium mb-2">My market share — 24-month trend</p>
                <ResponsiveContainer width="100%" height={130}>
                  <AreaChart data={shareTimeline} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="shareGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} domain={["auto", "auto"]} unit="%" />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => [`${v.toFixed(1)}%`, "Share"]}
                    />
                    <Area type="monotone" dataKey="share" stroke="var(--chart-1)" strokeWidth={2} fill="url(#shareGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* ── Service share breakdown ── */}
            {breakdown.some(b => b.mine > 0) && (
              <div>
                <p className="text-xs font-medium mb-2">Share by service type <span className="text-muted-foreground font-normal">(last 12 months)</span></p>
                <div className="space-y-2">
                  {breakdown.map(b => (
                    <div key={b.label} className="flex items-center gap-3 text-xs">
                      <span className="w-24 text-muted-foreground shrink-0">{b.label}</span>
                      <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, b.mine)}%` }} />
                      </div>
                      <span className="w-10 text-right font-mono tabular-nums shrink-0 font-semibold">{fmtPct(b.mine)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Leaderboard ── */}
            {leaderboard.length > 0 && (
              <div>
                <p className="text-xs font-medium mb-2">Local leaderboard <span className="text-muted-foreground font-normal">— ranked by items dispensed (last 12 months)</span></p>
                <div className="rounded-lg border border-border overflow-hidden">
                  {/* Column headers */}
                  <div className="grid grid-cols-[1.5rem_1fr_4.5rem_3.5rem_3.5rem] gap-x-3 px-3 py-2 bg-secondary/40 border-b border-border">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">#</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pharmacy</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">Items (12m)</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">YoY</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">Share</span>
                  </div>

                  {leaderboard.map((p, i) => {
                    const isMe = p.id === pharmacyId;
                    const barW = Math.min(100, p.share / (leaderboard[0]?.share || 1) * 100);
                    return (
                      <div key={p.id}
                        className={`grid grid-cols-[1.5rem_1fr_4.5rem_3.5rem_3.5rem] gap-x-3 px-3 py-2.5 border-b border-border/50 last:border-0 items-center transition-colors ${isMe ? "bg-primary/6" : "hover:bg-secondary/30"}`}
                      >
                        <span className={`text-xs font-bold tabular-nums ${isMe ? "text-primary" : "text-muted-foreground"}`}>{i + 1}</span>

                        <div className="min-w-0">
                          {isMe ? (
                            <p className="text-xs font-semibold text-primary truncate leading-tight">{pharmacyDisplayName(p.name, p.trading_name, p.ods_code)} ★</p>
                          ) : (
                            <Link to="/pharmacy/$odsCode" params={{ odsCode: p.ods_code }}
                              className="text-xs font-medium truncate leading-tight hover:text-primary hover:underline block">
                              {pharmacyDisplayName(p.name, p.trading_name, p.ods_code)}
                            </Link>
                          )}
                          {/* Mini bar */}
                          <div className="mt-1 h-1 rounded-full bg-secondary overflow-hidden">
                            <div className={`h-full rounded-full ${isMe ? "bg-primary" : "bg-primary/40"}`} style={{ width: `${barW}%` }} />
                          </div>
                        </div>

                        <p className={`text-xs tabular-nums text-right font-medium ${isMe ? "text-primary" : ""}`}>{fmtN(p.last12)}</p>

                        <div className="flex justify-end"><YoyBadge pct={p.yoyPct} /></div>

                        <p className={`text-xs tabular-nums text-right font-semibold ${isMe ? "text-primary" : "text-muted-foreground"}`}>{fmtPct(p.share)}</p>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">YoY = last 12m vs prior 12m · click competitor name to view their profile</p>
              </div>
            )}

            {/* ── Market opportunity (only if not #1) ── */}
            {!isLeader && leader && gapItems > 0 && (
              <div className="rounded-lg border border-border bg-secondary/30 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <ArrowUpRight className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold">Market opportunity</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {pharmacyDisplayName(leader.name, leader.trading_name, leader.ods_code)} leads with {fmtN(leader.last12)} items in the last 12 months — {fmtN(gapItems)} more than you.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md bg-card border border-border px-3 py-2.5">
                    <p className="text-[10px] text-muted-foreground">Monthly items gap</p>
                    <p className="text-lg font-bold tabular-nums mt-0.5">{fmtN(gapMonthlyItems)}</p>
                    <p className="text-[10px] text-muted-foreground">items/month behind #1</p>
                  </div>
                  <div className="rounded-md bg-card border border-border px-3 py-2.5">
                    <p className="text-[10px] text-muted-foreground">Est. income at parity</p>
                    <p className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">{fmtGbp(gapMonthlyFee)}</p>
                    <p className="text-[10px] text-muted-foreground">extra/month (dispensing fee only)</p>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">Estimated at £1.27 dispensing fee per item. Does not include drug cost reimbursement or service income.</p>
              </div>
            )}

            {isLeader && (
              <div className="rounded-lg border border-emerald-300/60 bg-emerald-500/5 px-4 py-3 text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-500 shrink-0" />
                <span><span className="font-semibold text-emerald-700 dark:text-emerald-400">{pharmacyName}</span> is the <span className="font-semibold">market leader</span> within {radius.label} by items dispensed over the last 12 months.</span>
              </div>
            )}

          </div>
        )}
      </div>
    </section>
  );
}

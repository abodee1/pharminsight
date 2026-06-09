import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell as RCell } from "recharts";
import { Loader2, Users, Share2, Target, AlertTriangle } from "lucide-react";

type Pharm = { id: string; name: string; ods_code?: string | null; country: string | null };
type LinkRow = { practice_code: string; pharmacy_ods_code: string; year: number; month: number; items_dispensed: number };
type Practice = { practice_code: string; practice_name: string | null; google_name: string | null; postcode: string | null; address_line1: string | null };

const fmtInt = (n: number) => Math.round(n).toLocaleString();
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

export function GpFeederOverlap({
  pharms,
  colorFor,
  monthsWindow = 12,
}: {
  pharms: Pharm[];
  colorFor: (id: string) => string;
  monthsWindow?: number;
}) {
  const [odsByPh, setOdsByPh] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [practices, setPractices] = useState<Record<string, Practice>>({});
  const [loading, setLoading] = useState(true);

  // Resolve ODS codes for selected pharmacies
  useEffect(() => {
    if (pharms.length < 2) return;
    (async () => {
      const ids = pharms.map((p) => p.id);
      const { data } = await supabase.from("pharmacies").select("id,ods_code").in("id", ids);
      const m: Record<string, string> = {};
      (data || []).forEach((r: any) => { if (r.ods_code) m[r.id] = r.ods_code; });
      setOdsByPh(m);
    })();
  }, [pharms]);

  // Load GP linkage rows for those ODS codes (last N months)
  useEffect(() => {
    const ods = Object.values(odsByPh);
    if (ods.length < 2) { setLinks([]); setLoading(false); return; }
    setLoading(true);
    (async () => {
      const now = new Date();
      const cutoff = new Date(now.getFullYear(), now.getMonth() - monthsWindow, 1);
      const data = await fetchAll<LinkRow>((from, to) =>
        supabase
          .from("gp_pharmacy_linkage")
          .select("practice_code,pharmacy_ods_code,year,month,items_dispensed")
          .in("pharmacy_ods_code", ods)
          .gte("year", cutoff.getFullYear())
          .range(from, to)
      );
      // Filter strictly to window
      const filtered = data.filter((r) => {
        const d = new Date(r.year, r.month - 1, 1);
        return d >= cutoff;
      });
      setLinks(filtered);

      // Load practice metadata for involved codes
      const codes = Array.from(new Set(filtered.map((r) => r.practice_code)));
      const out: Record<string, Practice> = {};
      for (let i = 0; i < codes.length; i += 500) {
        const slice = codes.slice(i, i + 500);
        const { data: pr } = await supabase
          .from("gp_practices")
          .select("practice_code,practice_name,google_name,postcode,address_line1")
          .in("practice_code", slice);
        (pr || []).forEach((p: any) => { out[p.practice_code] = p; });
      }
      setPractices(out);
      setLoading(false);
    })();
  }, [odsByPh, monthsWindow]);

  // Build per-pharmacy totals + per-practice splits
  const summary = useMemo(() => {
    const odsToPh = Object.fromEntries(Object.entries(odsByPh).map(([id, ods]) => [ods, id]));
    // totalsPerPh[phId] = total items in window
    const totalsPerPh: Record<string, number> = {};
    pharms.forEach((p) => { totalsPerPh[p.id] = 0; });
    // perPractice[code][phId] = items
    const perPractice: Record<string, Record<string, number>> = {};
    links.forEach((r) => {
      const phId = odsToPh[r.pharmacy_ods_code];
      if (!phId) return;
      totalsPerPh[phId] = (totalsPerPh[phId] || 0) + (r.items_dispensed || 0);
      if (!perPractice[r.practice_code]) perPractice[r.practice_code] = {};
      perPractice[r.practice_code][phId] = (perPractice[r.practice_code][phId] || 0) + (r.items_dispensed || 0);
    });

    // Practice-level rows — only include practices we can confidently name.
    const titleCase = (s: string) =>
      s.toLowerCase().replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
    const rows = Object.entries(perPractice)
      .map(([code, vals]) => {
        const total = Object.values(vals).reduce((s, v) => s + v, 0);
        const phsServed = Object.keys(vals).length;
        const sharePerPh: Record<string, number> = {};
        Object.entries(vals).forEach(([phId, v]) => { sharePerPh[phId] = total > 0 ? (v / total) * 100 : 0; });
        const practiceInfo = practices[code];
        // Prefer the Google-verified name (matches what shows up if you look the practice up on Google);
        // fall back to the official NHS practice name (title-cased).
        const googleName = practiceInfo?.google_name?.trim() || null;
        const officialName = practiceInfo?.practice_name ? titleCase(practiceInfo.practice_name) : null;
        const realName = googleName ?? officialName;
        return {
          code,
          name: realName ?? `GP Practice ${code}`,
          hasName: !!realName,
          postcode: practiceInfo?.postcode || "",
          vals,
          total,
          phsServed,
          sharePerPh,
        };
      });

    // Sort by total items desc
    rows.sort((a, b) => b.total - a.total);

    // Shared = practices serving ≥ 2 selected pharmacies AND non-trivial volume
    // (filter out long tail of one or two scripts that just adds noise).
    const SHARED_MIN_ITEMS = 25;
    const shared = rows.filter((r) => r.phsServed >= 2 && r.total >= SHARED_MIN_ITEMS);

    // Exclusive feeders — only material, named practices
    const EXCLUSIVE_MIN_ITEMS = 30;
    const exclusiveByPh: Record<string, typeof rows> = {};
    pharms.forEach((p) => {
      exclusiveByPh[p.id] = rows
        .filter((r) => r.phsServed === 1 && (r.vals[p.id] || 0) >= EXCLUSIVE_MIN_ITEMS && r.hasName)
        .slice(0, 5);
    });

    // Overlap stats per pharmacy: % of pharmacy's items from shared (material) feeders
    const overlapItems: Record<string, number> = {};
    pharms.forEach((p) => {
      overlapItems[p.id] = shared.reduce((s, r) => s + (r.vals[p.id] || 0), 0);
    });
    const overlapPct: Record<string, number> = {};
    pharms.forEach((p) => {
      const t = totalsPerPh[p.id];
      overlapPct[p.id] = t > 0 ? (overlapItems[p.id] / t) * 100 : 0;
    });

    // Distinct practice counts per pharmacy (material feeders only — ≥3% share OR ≥50 items)
    const distinctPractices: Record<string, number> = {};
    pharms.forEach((p) => {
      const t = totalsPerPh[p.id] || 0;
      distinctPractices[p.id] = rows.filter((r) => {
        const items = r.vals[p.id] || 0;
        const share = t > 0 ? (items / t) * 100 : 0;
        return items > 0 && (share >= 3 || items >= 50);
      }).length;
    });

    // Top feeder concentration: share of pharmacy items from its top feeder
    const topFeederShare: Record<string, { name: string; pct: number } | null> = {};
    // Top N major feeders per pharmacy — strict thresholds, real names only
    const topFeedersPerPh: Record<string, { code: string; name: string; postcode: string; items: number; share: number }[]> = {};
    pharms.forEach((p) => {
      const phRows = rows
        .filter((r) => (r.vals[p.id] || 0) > 0 && r.hasName)
        .map((r) => ({ code: r.code, name: r.name, postcode: r.postcode, items: r.vals[p.id] }));
      phRows.sort((a, b) => b.items - a.items);
      const t = totalsPerPh[p.id] || 0;
      topFeederShare[p.id] = phRows[0] && t > 0 ? { name: phRows[0].name, pct: (phRows[0].items / t) * 100 } : null;
      // Major = top 5 only, must be ≥3% of items OR ≥50 items in window — drop the long tail.
      topFeedersPerPh[p.id] = phRows
        .map((r) => ({ ...r, share: t > 0 ? (r.items / t) * 100 : 0 }))
        .filter((r) => r.share >= 3 || r.items >= 50)
        .slice(0, 5);
    });

    return { rows, shared, exclusiveByPh, totalsPerPh, overlapPct, overlapItems, distinctPractices, topFeederShare, topFeedersPerPh };

  }, [links, odsByPh, pharms, practices]);

  if (pharms.length < 2) return null;

  if (loading) {
    return (
      <div className="rounded-xl bg-card border border-border p-6 shadow-sm mb-6">
        <h2 className="text-sm font-semibold mb-3">GP feeder overlap</h2>
        <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading prescribing linkage…
        </p>
      </div>
    );
  }

  if (summary.rows.length === 0) {
    return (
      <div className="rounded-xl bg-card border border-border p-6 shadow-sm mb-6">
        <h2 className="text-sm font-semibold mb-1">GP feeder overlap</h2>
        <p className="text-xs text-muted-foreground">No GP prescribing linkage data for the selected pharmacies in the last {monthsWindow} months. (Available where NHSBSA practice-level data is published.)</p>
      </div>
    );
  }

  // For the shared-feeder chart, take top 10 by combined items
  const sharedTop = summary.shared.slice(0, 8).map((r) => {
    const row: Record<string, any> = { name: r.name.length > 28 ? r.name.slice(0, 26) + "…" : r.name, full: r.name };
    pharms.forEach((p) => { row[p.id] = r.vals[p.id] || 0; });
    return row;
  });

  return (
    <div className="space-y-4 mb-6">
      {/* Header card with overlap stats */}
      <div className="rounded-xl bg-card border border-border p-5 md:p-6 shadow-sm">
        <div className="flex items-start gap-3 mb-4">
          <div className="rounded-lg bg-secondary p-2 shrink-0"><Share2 className="h-5 w-5" /></div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">GP feeder overlap & catchment</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Which GP practices feed both pharmacies, and where each draws its scripts from. Last {monthsWindow} months.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Shared GP practices" value={summary.shared.length.toString()}
            sub="Material feeders (≥25 items) prescribing to ≥2 of the selected pharmacies"
            icon={<Users className="h-4 w-4" />} tone={summary.shared.length > 5 ? "warn" : "neutral"} />
          <Stat label="Material feeders in cohort" value={Object.values(summary.distinctPractices).reduce((a, b) => Math.max(a, b), 0).toString()}
            sub="Largest count of meaningful GP feeders for any one selected pharmacy"
            icon={<Target className="h-4 w-4" />} />
          {pharms.slice(0, 2).map((p) => (
            <Stat
              key={p.id}
              label={`${p.name.split(" ").slice(0, 2).join(" ")} — overlap`}
              value={fmtPct(summary.overlapPct[p.id])}
              sub={`${fmtInt(summary.overlapItems[p.id])} items from shared feeders`}
              accent={colorFor(p.id)}
              tone={summary.overlapPct[p.id] >= 40 ? "warn" : "neutral"}
            />
          ))}
        </div>

        {/* Strategic interpretation */}
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Competition signal</p>
            <p className="mt-0.5 leading-relaxed">
              {summary.shared.length === 0
                ? "These pharmacies draw from completely distinct GP catchments — they don't compete for the same scripts today."
                : `${summary.shared.length} practice${summary.shared.length === 1 ? "" : "s"} prescribe to both. ${
                    Math.max(...pharms.map((p) => summary.overlapPct[p.id])).toFixed(0)
                  }% of one pharmacy's items come from shared GPs — a script-routing change at a single practice would materially shift volumes.`}
            </p>
          </div>
        </div>
      </div>

      {/* Shared feeders bar chart */}
      {sharedTop.length > 0 && (
        <div className="rounded-xl bg-card border border-border p-5 md:p-6 shadow-sm">
          <h3 className="text-sm font-semibold mb-1">Top shared GP feeders — script split</h3>
          <p className="text-xs text-muted-foreground mb-4">Items per practice, split by where they were dispensed. The width of each bar shows where the GP's scripts actually flow.</p>
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sharedTop} layout="vertical" margin={{ top: 4, right: 20, bottom: 0, left: 10 }} barCategoryGap={8}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={fmtInt} />
                <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" interval={0} />
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any, n: any) => {
                    const ph = pharms.find((p) => p.id === n);
                    return [`${fmtInt(Number(v))} items`, ph?.name ?? n];
                  }}
                  labelFormatter={(_l, payload: any) => payload?.[0]?.payload?.full ?? ""}
                />
                {pharms.map((p) => (
                  <Bar key={p.id} dataKey={p.id} stackId="a" fill={colorFor(p.id)} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Concentration risk per pharmacy */}
      <div className="rounded-xl bg-card border border-border p-5 md:p-6 shadow-sm">
        <h3 className="text-sm font-semibold mb-1">Feeder concentration · top-GP dependency</h3>
        <p className="text-xs text-muted-foreground mb-4">A higher dependency means one GP relationship dominates the script flow — a risk if that practice changes referrals or its list size moves.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {pharms.map((p) => {
            const top = summary.topFeederShare[p.id];
            const distinct = summary.distinctPractices[p.id];
            const tone = top && top.pct >= 40 ? "bad" : top && top.pct >= 25 ? "warn" : "good";
            const toneClass = tone === "bad" ? "border-rose-200 bg-rose-50" : tone === "warn" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50";
            return (
              <div key={p.id} className={`rounded-lg border p-3 ${toneClass}`} style={{ borderLeft: `4px solid ${colorFor(p.id)}` }}>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground truncate">{p.name}</p>
                {top ? (
                  <>
                    <p className="text-xl font-bold tabular-nums mt-1">{fmtPct(top.pct)}</p>
                    <p className="text-[11px] text-foreground/80 truncate" title={top.name}>{top.name}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{distinct} GP feeder{distinct === 1 ? "" : "s"} total</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground mt-1 italic">No linkage data</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Major feeders per pharmacy — top GP practices by name */}
      <div className="rounded-xl bg-card border border-border p-5 md:p-6 shadow-sm">
        <h3 className="text-sm font-semibold mb-1">Major GP feeders · top practices by name</h3>
        <p className="text-xs text-muted-foreground mb-4">The largest prescribing practices feeding each pharmacy over the last {monthsWindow} months. Share = % of that pharmacy's total items.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pharms.map((p) => {
            const feeders = summary.topFeedersPerPh[p.id] || [];
            return (
              <div key={p.id} className="rounded-lg border border-border p-3" style={{ borderTop: `3px solid ${colorFor(p.id)}` }}>
                <div className="flex items-baseline justify-between gap-2 mb-2">
                  <p className="text-sm font-semibold truncate">{p.name}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                    {summary.distinctPractices[p.id]} feeders
                  </p>
                </div>
                {feeders.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No prescribing linkage available.</p>
                ) : (
                  <ul className="space-y-2">
                    {feeders.map((f, i) => (
                      <li key={f.code} className="text-xs">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium truncate min-w-0" title={`${f.name}${f.postcode ? ` · ${f.postcode}` : ""}`}>
                            <span className="inline-block w-4 text-muted-foreground">{i + 1}.</span>
                            {f.name}
                          </span>
                          <span className="tabular-nums font-semibold shrink-0">{fmtPct(f.share)}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(100, f.share)}%`, background: colorFor(p.id) }} />
                          </div>
                          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{fmtInt(f.items)} items</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>


      {/* Exclusive feeders per pharmacy (where each pharmacy has its OWN moat) */}
      <div className="rounded-xl bg-card border border-border p-5 md:p-6 shadow-sm">
        <h3 className="text-sm font-semibold mb-1">Exclusive feeders · each pharmacy's defensible base</h3>
        <p className="text-xs text-muted-foreground mb-4">Top practices that send scripts to only ONE of the selected pharmacies — the moat that is harder for competitors to chip away.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pharms.map((p) => {
            const rows = summary.exclusiveByPh[p.id];
            return (
              <div key={p.id} className="rounded-lg border border-border p-3" style={{ borderTop: `3px solid ${colorFor(p.id)}` }}>
                <p className="text-sm font-semibold truncate mb-2">{p.name}</p>
                {rows.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No exclusive GPs — every feeder is shared with another selected pharmacy.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {rows.map((r) => (
                      <li key={r.code} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate min-w-0" title={r.name}>{r.name}</span>
                        <span className="tabular-nums font-medium shrink-0">{fmtInt(r.vals[p.id] || 0)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label, value, sub, icon, accent, tone = "neutral",
}: {
  label: string; value: string; sub?: string; icon?: React.ReactNode; accent?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "warn" ? "border-amber-200" :
    tone === "bad" ? "border-rose-200" :
    tone === "good" ? "border-emerald-200" : "border-border";
  return (
    <div className={`rounded-lg border bg-secondary/30 p-3 ${toneClass}`} style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}<span className="truncate">{label}</span>
      </div>
      <p className="text-xl font-bold tabular-nums mt-1">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{sub}</p>}
    </div>
  );
}

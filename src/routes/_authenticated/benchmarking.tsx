import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { getLatestSubstantialPeriod } from "@/lib/latestPeriod";
import { PageHeader } from "@/components/PageHeader";
import { DataAttribution } from "@/components/DataAttribution";
import { useAuth } from "@/hooks/useAuth";
import { PercentileRail } from "@/components/Infographics";

export const Route = createFileRoute("/_authenticated/benchmarking")({ component: Benchmarking });

const METRICS = [
  { key: "items_dispensed", label: "Items" },
  { key: "nms_count", label: "NMS" },
  { key: "pharmacy_first_count", label: "Pharmacy First" },
  { key: "eps_nominations", label: "EPS Nom." },
] as const;

function Benchmarking() {
  const { user } = useAuth();
  const [pharmacy, setPharmacy] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [pharms, setPharms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [latest, setLatest] = useState<{ year: number; month: number } | null>(null);

  // 1. Find user's pharmacy + latest period
  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: up } = await supabase.from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle();
      if (up) {
        const { data: ph } = await supabase.from("pharmacies").select("*").eq("id", up.pharmacy_id).maybeSingle();
        setPharmacy(ph);
      }
      const last = await getLatestSubstantialPeriod();
      if (last) setLatest(last);
    })();
  }, [user]);

  // 2. Load only that single period's dispensing + pharmacies for country
  useEffect(() => {
    if (!pharmacy || !latest) return;
    (async () => {
      setLoading(true);
      const [p, d] = await Promise.all([
        fetchAll<any>((from, to) =>
          supabase.from("pharmacies").select("id,name,region,country").eq("country", pharmacy.country).range(from, to)
        ),
        fetchAll<any>((from, to) =>
          supabase
            .from("dispensing_data")
            .select("pharmacy_id,items_dispensed,nms_count,pharmacy_first_count,eps_nominations")
            .eq("year", latest.year)
            .eq("month", latest.month)
            .range(from, to)
        ),
      ]);
      setPharms(p);
      setRows(d);
      setLoading(false);
    })();
  }, [pharmacy, latest]);

  const analysis = useMemo(() => {
    if (!pharmacy || !latest || !rows.length) return null;
    const idsInCountry = new Set(pharms.map((p) => p.id));
    const cur = rows.filter((r) => idsInCountry.has(r.pharmacy_id));
    const mine = cur.find((r) => r.pharmacy_id === pharmacy.id);
    if (!mine) return null;
    const localIds = new Set(pharms.filter((p) => p.region === pharmacy.region).map((p) => p.id));
    const local = cur.filter((r) => localIds.has(r.pharmacy_id));
    const avg = (arr: any[], k: string) => Math.round(arr.reduce((a, r) => a + (r[k] || 0), 0) / Math.max(1, arr.length));
    const top10pct = (k: string) => {
      const sorted = [...cur].sort((a, b) => (b[k] || 0) - (a[k] || 0));
      const n = Math.max(1, Math.ceil(sorted.length * 0.1));
      return Math.round(sorted.slice(0, n).reduce((a, r) => a + (r[k] || 0), 0) / n);
    };

    const data = METRICS.map((m) => ({
      key: m.key,
      label: m.label,
      mine: mine[m.key] || 0,
      local: avg(local, m.key),
      national: avg(cur, m.key),
      top10: top10pct(m.key),
      nationalValues: cur.map((r) => (r[m.key] as number) || 0),
      localValues: local.map((r) => (r[m.key] as number) || 0),
    }));

    return { data };

  }, [pharmacy, latest, rows, pharms]);

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader title="Benchmarking" subtitle="How your pharmacy compares against local and national peers." />

      {!pharmacy && (
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm text-sm">
          You need to set your pharmacy first.{" "}
          <Link to="/settings" className="text-primary font-semibold hover:underline">Go to Settings</Link>
        </div>
      )}

      {pharmacy && loading && (
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm text-sm text-muted-foreground">
          Loading benchmarking data…
        </div>
      )}

      {pharmacy && !loading && !analysis && (
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm text-sm text-muted-foreground">
          No data available for your pharmacy in the latest period.
        </div>
      )}

      {pharmacy && analysis && (
        <>
          <div className="rounded-lg bg-card border border-border p-6 shadow-sm mb-6">
            <p className="text-xs text-muted-foreground">Comparing</p>
            <p className="text-lg font-semibold">{pharmacy.name}</p>
            <p className="text-sm text-muted-foreground">{pharmacy.region} · {pharmacy.country}</p>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="rounded-lg bg-card border border-border p-6 shadow-sm">
              <h2 className="text-sm font-semibold mb-4">Side-by-side comparison</h2>
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium py-2">Metric</th>
                    <th className="text-right font-medium py-2">Mine</th>
                    <th className="text-right font-medium py-2">Local</th>
                    <th className="text-right font-medium py-2">National</th>
                    <th className="text-right font-medium py-2">Top 10%</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.data.map((d) => (
                    <tr key={d.label} className="border-t border-border">
                      <td className="py-2">{d.label}</td>
                      <td className="text-right tabular-nums font-semibold">{d.mine.toLocaleString()}</td>
                      <td className="text-right tabular-nums text-muted-foreground">{d.local.toLocaleString()}</td>
                      <td className="text-right tabular-nums text-muted-foreground">{d.national.toLocaleString()}</td>
                      <td className="text-right tabular-nums text-muted-foreground">{d.top10.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg bg-card border border-border p-6 shadow-sm">
              <h2 className="text-sm font-semibold mb-1">Head-to-head per metric</h2>
              <p className="text-xs text-muted-foreground mb-4">
                Bars scaled against the top 10% in {pharmacy.country}. Longer is better.
              </p>
              <div className="space-y-5">
                {analysis.data.map((d) => {
                  const max = Math.max(d.top10, d.mine, d.local, d.national, 1);
                  const bars = [
                    { name: "You", value: d.mine, color: "var(--cmp-1)" },
                    { name: `${pharmacy.region} avg`, value: d.local, color: "var(--cmp-2)" },
                    { name: `${pharmacy.country} avg`, value: d.national, color: "var(--cmp-3)" },
                  ];
                  return (
                    <div key={d.label}>
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-xs font-semibold">{d.label}</span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Top 10% = {d.top10.toLocaleString()}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {bars.map((b) => (
                          <div key={b.name} className="flex items-center gap-2 text-xs">
                            <span className="w-28 shrink-0 text-muted-foreground truncate">{b.name}</span>
                            <div className="flex-1 h-3 rounded-sm bg-secondary/60 overflow-hidden">
                              <div
                                className="h-full rounded-sm transition-all"
                                style={{ width: `${Math.max(2, (b.value / max) * 100)}%`, background: b.color }}
                              />
                            </div>
                            <span className="w-16 text-right tabular-nums font-medium">{b.value.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-sm font-semibold tracking-tight">
                Where you sit across {pharmacy.region}
              </h2>
              <p className="text-xs text-muted-foreground italic">
                Marker = you. Tick = regional average. Shaded band = middle 50%.
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {analysis.data.map((d) => {
                const diff = d.mine - d.local;
                const pct = Math.round((diff / Math.max(1, d.local)) * 100);
                const caption =
                  Math.abs(pct) < 5
                    ? `In line with ${pharmacy.region} peers — within ±5% of the regional average.`
                    : `${pct >= 0 ? "Outperforming" : "Trailing"} the ${pharmacy.region} average by ${Math.abs(pct)}% this month.`;
                return (
                  <PercentileRail
                    key={d.label}
                    label={`${d.label} · ${pharmacy.region}`}
                    value={d.mine}
                    values={d.localValues.length > 1 ? d.localValues : d.nationalValues}
                    peerLabel={`${pharmacy.region} avg`}
                    nationalLabel="Regional peak"
                    caption={caption}
                  />
                );
              })}
            </div>


            <Link
              to="/insights"
              className="inline-block mt-6 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90"
            >
              Generate Smart Insight for this data
            </Link>
          </div>
        </>
      )}

      <DataAttribution />
    </div>
  );
}

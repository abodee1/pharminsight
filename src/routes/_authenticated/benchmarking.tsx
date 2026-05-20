import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader } from "@/components/PageHeader";
import { DataAttribution } from "@/components/DataAttribution";
import { useAuth } from "@/hooks/useAuth";
import { PercentileRail } from "@/components/Infographics";
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend, Tooltip,
} from "recharts";

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

  useEffect(() => {
    (async () => {
      const [p, d] = await Promise.all([
        fetchAll<any>((from, to) => supabase.from("pharmacies").select("*").range(from, to)),
        fetchAll<any>((from, to) => supabase.from("dispensing_data").select("*").range(from, to)),
      ]);
      setPharms(p);
      setRows(d);
      if (user) {
        const { data: up } = await supabase.from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle();
        if (up) {
          const me = (p || []).find((x: any) => x.id === up.pharmacy_id);
          setPharmacy(me);
        }
      }
    })();
  }, [user]);

  // latest period
  const latest = useMemo(() => {
    const ps = Array.from(new Set(rows.map((r) => `${r.year}-${String(r.month).padStart(2,"0")}`))).sort();
    return ps[ps.length - 1];
  }, [rows]);

  const analysis = useMemo(() => {
    if (!pharmacy || !latest) return null;
    const [y, m] = latest.split("-").map(Number);
    const cur = rows.filter((r) => r.year === y && r.month === m);
    const mine = cur.find((r) => r.pharmacy_id === pharmacy.id);
    if (!mine) return null;
    const local = cur.filter((r) => {
      const ph = pharms.find((p) => p.id === r.pharmacy_id);
      return ph?.region === pharmacy.region;
    });
    const avg = (arr: any[], k: string) => Math.round(arr.reduce((a, r) => a + r[k], 0) / Math.max(1, arr.length));
    const top10pct = (k: string) => {
      const sorted = [...cur].sort((a, b) => b[k] - a[k]);
      const n = Math.max(1, Math.ceil(sorted.length * 0.1));
      return Math.round(sorted.slice(0, n).reduce((a, r) => a + r[k], 0) / n);
    };

    const data = METRICS.map((m) => ({
      key: m.key,
      label: m.label,
      mine: mine[m.key] || 0,
      local: avg(local, m.key),
      national: avg(cur, m.key),
      top10: top10pct(m.key),
      nationalValues: cur.map((r) => r[m.key] as number),
      localValues: local.map((r) => r[m.key] as number),
    }));

    // Normalize radar to 0-100 vs top10
    const radar = data.map((d) => ({
      metric: d.label,
      Mine: Math.round((d.mine / Math.max(1, d.top10)) * 100),
      Local: Math.round((d.local / Math.max(1, d.top10)) * 100),
      National: Math.round((d.national / Math.max(1, d.top10)) * 100),
    }));

    return { data, radar };
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
              <h2 className="text-sm font-semibold mb-4">Performance shape (% of top 10%)</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={analysis.radar}>
                    <PolarGrid stroke="var(--border)" />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                    <PolarRadiusAxis tick={{ fontSize: 10 }} angle={30} />
                    <Radar name="Mine" dataKey="Mine" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.5} />
                    <Radar name="Local" dataKey="Local" stroke="var(--chart-3)" fill="var(--chart-3)" fillOpacity={0.2} />
                    <Radar name="National" dataKey="National" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.15} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-lg bg-card border border-border p-6 shadow-sm">
            <h2 className="text-sm font-semibold mb-3">Gap analysis</h2>
            <div className="space-y-2 text-sm">
              {analysis.data.map((d) => {
                const diff = d.mine - d.national;
                const pct = Math.round((diff / Math.max(1, d.national)) * 100);
                const above = diff >= 0;
                return (
                  <p key={d.label}>
                    <span className="font-medium">{d.label}:</span>{" "}
                    <span className={above ? "text-emerald-700" : "text-rose-700"}>
                      {above ? "Above" : "Below"} national average by {Math.abs(pct)}%
                    </span>{" "}
                    <span className="text-muted-foreground">
                      ({d.mine.toLocaleString()} vs {d.national.toLocaleString()})
                    </span>
                  </p>
                );
              })}
            </div>
            <Link
              to="/insights"
              className="inline-block mt-4 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90"
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

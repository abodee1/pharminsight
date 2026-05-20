import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader } from "@/components/PageHeader";
import { DataAttribution } from "@/components/DataAttribution";
import { useAuth } from "@/hooks/useAuth";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { DistributionStrip } from "@/components/Infographics";

export const Route = createFileRoute("/_authenticated/leaderboards")({ component: Leaderboards });

const COUNTRIES = ["England", "Scotland", "Wales", "Northern Ireland"] as const;
const SERVICES = [
  { key: "items_dispensed", label: "Items" },
  { key: "pharmacy_first_count", label: "Pharmacy First" },
  { key: "nms_count", label: "NMS" },
  
  { key: "eps_items", label: "EPS Items" },
] as const;

type Row = {
  pharmacy_id: string; month: number; year: number;
  items_dispensed: number; nms_count: number; pharmacy_first_count: number; flu_vaccinations: number; eps_items: number;
};
type Pharm = { id: string; name: string; region: string | null; country: string | null; postcode: string | null };

function Leaderboards() {
  const { user } = useAuth();
  const [country, setCountry] = useState<(typeof COUNTRIES)[number]>("England");
  const [service, setService] = useState<(typeof SERVICES)[number]["key"]>("items_dispensed");
  const [region, setRegion] = useState<string>("all");
  const [period, setPeriod] = useState<string>("");
  const [page, setPage] = useState(0);

  const [pharms, setPharms] = useState<Pharm[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [myPharmId, setMyPharmId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [p, d] = await Promise.all([
        fetchAll<Pharm>((from, to) =>
          supabase.from("pharmacies").select("id,name,region,country,postcode").range(from, to)
        ),
        fetchAll<Row>((from, to) =>
          supabase
            .from("dispensing_data")
            .select("pharmacy_id,month,year,items_dispensed,nms_count,pharmacy_first_count,flu_vaccinations,eps_items")
            .range(from, to)
        ),
      ]);
      setPharms(p);
      setRows(d);
      const periods = Array.from(new Set(d.map((r) => `${r.year}-${String(r.month).padStart(2,"0")}`))).sort();
      setPeriod(periods[periods.length - 1] || "");
      if (user) {
        const { data: up } = await supabase.from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle();
        setMyPharmId(up?.pharmacy_id ?? null);
      }
    })();
  }, [user]);

  const periods = useMemo(
    () => Array.from(new Set(rows.map((r) => `${r.year}-${String(r.month).padStart(2,"0")}`))).sort().reverse(),
    [rows]
  );

  const regions = useMemo(() => {
    const inCountry = pharms.filter((p) => p.country === country);
    return Array.from(new Set(inCountry.map((p) => p.region).filter(Boolean))) as string[];
  }, [pharms, country]);

  const [py, pm] = (period || "0-0").split("-").map(Number);
  const prevPeriodKey = useMemo(() => {
    const idx = periods.indexOf(period);
    return periods[idx + 1] || null;
  }, [periods, period]);

  const board = useMemo(() => {
    const inCountry = pharms.filter((p) => p.country === country && (region === "all" || p.region === region));
    const idSet = new Set(inCountry.map((p) => p.id));
    const cur = rows.filter((r) => r.year === py && r.month === pm && idSet.has(r.pharmacy_id));
    const prev = prevPeriodKey
      ? rows.filter((r) => {
          const [yy, mm] = prevPeriodKey.split("-").map(Number);
          return r.year === yy && r.month === mm && idSet.has(r.pharmacy_id);
        })
      : [];
    const prevMap = new Map(prev.map((r) => [r.pharmacy_id, r[service]]));
    return cur
      .map((r) => {
        const ph = pharms.find((p) => p.id === r.pharmacy_id)!;
        const prevVal = prevMap.get(r.pharmacy_id) ?? 0;
        const change = (r[service] as number) - prevVal;
        return { ph, value: r[service] as number, change };
      })
      .sort((a, b) => b.value - a.value)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [pharms, rows, country, region, py, pm, service, prevPeriodKey]);

  const top10 = board.slice(0, 10).map((r) => ({ name: r.ph.name.replace(" Pharmacy", ""), value: r.value }));
  const pageSize = 25;
  const pageRows = board.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader title="Leaderboards" subtitle="Rank pharmacies across the UK by service." />

      <div className="flex gap-1 border-b border-border mb-4">
        {COUNTRIES.map((c) => (
          <button
            key={c}
            onClick={() => { setCountry(c); setRegion("all"); setPage(0); }}
            className={[
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              country === c
                ? "border-gold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <select value={service} onChange={(e) => setService(e.target.value as any)} className="rounded-md border border-input bg-card px-3 py-2 text-sm">
          {SERVICES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={region} onChange={(e) => { setRegion(e.target.value); setPage(0); }} className="rounded-md border border-input bg-card px-3 py-2 text-sm">
          <option value="all">All {country === "Scotland" ? "Health Boards" : "ICBs"}</option>
          {regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-md border border-input bg-card px-3 py-2 text-sm">
          {periods.map((p) => {
            const [y, m] = p.split("-").map(Number);
            return <option key={p} value={p}>{new Date(y, m - 1).toLocaleString("en-GB", { month: "long", year: "numeric" })}</option>;
          })}
        </select>
      </div>

      <div className="rounded-lg bg-card border border-border p-5 shadow-sm mb-4">
        <h2 className="text-sm font-semibold mb-3">Top 10</h2>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={top10} margin={{ top: 5, right: 12, left: -10, bottom: 30 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" interval={0} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
              <Bar dataKey="value" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mb-4">
        <DistributionStrip
          label={`Distribution · ${SERVICES.find((s) => s.key === service)?.label} across ${country}${region !== "all" ? ` · ${region}` : ""}`}
          values={board.map((r) => r.value)}
          highlightValue={myPharmId ? board.find((r) => r.ph.id === myPharmId)?.value : undefined}
          highlightLabel="Your pharmacy"
          caption="Each bar is a slice of the cohort. The taller the bar, the more pharmacies cluster at that volume. The dark bar marks where the leading pharmacies sit, your own pharmacy is highlighted if it appears in this view."
        />
      </div>

      <div className="rounded-lg bg-card border border-border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">#</th>
              <th className="text-left px-4 py-2 font-medium">Pharmacy</th>
              <th className="text-left px-4 py-2 font-medium">{country === "Scotland" ? "Health Board" : "ICB"}</th>
              <th className="text-right px-4 py-2 font-medium">Count</th>
              <th className="text-right px-4 py-2 font-medium">vs prior</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const isMine = r.ph.id === myPharmId;
              return (
                <tr key={r.ph.id} className={isMine ? "bg-gold/15" : "border-t border-border"}>
                  <td className="px-4 py-2 font-semibold">{r.rank}</td>
                  <td className="px-4 py-2">{r.ph.name}{isMine && <span className="ml-2 text-xs text-gold font-semibold">YOU</span>}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.ph.region}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.value.toLocaleString()}</td>
                  <td className={["px-4 py-2 text-right tabular-nums", r.change >= 0 ? "text-emerald-600" : "text-rose-600"].join(" ")}>
                    {r.change >= 0 ? "↑" : "↓"} {Math.abs(r.change).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex justify-between items-center px-4 py-3 text-xs text-muted-foreground border-t border-border">
          <span>Page {page + 1} of {Math.max(1, Math.ceil(board.length / pageSize))}</span>
          <div className="flex gap-2">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded border border-border px-3 py-1 disabled:opacity-40">Prev</button>
            <button disabled={(page + 1) * pageSize >= board.length} onClick={() => setPage((p) => p + 1)} className="rounded border border-border px-3 py-1 disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>

      <DataAttribution />
    </div>
  );
}

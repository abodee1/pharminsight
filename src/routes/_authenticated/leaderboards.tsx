import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { getLatestSubstantialPeriod } from "@/lib/latestPeriod";
import { PageHeader } from "@/components/PageHeader";
import { DataAttribution } from "@/components/DataAttribution";
import { useAuth } from "@/hooks/useAuth";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";
import { DistributionStrip } from "@/components/Infographics";

export const Route = createFileRoute("/_authenticated/leaderboards")({ component: Leaderboards });

const COUNTRIES = ["England", "Scotland", "Wales", "Northern Ireland"] as const;
const SERVICES = [
  { key: "items_dispensed", label: "Items" },
  { key: "pharmacy_first_count", label: "Pharmacy First" },
  { key: "nms_count", label: "NMS" },
  { key: "eps_items", label: "EPS Items" },
] as const;

type SortCol = "rank" | "count" | "change";
type SortDir = "asc" | "desc";

type Row = {
  pharmacy_id: string; month: number; year: number;
  items_dispensed: number; nms_count: number; pharmacy_first_count: number; flu_vaccinations: number; eps_items: number;
};
type Pharm = { id: string; name: string; region: string | null; country: string | null; postcode: string | null };

function prevPeriod(y: number, m: number): { year: number; month: number } {
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}

function downloadCsv(
  rows: Array<{ rank: number; name: string; region: string | null; value: number; change: number | null; isNew: boolean }>,
  service: string,
  period: string,
) {
  const label = SERVICES.find((s) => s.key === service)?.label ?? service;
  const header = ["Rank", "Pharmacy", "Region", label, "vs Prior Month"];
  const lines = rows.map((r) =>
    [
      r.rank,
      `"${r.name.replace(/"/g, '""')}"`,
      `"${(r.region ?? "").replace(/"/g, '""')}"`,
      r.value,
      r.isNew ? "New" : r.change === 0 ? "—" : r.change,
    ].join(","),
  );
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leaderboard-${service}-${period}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Leaderboards() {
  const { user } = useAuth();
  const [country, setCountry] = useState<(typeof COUNTRIES)[number]>("England");
  const [service, setService] = useState<(typeof SERVICES)[number]["key"]>("items_dispensed");
  const [region, setRegion] = useState<string>("all");
  const [period, setPeriod] = useState<string>("");
  const [periods, setPeriods] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [pharms, setPharms] = useState<Pharm[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [myPharmId, setMyPharmId] = useState<string | null>(null);

  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [pData, last, upData] = await Promise.all([
        fetchAll<Pharm>((from, to) =>
          supabase.from("pharmacies").select("id,name,region,country,postcode").eq("country", country).range(from, to)
        ),
        getLatestSubstantialPeriod(),
        user ? supabase.from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      setPharms(pData);
      setMyPharmId((upData as any)?.data?.pharmacy_id ?? null);

      if (last) {
        const list: string[] = [];
        let y = last.year, m = last.month;
        for (let i = 0; i < 36; i++) {
          list.push(`${y}-${String(m).padStart(2, "0")}`);
          ({ year: y, month: m } = prevPeriod(y, m));
        }
        setPeriods(list);
        if (!period) setPeriod(list[0]);
      }
      setLoading(false);
    })();
  }, [country, user]);

  useEffect(() => {
    if (!period) return;
    const [y, m] = period.split("-").map(Number);
    const prev = prevPeriod(y, m);
    (async () => {
      setLoading(true);
      const data = await fetchAll<Row>((from, to) =>
        supabase
          .from("dispensing_data")
          .select("pharmacy_id,month,year,items_dispensed,nms_count,pharmacy_first_count,flu_vaccinations,eps_items")
          .or(`and(year.eq.${y},month.eq.${m}),and(year.eq.${prev.year},month.eq.${prev.month})`)
          .range(from, to)
      );
      setRows(data);
      setLoading(false);
    })();
  }, [period]);

  const regions = useMemo(() => {
    return Array.from(new Set(pharms.map((p) => p.region).filter(Boolean))) as string[];
  }, [pharms]);

  const [py, pm] = (period || "0-0").split("-").map(Number);

  const board = useMemo(() => {
    const inCountry = pharms.filter((p) => region === "all" || p.region === region);
    const idSet = new Set(inCountry.map((p) => p.id));
    const cur = rows.filter((r) => r.year === py && r.month === pm && idSet.has(r.pharmacy_id));
    const prev = prevPeriod(py, pm);
    const prevRows = rows.filter((r) => r.year === prev.year && r.month === prev.month && idSet.has(r.pharmacy_id));
    const prevMap = new Map(prevRows.map((r) => [r.pharmacy_id, r[service] as number]));
    return cur
      .map((r) => {
        const ph = pharms.find((p) => p.id === r.pharmacy_id)!;
        const hasPrev = prevMap.has(r.pharmacy_id);
        const prevVal = prevMap.get(r.pharmacy_id) ?? 0;
        const change = hasPrev ? (r[service] as number) - prevVal : null;
        return { ph, value: r[service] as number, change, isNew: !hasPrev };
      })
      .filter((r) => r.ph)
      .sort((a, b) => b.value - a.value)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [pharms, rows, region, py, pm, service]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const base = q
      ? board.filter((r) => r.ph.name.toLowerCase().includes(q) || (r.ph.region ?? "").toLowerCase().includes(q))
      : board;
    if (sortCol === "rank") return sortDir === "asc" ? base : [...base].reverse();
    return [...base].sort((a, b) => {
      const diff = sortCol === "count" ? a.value - b.value : (a.change ?? 0) - (b.change ?? 0);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [board, search, sortCol, sortDir]);

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir(col === "rank" ? "asc" : "desc"); }
    setPage(0);
  }

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const top10 = board.slice(0, 10).map((r) => ({
    name: r.ph.name.replace(/ Pharmacy$/i, "").replace(/ Chemists?$/i, ""),
    value: r.value,
    isMe: r.ph.id === myPharmId,
  }));

  const myEntry = myPharmId ? board.find((r) => r.ph.id === myPharmId) : null;

  function jumpToMe() {
    if (!myEntry) return;
    setSortCol("rank");
    setSortDir("asc");
    setSearch("");
    setPage(Math.floor((myEntry.rank - 1) / pageSize));
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function sortIcon(col: SortCol) {
    if (sortCol !== col) return <span className="text-muted-foreground/40 ml-0.5">↕</span>;
    return <span className="ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  const nmsUnavailable = service === "nms_count" && country === "Scotland";

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader title="Leaderboards" subtitle="Rank pharmacies across the UK by service." />

      <div className="flex gap-1 border-b border-border mb-4">
        {COUNTRIES.map((c) => (
          <button
            key={c}
            onClick={() => { setCountry(c); setRegion("all"); setPage(0); setSearch(""); }}
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
        <select value={service} onChange={(e) => { setService(e.target.value as any); setPage(0); }} className="rounded-md border border-input bg-card px-3 py-2 text-sm">
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
        {loading && <span className="text-xs text-muted-foreground self-center">Loading…</span>}
      </div>

      {nmsUnavailable && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-300">
          NMS (New Medicines Service) is not commissioned in Scotland — all values will be zero.
        </div>
      )}

      <div className="rounded-lg bg-card border border-border p-5 shadow-sm mb-4">
        <h2 className="text-sm font-semibold mb-3">Top 10</h2>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={top10} margin={{ top: 5, right: 12, left: -10, bottom: 48 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {top10.map((entry, i) => (
                  <Cell key={i} fill={entry.isMe ? "var(--gold, #d4a007)" : "var(--chart-2)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {top10.some((e) => e.isMe) && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-sm bg-gold mr-1.5 align-middle" />
            Your pharmacy
          </p>
        )}
      </div>

      <div className="mb-4">
        <DistributionStrip
          label={`Distribution · ${SERVICES.find((s) => s.key === service)?.label} across ${country}${region !== "all" ? ` · ${region}` : ""}`}
          values={board.map((r) => r.value)}
          highlightValue={myPharmId ? board.find((r) => r.ph.id === myPharmId)?.value : undefined}
          highlightLabel="Your pharmacy"
          caption="Volume distribution across the cohort. Your pharmacy is highlighted in dark."
        />
      </div>

      <div ref={tableRef} className="rounded-lg bg-card border border-border shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border">
          <input
            type="search"
            placeholder="Search pharmacy or region…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="flex-1 min-w-48 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
          <div className="flex items-center gap-2 ml-auto">
            {myEntry && (
              <button
                onClick={jumpToMe}
                className="rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs font-medium hover:bg-secondary transition-colors"
              >
                Jump to my pharmacy (#{myEntry.rank})
              </button>
            )}
            <button
              onClick={() =>
                downloadCsv(
                  filtered.map((r) => ({ rank: r.rank, name: r.ph.name, region: r.ph.region, value: r.value, change: r.change, isNew: r.isNew })),
                  service,
                  period,
                )
              }
              className="rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs font-medium hover:bg-secondary transition-colors"
            >
              Export CSV
            </button>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-secondary text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">
                <button onClick={() => toggleSort("rank")} className="hover:text-foreground transition-colors">
                  # {sortIcon("rank")}
                </button>
              </th>
              <th className="text-left px-4 py-2 font-medium">Pharmacy</th>
              <th className="text-left px-4 py-2 font-medium">{country === "Scotland" ? "Health Board" : "ICB"}</th>
              <th className="text-right px-4 py-2 font-medium">
                <button onClick={() => toggleSort("count")} className="hover:text-foreground transition-colors">
                  Count {sortIcon("count")}
                </button>
              </th>
              <th className="text-right px-4 py-2 font-medium">
                <button onClick={() => toggleSort("change")} className="hover:text-foreground transition-colors">
                  vs prior {sortIcon("change")}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  No pharmacies match your filters.
                </td>
              </tr>
            )}
            {pageRows.map((r) => {
              const isMine = r.ph.id === myPharmId;
              const pct = board.length > 1 ? Math.round((1 - (r.rank - 1) / board.length) * 100) : null;
              return (
                <tr key={r.ph.id} className={isMine ? "bg-gold/15" : "border-t border-border"}>
                  <td className="px-4 py-2 font-semibold tabular-nums">
                    {r.rank}
                    {pct !== null && (
                      <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">Top {pct}%</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {r.ph.name}
                    {isMine && <span className="ml-2 text-xs text-gold font-semibold">YOU</span>}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{r.ph.region}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.value.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.isNew ? (
                      <span className="text-muted-foreground text-xs">new</span>
                    ) : r.change === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={r.change! > 0 ? "text-emerald-600" : "text-rose-600"}>
                        {r.change! > 0 ? "↑" : "↓"} {Math.abs(r.change!).toLocaleString()}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!loading && (
          <div className="flex justify-between items-center px-4 py-3 text-xs text-muted-foreground border-t border-border">
            <span>
              {filtered.length.toLocaleString()} pharmacies
              {search ? ` matching "${search}"` : ""}
              {" · "}Page {page + 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded border border-border px-3 py-1 disabled:opacity-40">Prev</button>
              <button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border border-border px-3 py-1 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>

      <DataAttribution />
    </div>
  );
}

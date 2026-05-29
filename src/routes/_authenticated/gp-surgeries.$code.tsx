import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  AreaChart, Area,
} from "recharts";
import { Loader2, Stethoscope, ArrowLeft, Users, FileText, PoundSterling, TrendingUp, TrendingDown, Minus, MapPin } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/gp-surgeries/$code")({
  head: () => ({ meta: [{ title: "GP Practice analytics — PharmInsight" }] }),
  component: GPPracticePage,
});

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
type Practice = { practice_code: string; practice_name: string | null; google_name: string | null; name_verified_at: string | null; country: string | null; health_board: string | null; postcode: string | null };

type Prescribing = { year: number; month: number; total_items: number; total_nic: number; is_provisional: boolean };
type ListSize = { list_size_date: string; registered_patients: number };

type WindowKey = 1 | 3 | 6 | 12;

function GPPracticePage() {
  const { code } = Route.useParams();
  const [practice, setPractice] = useState<Practice | null>(null);
  const [prescribing, setPrescribing] = useState<Prescribing[]>([]);
  const [listSizes, setListSizes] = useState<ListSize[]>([]);
  const [loading, setLoading] = useState(true);
  const [win, setWin] = useState<WindowKey>(12);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: prac }, { data: presc }, { data: ls }] = await Promise.all([
        supabase.from("gp_practices").select("practice_code,practice_name,google_name,name_verified_at,country,health_board,postcode").eq("practice_code", code).maybeSingle(),
        supabase.from("gp_prescribing").select("year,month,total_items,total_nic,is_provisional").eq("practice_code", code).order("year").order("month"),
        supabase.from("gp_list_sizes").select("list_size_date,registered_patients").eq("practice_code", code).order("list_size_date"),
      ]);

      if (cancelled) return;
      setPractice((prac as Practice) ?? null);
      setPrescribing((presc as Prescribing[]) ?? []);
      setListSizes((ls as ListSize[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [code]);

  const sortedPx = useMemo(() => prescribing.slice(), [prescribing]);
  const latest = sortedPx[sortedPx.length - 1];
  const latestList = listSizes[listSizes.length - 1];

  // Trailing window helpers — sum the last N months of prescribing, plus the
  // immediately-prior N months and the same N months one year earlier.
  const trailing = useMemo(() => {
    if (sortedPx.length === 0) return null;
    const tail = sortedPx.slice(-win);
    const prior = sortedPx.slice(-win * 2, -win);
    const yoyStart = sortedPx.length - win - 12;
    const yoy = yoyStart >= 0 ? sortedPx.slice(yoyStart, yoyStart + win) : [];
    const sum = (arr: Prescribing[], k: "total_items" | "total_nic") =>
      arr.reduce((acc, r) => acc + (Number(r[k]) || 0), 0);
    return {
      items: sum(tail, "total_items"),
      nic: sum(tail, "total_nic"),
      itemsPrior: sum(prior, "total_items"),
      nicPrior: sum(prior, "total_nic"),
      itemsYoY: sum(yoy, "total_items"),
      nicYoY: sum(yoy, "total_nic"),
      from: tail[0],
      to: tail[tail.length - 1],
      months: tail.length,
    };
  }, [sortedPx, win]);

  const chartData = sortedPx.slice(-36).map((r) => ({
    label: `${MONTHS[r.month - 1]} ${String(r.year).slice(2)}`,
    items: Number(r.total_items) || 0,
    nic: Number(r.total_nic) || 0,
  }));
  const listChart = listSizes.slice(-20).map((r) => ({
    label: r.list_size_date,
    patients: Number(r.registered_patients) || 0,
  }));

  const itemsPerPatient = trailing && latestList?.registered_patients
    ? trailing.items / latestList.registered_patients
    : null;
  const costPerItem = trailing && trailing.items
    ? trailing.nic / trailing.items
    : null;
  const spendPerPatient = trailing && latestList?.registered_patients
    ? trailing.nic / latestList.registered_patients
    : null;

  // Trend on registered patient list over the last ~year (4 quarterly points).
  const listTrend = useMemo(() => {
    if (listSizes.length < 2) return null;
    const latest = listSizes[listSizes.length - 1].registered_patients;
    const prior = listSizes[Math.max(0, listSizes.length - 5)].registered_patients;
    if (!prior) return null;
    return ((latest - prior) / prior) * 100;
  }, [listSizes]);

  if (loading) return <div className="p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 inline animate-spin mr-2" />Loading practice analytics…</div>;
  if (!practice) return (
    <div className="p-10 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold">Practice not found</h1>
      <p className="text-sm text-muted-foreground mt-2">No practice with code <span className="font-mono">{code}</span>.</p>
      <Link to="/gp-surgeries" className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="h-4 w-4" /> All surgeries</Link>
    </div>
  );
  // Prefer the Google-verified name when present; otherwise pretty-case the NHS source name.
  const prettyName = practice.google_name
    || (practice.practice_name || practice.practice_code).replace(
      /\w\S*/g,
      (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    );
  const subtitleParts = [practice.postcode, practice.health_board, practice.country].filter(Boolean) as string[];
  if (practice.name_verified_at) subtitleParts.push("✓ Verified by Google Maps");

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <Link to="/gp-surgeries" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground mb-3">
        <ArrowLeft className="h-4 w-4" /> All surgeries
      </Link>
      <PageHeader
        title={prettyName}
        subtitle={subtitleParts.join(" · ")}
        showBack={false}
      />



      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <p className="text-xs text-muted-foreground italic">
          Trailing totals over the selected window.
          {trailing && ` ${MONTHS[trailing.from.month - 1]} ${trailing.from.year} – ${MONTHS[trailing.to.month - 1]} ${trailing.to.year}.`}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Window</span>
          <Select value={String(win)} onValueChange={(v) => setWin(Number(v) as WindowKey)}>
            <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 month</SelectItem>
              <SelectItem value="3">3 months</SelectItem>
              <SelectItem value="6">6 months</SelectItem>
              <SelectItem value="12">12 months</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat icon={FileText} label={`Items · last ${win}mo`} value={trailing ? Math.round(trailing.items).toLocaleString() : "—"} delta={trailing ? pctDelta(trailing.items, trailing.itemsPrior) : null} yoy={trailing ? pctDelta(trailing.items, trailing.itemsYoY) : null} />
        <Stat icon={PoundSterling} label={`NIC £ · last ${win}mo`} value={trailing ? "£" + Math.round(trailing.nic).toLocaleString() : "—"} delta={trailing ? pctDelta(trailing.nic, trailing.nicPrior) : null} yoy={trailing ? pctDelta(trailing.nic, trailing.nicYoY) : null} />
        <Stat icon={Users} label="Registered patients" value={latestList && latestList.registered_patients ? latestList.registered_patients.toLocaleString() : "—"} sub={latestList && latestList.registered_patients ? `as of ${latestList.list_size_date}` : undefined} delta={listTrend} />
        <Stat icon={TrendingUp} label="Items per patient" value={itemsPerPatient ? itemsPerPatient.toFixed(1) : "—"} sub={itemsPerPatient ? `over last ${win}mo` : undefined} />
        <Stat icon={PoundSterling} label="Avg cost / item" value={costPerItem ? "£" + costPerItem.toFixed(2) : "—"} sub={costPerItem ? `over last ${win}mo` : undefined} />
        <Stat icon={PoundSterling} label="Spend / patient" value={spendPerPatient ? "£" + spendPerPatient.toFixed(0) : "—"} sub={spendPerPatient ? `over last ${win}mo` : undefined} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <Card title="Monthly prescribed items — last 36 months">
          {chartData.length > 1 ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
                  <Area type="monotone" dataKey="items" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.18} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty />}
        </Card>
        <Card title="NIC £ — last 36 months">
          {chartData.length > 1 ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} formatter={(v: number) => `£${Math.round(v).toLocaleString()}`} />
                  <Line type="monotone" dataKey="nic" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty />}
        </Card>
        <Card title="Registered patients over time">
          {listChart.length > 1 ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={listChart} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
                  <Line type="monotone" dataKey="patients" stroke="var(--chart-3)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty />}
        </Card>
        <Card title="Recent monthly activity">
          {sortedPx.length === 0 ? <Empty /> : (
            <div className="text-sm">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground uppercase">
                  <tr>
                    <th className="text-left py-1 font-medium">Month</th>
                    <th className="text-right py-1 font-medium">Items</th>
                    <th className="text-right py-1 font-medium">NIC £</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPx.slice(-12).reverse().map((r) => (
                    <tr key={`${r.year}-${r.month}`} className="border-t border-border">
                      <td className="py-1.5">{MONTHS[r.month - 1]} {r.year}{r.is_provisional ? " *" : ""}</td>
                      <td className="py-1.5 text-right tabular-nums">{Number(r.total_items).toLocaleString()}</td>
                      <td className="py-1.5 text-right tabular-nums">£{Math.round(Number(r.total_nic)).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-muted-foreground mt-2">* provisional</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function pctDelta(a: number, b: number): number | null {
  if (!b) return null;
  return ((a - b) / b) * 100;
}

function Stat({ icon: Icon, label, value, sub, delta, yoy }: { icon: any; label: string; value: string; sub?: string; delta?: number | null; yoy?: number | null }) {
  const TrendI = delta != null ? (delta > 1 ? TrendingUp : delta < -1 ? TrendingDown : Minus) : Minus;
  const trendColor = delta != null ? (delta > 1 ? "text-emerald-600" : delta < -1 ? "text-rose-600" : "text-muted-foreground") : "text-muted-foreground";
  return (
    <div className="border border-border rounded-lg bg-card p-4">
      <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Icon className="h-3 w-3" /> {label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
      <div className="mt-1 flex items-center gap-2 text-[11px] flex-wrap">
        {delta != null && <span className={`inline-flex items-center gap-0.5 ${trendColor}`}><TrendI className="h-3 w-3" />{Math.abs(delta).toFixed(1)}% <span className="text-muted-foreground">vs prior</span></span>}
        {yoy != null && <span className="text-muted-foreground">{yoy >= 0 ? "+" : ""}{yoy.toFixed(1)}% YoY</span>}
        {sub && <span className="text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-lg bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{title}</h3>
      {children}
    </div>
  );
}
function Empty() {
  return <p className="text-sm text-muted-foreground py-6">Not enough data ingested yet.</p>;
}

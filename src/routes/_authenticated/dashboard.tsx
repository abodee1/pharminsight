import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CountryBadge } from "@/components/CountryBadge";
import { Button } from "@/components/ui/button";
import {
  TrendingUp, TrendingDown, Minus, Star, ShieldCheck, Sparkles,
  Package, Stethoscope, ClipboardCheck, FileText, PoundSterling,
  Cigarette, Pill, Syringe, HeartPulse, Activity, GitCompare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PercentileRail, AnnotatedSparkline, ShareDonut, GpPrescribingCard } from "@/components/Infographics";
import { LocalLandscape } from "@/components/LocalLandscape";
import { LocalRadiusInsights } from "@/components/LocalRadiusInsights";
import { InteractiveTrend } from "@/components/InteractiveTrend";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { MarketShareSection } from "@/components/MarketShareSection";
import { CompetitorDeepDive } from "@/components/CompetitorDeepDive";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchAll } from "@/lib/fetchAll";
import { cn } from "@/lib/utils";
import { clearViewedPharmacy } from "@/lib/viewedPharmacy";
import { DataAttribution } from "@/components/DataAttribution";
import { pharmacyDisplayName } from "@/lib/pharmacyName";
import { PharmacySearch } from "@/components/PharmacySearch";

type WindowKey = 1 | 3 | 6 | 12;

export const Route = createFileRoute("/_authenticated/dashboard")({ component: MyPharmacy });

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

type Pharmacy = {
  id: string; ods_code: string; name: string; trading_name: string | null;
  address: string | null; postcode: string | null;
  region: string | null; country: string | null;
  lat: number | null; lng: number | null;
};
type Row = {
  month: number; year: number;
  items_dispensed: number; nms_count: number; pharmacy_first_count: number;
  flu_vaccinations: number; eps_items: number; eps_nominations: number;
  gross_cost: number | string | null;
  pharmacy_first_payment: number | string | null;
  mcr_payment: number | string | null;
  mcr_registrations: number; mcr_items: number;
  ehc_items: number; methadone_items: number; supervised_methadone_doses: number;
  smoking_cessation: number;
  smoking_cessation_payment: number | string | null;
  final_payment: number | string | null;
  is_actual_payment: boolean;
  pharmacy_first_services: Record<string, number> | null;
};

type RankKey = "items_dispensed" | "nms_count" | "pharmacy_first_count" | "flu_vaccinations" | "eps_items";

function MyPharmacy() {
  const { user, profile } = useAuth();
  const [pharmacy, setPharmacy] = useState<Pharmacy | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [noPharmacy, setNoPharmacy] = useState(false);
  const [hasFp34c, setHasFp34c] = useState(false);
  const [pfPeerAvg, setPfPeerAvg] = useState<Record<string, number> | null>(null);
  const [pfPeerCount, setPfPeerCount] = useState(0);
  const [peerDistribution, setPeerDistribution] = useState<{
    items_dispensed: number[]; nms_count: number[]; pharmacy_first_count: number[]; eps_items: number[]; flu_vaccinations: number[];
  } | null>(null);
  const [peerPeriods, setPeerPeriods] = useState<{
    items_dispensed: string; nms_count: string; pharmacy_first_count: string; eps_items: string;
  }>({ items_dispensed: "", nms_count: "", pharmacy_first_count: "", eps_items: "" });
  const [analyseOpen, setAnalyseOpen] = useState(false);
  const [deepDiveOpen, setDeepDiveOpen] = useState(false);
  const [statWindow, setStatWindow] = useState<WindowKey>(12);

  // Clear any "browsed pharmacy" so Compare/Benchmarking revert to saved pharmacy.
  useEffect(() => { clearViewedPharmacy(); }, []);

  // Load user's saved pharmacy + its dispensing rows
  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data: up } = await supabase
        .from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle();
      if (!up) { setNoPharmacy(true); setLoading(false); return; }
      setNoPharmacy(false);
      let { data: p, error: pErr } = await supabase
        .from("pharmacies")
        .select("id,ods_code,name,trading_name,address,postcode,region,country,lat,lng")
        .eq("id", up.pharmacy_id).maybeSingle();
      if (pErr) {
        // trading_name column may not exist yet — retry without it
        const { data: p2 } = await supabase
          .from("pharmacies")
          .select("id,ods_code,name,address,postcode,region,country,lat,lng")
          .eq("id", up.pharmacy_id).maybeSingle();
        p = p2 as any;
      }
      const ph = (p as Pharmacy) || null;
      setPharmacy(ph);
      if (ph) {
        const { data: d } = await supabase
          .from("dispensing_data")
          .select("month,year,items_dispensed,nms_count,pharmacy_first_count,flu_vaccinations,eps_items,eps_nominations,gross_cost,pharmacy_first_payment,mcr_payment,mcr_registrations,mcr_items,ehc_items,methadone_items,supervised_methadone_doses,smoking_cessation,smoking_cessation_payment,final_payment,is_actual_payment,pharmacy_first_services")
          .eq("pharmacy_id", ph.id)
          .order("year", { ascending: true })
          .order("month", { ascending: true });
        setRows((d as Row[]) || []);
      }
      setLoading(false);
    })();
  }, [user]);

  // FP34C upload check
  useEffect(() => {
    (async () => {
      if (!user || !pharmacy) { setHasFp34c(false); return; }
      const { count } = await supabase
        .from("private_uploads")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("pharmacy_id", pharmacy.id)
        .eq("upload_type", "fp34c");
      setHasFp34c((count ?? 0) > 0);
    })();
  }, [user, pharmacy]);


  // Peer PF service mix (Scotland only)
  useEffect(() => {
    (async () => {
      if (!pharmacy || rows.length === 0) return;
      if ((pharmacy.country || "").toLowerCase() !== "scotland") { setPfPeerAvg(null); return; }
      let latest = rows[rows.length - 1];
      for (let i = rows.length - 1; i >= 0; i--) {
        if ((rows[i].pharmacy_first_count || 0) > 0) { latest = rows[i]; break; }
      }
      const peerRows = await fetchAll<{ id: string }>((from, to) =>
        supabase.from("pharmacies").select("id").eq("country", "Scotland").eq("region", pharmacy.region ?? "").range(from, to),
      );
      const peerIds = peerRows.map((p) => p.id);
      if (peerIds.length === 0) { setPfPeerAvg(null); return; }
      const sums: Record<string, number> = {};
      let counted = 0;
      for (let i = 0; i < peerIds.length; i += 500) {
        const { data } = await supabase
          .from("dispensing_data")
          .select("pharmacy_first_services")
          .eq("year", latest.year).eq("month", latest.month)
          .in("pharmacy_id", peerIds.slice(i, i + 500));
        for (const r of data ?? []) {
          const svc = (r as { pharmacy_first_services: Record<string, number> | null }).pharmacy_first_services || {};
          counted++;
          for (const k of Object.keys(svc)) sums[k] = (sums[k] ?? 0) + (Number(svc[k]) || 0);
        }
      }
      if (counted === 0) { setPfPeerAvg(null); return; }
      const avg: Record<string, number> = {};
      for (const k of Object.keys(sums)) avg[k] = sums[k] / counted;
      setPfPeerAvg(avg);
      setPfPeerCount(counted);
    })();
  }, [rows, pharmacy]);

  // Peer distribution for percentile rails
  useEffect(() => {
    (async () => {
      if (!pharmacy || rows.length === 0) return;
      const peerRows = await fetchAll<{ id: string }>((from, to) =>
        supabase.from("pharmacies").select("id").eq("country", pharmacy.country ?? "").neq("id", pharmacy.id).order("id", { ascending: true }).range(from, to),
      );
      const peerIds = peerRows.map((p) => p.id);
      if (!peerIds.length) return;
      const peerIdSet = new Set(peerIds);

      const latestForPeriod = (key: keyof Row): { y: number; m: number } | null => {
        for (let i = rows.length - 1; i >= 0; i--) {
          if ((Number(rows[i][key]) || 0) > 0) return { y: rows[i].year, m: rows[i].month };
        }
        return null;
      };
      const periods = {
        items_dispensed: latestForPeriod("items_dispensed"),
        nms_count: latestForPeriod("nms_count"),
        pharmacy_first_count: latestForPeriod("pharmacy_first_count"),
        eps_items: latestForPeriod("eps_items"),
        flu_vaccinations: latestForPeriod("flu_vaccinations"),
      };

      const fetchPeriod = async (y: number, m: number) => {
        const all = await fetchAll<{ pharmacy_id: string; items_dispensed: number; nms_count: number; pharmacy_first_count: number; eps_items: number; flu_vaccinations: number }>((from, to) =>
          supabase.from("dispensing_data")
            .select("pharmacy_id,items_dispensed,nms_count,pharmacy_first_count,eps_items,flu_vaccinations")
            .eq("year", y).eq("month", m).order("id", { ascending: true }).range(from, to),
        );
        return all.filter((r) => peerIdSet.has(r.pharmacy_id));
      };

      const cache = new Map<string, Awaited<ReturnType<typeof fetchPeriod>>>();
      const getRows = async (p: { y: number; m: number } | null) => {
        if (!p) return [];
        const k = `${p.y}-${p.m}`;
        if (!cache.has(k)) cache.set(k, await fetchPeriod(p.y, p.m));
        return cache.get(k) || [];
      };

      const [itemsRows, nmsRows, pfRows, epsRows, fluRows] = await Promise.all([
        getRows(periods.items_dispensed),
        getRows(periods.nms_count),
        getRows(periods.pharmacy_first_count),
        getRows(periods.eps_items),
        getRows(periods.flu_vaccinations),
      ]);

      setPeerDistribution({
        items_dispensed: itemsRows.map((r) => r.items_dispensed || 0),
        nms_count: nmsRows.map((r) => r.nms_count || 0),
        pharmacy_first_count: pfRows.map((r) => r.pharmacy_first_count || 0),
        eps_items: epsRows.map((r) => r.eps_items || 0),
        flu_vaccinations: fluRows.map((r) => r.flu_vaccinations || 0),
      });
      setPeerPeriods({
        items_dispensed: periods.items_dispensed ? `${MONTHS[periods.items_dispensed.m - 1]} ${periods.items_dispensed.y}` : "",
        nms_count: periods.nms_count ? `${MONTHS[periods.nms_count.m - 1]} ${periods.nms_count.y}` : "",
        pharmacy_first_count: periods.pharmacy_first_count ? `${MONTHS[periods.pharmacy_first_count.m - 1]} ${periods.pharmacy_first_count.y}` : "",
        eps_items: periods.eps_items ? `${MONTHS[periods.eps_items.m - 1]} ${periods.eps_items.y}` : "",
      });
    })();
  }, [rows, pharmacy]);

  const isScotland = (pharmacy?.country || "").toLowerCase() === "scotland";
  const isEngland = (pharmacy?.country || "").toLowerCase() === "england";
  const isWales = (pharmacy?.country || "").toLowerCase() === "wales";
  const isNI = (pharmacy?.country || "").toLowerCase() === "northern ireland";
  const showVerified = isScotland;

  const latestIdx = useMemo(() => {
    if (rows.length === 0) return -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.items_dispensed > 0 || r.pharmacy_first_count > 0 || r.nms_count > 0) return i;
    }
    return rows.length - 1;
  }, [rows]);

  const latest = latestIdx >= 0 ? rows[latestIdx] : undefined;

  const latestFor = useMemo(() => {
    return (key: keyof Row): { row: Row; prior?: Row; yoy?: Row } | null => {
      for (let i = rows.length - 1; i >= 0; i--) {
        if ((Number(rows[i][key]) || 0) > 0) {
          const row = rows[i];
          const priorR = i > 0 ? rows[i - 1] : undefined;
          const yoyR = rows.find((r) => r.year === row.year - 1 && r.month === row.month) ?? undefined;
          return { row, prior: priorR, yoy: yoyR };
        }
      }
      return null;
    };
  }, [rows]);

  // Derive per-metric country ranks from the already country-filtered peerDistribution.
  // This replaces the old ranks useEffect that queried all nations without a country filter.
  const ranks = useMemo<Partial<Record<RankKey, { rank: number; total: number }>>>(() => {
    if (!peerDistribution) return {};
    const keys: RankKey[] = ["items_dispensed", "nms_count", "pharmacy_first_count", "flu_vaccinations", "eps_items"];
    const out: Partial<Record<RankKey, { rank: number; total: number }>> = {};
    for (const k of keys) {
      const arr = peerDistribution[k as keyof typeof peerDistribution];
      if (!arr?.length) continue;
      const lf = latestFor(k as keyof Row);
      if (!lf) continue;
      const value = Number(lf.row[k as keyof Row]) || 0;
      const above = arr.filter((v) => v > value).length;
      out[k] = { rank: above + 1, total: arr.length };
    }
    return out;
  }, [peerDistribution, latestFor]);

  const trimmedRows = useMemo(
    () => (latestIdx >= 0 ? rows.slice(0, latestIdx + 1) : rows),
    [rows, latestIdx],
  );
  const chartData = useMemo(() => trimmedRows.slice(-24).map((r) => ({
    label: `${MONTHS[r.month - 1]} ${String(r.year).slice(2)}`,
    items: r.items_dispensed,
    eps_items: r.eps_items,
    nms: r.nms_count,
    pf: r.pharmacy_first_count,
    flu: r.flu_vaccinations,
    cost: Number(r.gross_cost) || 0,
  })), [trimmedRows]);

  type MetricDef = {
    label: string;
    key: RankKey | "money";
    field: keyof Row;
    format?: (n: number) => string;
  };

  const gbp = (n: number) => "£" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  const buildMetric = (m: MetricDef) => {
    const N = statWindow;
    let anchor = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if ((Number(rows[i][m.field]) || 0) > 0) { anchor = i; break; }
    }
    if (anchor === -1) {
      return { label: m.label, key: m.key, value: 0, prior: 0, yoy: 0, format: m.format, period: "" };
    }
    const sumRange = (lo: number, hi: number) => {
      let s = 0;
      for (let i = Math.max(0, lo); i <= Math.min(rows.length - 1, hi); i++) {
        s += Number(rows[i][m.field]) || 0;
      }
      return s;
    };
    const value = sumRange(anchor - N + 1, anchor);
    const priorVal = sumRange(anchor - 2 * N + 1, anchor - N);
    // YoY compares the same N-month window starting 12 months earlier.
    // When N === 12 this is identical to the "prior" window above, so we
    // suppress it (avoids showing two labels for the same percentage).
    const yoyAnchor = anchor - 12;
    const yoyVal = N === 12 || yoyAnchor < 0
      ? 0
      : sumRange(yoyAnchor - N + 1, yoyAnchor);
    const from = rows[Math.max(0, anchor - N + 1)];
    const to = rows[anchor];
    const period = N === 1
      ? `${MONTHS[to.month - 1]} ${to.year}`
      : `${MONTHS[from.month - 1]} ${String(from.year).slice(2)} – ${MONTHS[to.month - 1]} ${String(to.year).slice(2)}`;
    return { label: m.label, key: m.key, value, prior: priorVal, yoy: yoyVal, format: m.format, period };
  };

  const baseDefs: MetricDef[] = latest
    ? (isScotland
        ? [
            { label: "Items dispensed", key: "items_dispensed", field: "items_dispensed" },
            { label: "Pharmacy First", key: "pharmacy_first_count", field: "pharmacy_first_count" },
          ]
        : [
            { label: "Items dispensed", key: "items_dispensed", field: "items_dispensed" },
            { label: "EPS items", key: "eps_items", field: "eps_items" },
            { label: "NMS", key: "nms_count", field: "nms_count" },
            { label: "Pharmacy First", key: "pharmacy_first_count", field: "pharmacy_first_count" },
            { label: "Flu vaccinations", key: "flu_vaccinations", field: "flu_vaccinations" },
          ])
    : [];

  // Scottish-only service metrics. There is no national per-service rank
  // table for these, so we mark their `key` as "money" — that sentinel is
  // excluded from the rank lookup further below, preventing the
  // misleading items_dispensed rank from appearing on every card.
  const scottishDefs: MetricDef[] = isScotland && latest
    ? [
        { label: "MCR registrations", key: "money", field: "mcr_registrations" },
        { label: "MCR items", key: "money", field: "mcr_items" },
        { label: "EHC items", key: "money", field: "ehc_items" },
        { label: "Methadone items", key: "money", field: "methadone_items" },
        { label: "Supervised doses", key: "money", field: "supervised_methadone_doses" },
        { label: "Smoking cessation", key: "money", field: "smoking_cessation" },
        { label: "Smoking cessation £", key: "money", field: "smoking_cessation_payment", format: gbp },
        { label: "Pharmacy First £", key: "money", field: "pharmacy_first_payment", format: gbp },
        { label: "MCR payment", key: "money", field: "mcr_payment", format: gbp },
        { label: "Gross cost", key: "money", field: "gross_cost", format: gbp },
        { label: "Final NHS payment", key: "money", field: "final_payment", format: gbp },
      ]
    : [];

  const walesDefs: MetricDef[] = isWales && latest
    ? [
        { label: "Pharmacy First £", key: "money", field: "pharmacy_first_payment", format: gbp },
        { label: "Gross cost", key: "money", field: "gross_cost", format: gbp },
        { label: "Final NHS payment", key: "money", field: "final_payment", format: gbp },
      ]
    : [];

  const metrics = [...baseDefs, ...scottishDefs, ...walesDefs].map(buildMetric).filter((m) => m.value > 0);
  const tableRows = [...trimmedRows].slice(-24).reverse();

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();
  const firstName = (profile?.full_name || "").split(" ")[0] || "there";

  if (loading) {
    return <div className="p-10 text-sm text-muted-foreground">Loading your pharmacy…</div>;
  }

  if (noPharmacy || !pharmacy) {
    return (
      <div className="p-6 md:p-10 max-w-7xl mx-auto animate-fade-in">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">My Pharmacy</p>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">{greeting}, {firstName}</h1>
          </div>
          <div className="w-full max-w-lg rounded-xl border border-gold/40 bg-gold/5 px-4 py-3 shadow-sm">
            <p className="text-xs font-semibold text-gold/80 mb-2 uppercase tracking-wider">Find a pharmacy</p>
            <PharmacySearch large placeholder="Search by postcode, name or ODS code…" />
          </div>
        </div>
        <div className="rounded-lg border border-gold/40 bg-gold/10 p-6 text-sm max-w-xl mx-auto">
          <p className="font-semibold text-base">No pharmacy set yet</p>
          <p className="text-muted-foreground mt-1">
            Set your pharmacy to unlock personalised benchmarks, performance trends, and smart insights.
          </p>
          <div className="mt-4">
            <Link to="/settings"><Button size="sm">Set in Settings</Button></Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    <div>
      <div className="p-4 sm:p-6 md:p-10 max-w-6xl mx-auto overflow-x-hidden">

        {/* Page identity */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">My Pharmacy</p>
            <p className="text-sm text-muted-foreground mt-0.5">{greeting}, {firstName}</p>
          </div>
          <div className="w-full max-w-lg rounded-xl border border-gold/40 bg-gold/5 px-4 py-3 shadow-sm">
            <p className="text-xs font-semibold text-gold/80 mb-2 uppercase tracking-wider">Find a pharmacy</p>
            <PharmacySearch large placeholder="Search by postcode, name or ODS code…" />
          </div>
        </div>

        {/* Pharmacy header — mirrors pharmacy profile */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{pharmacyDisplayName(pharmacy.name, pharmacy.trading_name, pharmacy.ods_code)}</h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 border border-gold/40 px-2.5 py-0.5 text-xs font-semibold text-gold">
                <Star className="h-3 w-3 fill-current" /> Your pharmacy
              </span>
              {(showVerified || hasFp34c) ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="h-3 w-3" /> Verified payment data
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted border border-border px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                  Estimated income
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              {[pharmacy.address, pharmacy.postcode].filter(Boolean).join(", ")}
            </p>
            <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
              <CountryBadge country={pharmacy.country} />
              {pharmacy.region && <span>{pharmacy.region}</span>}
              <span>·</span>
              <span className="font-mono">{pharmacy.ods_code}</span>
              {latest && <><span>·</span><span>Latest: {MONTHS[latest.month - 1]} {latest.year}</span></>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              className="gap-1.5 bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-semibold border-0 shadow-md hover:from-amber-400 hover:to-yellow-300 hover:shadow-amber-400/30 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150"
              onClick={() => setAnalyseOpen(true)}
            >
              <Sparkles className="h-4 w-4" /> Analyse This Pharmacy
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setDeepDiveOpen((d) => !d)}
            >
              <GitCompare className="h-4 w-4" /> Head-to-Head at a glance
            </Button>
          </div>
        </div>

        {deepDiveOpen && (
          <CompetitorDeepDive
            pharmacyId={pharmacy.id}
            pharmacyOds={pharmacy.ods_code}
            pharmacyName={pharmacyDisplayName(pharmacy.name, pharmacy.trading_name, pharmacy.ods_code)}
            country={pharmacy.country}
            onClose={() => setDeepDiveOpen(false)}
          />
        )}

        {metrics.length === 0 ? (
          <p className="mt-8 text-sm text-muted-foreground">No dispensing data available for this pharmacy yet.</p>
        ) : (
          <>
            {/* Headline metrics */}
            <div className="mt-6 flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold tracking-tight">Headline metrics</h2>
                <p className="text-xs text-muted-foreground italic mt-0.5">
                  {statWindow === 1
                    ? "Each card shows the latest reported month."
                    : `Trailing ${statWindow}-month totals ending at each metric's most recent reported month.`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Window</span>
                <Select value={String(statWindow)} onValueChange={(v) => setStatWindow(Number(v) as WindowKey)}>
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

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {metrics.map((m) => (
                <MetricCard
                  key={m.label}
                  label={m.label}
                  value={m.value}
                  prior={m.prior}
                  yoy={m.yoy}
                  format={m.format}
                  rank={m.key !== "money" ? ranks[m.key as RankKey] : undefined}
                  period={m.period}
                  windowLabel={statWindow === 1 ? "Monthly" : `Last ${statWindow}mo`}
                />
              ))}
            </div>

            {!showVerified && !hasFp34c && !isWales && (
              <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                Payment data isn't publicly available for this pharmacy.
              </div>
            )}

            {/* Interactive trend */}
            <div className="mt-6">
              <InteractiveTrend
                rows={trimmedRows}
                available={
                  isScotland || isWales
                    ? ["items", "pf", "flu", "gross", "final", "mcr", "meth", "smoke"]
                    : isNI
                    ? ["items", "pf", "flu"]
                    : ["items", "eps", "nom", "nms", "pf", "flu", "gross", "final"]
                }
              />
            </div>

            {/* Local radius insights */}
            <div className="mt-6">
              <LocalRadiusInsights
                pharmacyId={pharmacy.id}
                pharmacyName={pharmacyDisplayName(pharmacy.name, pharmacy.trading_name, pharmacy.ods_code)}
                postcode={pharmacy.postcode}
                lat={pharmacy.lat}
                lng={pharmacy.lng}
              />
            </div>

            {/* Percentile rails */}
            {peerDistribution && latest && (
              <section className="mt-8">
                <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
                  <h2 className="text-sm font-semibold tracking-tight">How this pharmacy ranks in {pharmacy.country}</h2>
                  <p className="text-xs text-muted-foreground italic">
                    Each rail uses the latest reported month for that metric.
                  </p>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <PercentileRail
                    label={`Items dispensed${peerPeriods.items_dispensed ? ` · ${peerPeriods.items_dispensed}` : ""}`}
                    value={latestFor("items_dispensed")?.row.items_dispensed ?? latest.items_dispensed}
                    values={peerDistribution.items_dispensed}
                    peerLabel={`${pharmacy.country} avg`}
                    nationalLabel="Highest"
                    caption={`Monthly prescription volume against ${peerDistribution.items_dispensed.length.toLocaleString()} reporting peers.`}
                  />
                  <PercentileRail
                    label={`Pharmacy First${peerPeriods.pharmacy_first_count ? ` · ${peerPeriods.pharmacy_first_count}` : ""}`}
                    value={latestFor("pharmacy_first_count")?.row.pharmacy_first_count ?? latest.pharmacy_first_count}
                    values={peerDistribution.pharmacy_first_count}
                    peerLabel={`${pharmacy.country} avg`}
                    nationalLabel="Highest"
                    caption={`Clinical consultations under Pharmacy First versus ${peerDistribution.pharmacy_first_count.length.toLocaleString()} country peers.`}
                  />
                  {isEngland && (
                    <PercentileRail
                      label={`New Medicine Service${peerPeriods.nms_count ? ` · ${peerPeriods.nms_count}` : ""}`}
                      value={latestFor("nms_count")?.row.nms_count ?? latest.nms_count}
                      values={peerDistribution.nms_count}
                      peerLabel={`${pharmacy.country} avg`}
                      nationalLabel="Highest"
                      caption={`NMS interventions versus ${peerDistribution.nms_count.length.toLocaleString()} country peers.`}
                    />
                  )}
                  {isEngland && (
                    <PercentileRail
                      label={`EPS items${peerPeriods.eps_items ? ` · ${peerPeriods.eps_items}` : ""}`}
                      value={latestFor("eps_items")?.row.eps_items ?? latest.eps_items}
                      values={peerDistribution.eps_items}
                      peerLabel={`${pharmacy.country} avg`}
                      nationalLabel="Highest"
                      caption={`Items dispensed via EPS versus ${peerDistribution.eps_items.length.toLocaleString()} country peers.`}
                    />
                  )}
                </div>
              </section>
            )}

            {/* Annotated sparklines */}
            {chartData.length >= 6 && (
              <section className="mt-6 grid md:grid-cols-2 gap-4">
                <AnnotatedSparkline
                  label="Items dispensed — 24-month arc"
                  points={chartData.map((d) => ({ period: d.label, value: d.items }))}
                  caption="Two-year trajectory of monthly prescription volume. Dots mark the peak and trough months in the window."
                />
                <AnnotatedSparkline
                  label="Pharmacy First — 24-month arc"
                  points={chartData.map((d) => ({ period: d.label, value: d.pf }))}
                  caption="Two-year trajectory of Pharmacy First consultations, with peak and trough months highlighted."
                />
              </section>
            )}

            {/* Scotland payment composition */}
            {isScotland && latest && (() => {
              const slice = trimmedRows.slice(-12);
              const sumF = (k: keyof Row) => slice.reduce((a, r) => a + (Number(r[k]) || 0), 0);
              const sumI = (k: keyof Row) => slice.reduce((a, r) => a + (Number(r[k]) || 0), 0);
              const pf = sumF("pharmacy_first_payment");
              const mcrPay = sumF("mcr_payment");
              const smkPay = sumF("smoking_cessation_payment");
              const gross = sumF("gross_cost");
              const finalPay = sumF("final_payment");
              const dispensing = Math.max(0, gross - pf - mcrPay - smkPay);
              const topUp = Math.max(0, finalPay - gross);
              const recovery = Math.max(0, gross - finalPay);
              const methDoses = sumI("supervised_methadone_doses");
              const methSupervision = methDoses * 2.5;
              const dispNet = Math.max(0, dispensing - methSupervision);
              const ehcItems = sumI("ehc_items");
              const periodLabel = slice.length
                ? `${MONTHS[slice[0].month - 1]} ${String(slice[0].year).slice(2)} – ${MONTHS[slice[slice.length - 1].month - 1]} ${String(slice[slice.length - 1].year).slice(2)}`
                : "";
              const segments = [
                { label: "Dispensing reimbursement", value: dispNet },
                { label: "Pharmacy First", value: pf },
                { label: "MCR (chronic medication)", value: mcrPay },
                { label: "Methadone supervision (est.)", value: methSupervision },
                { label: "Smoking cessation", value: smkPay },
                { label: "EHC items (est.)", value: ehcItems * 11 },
                { label: "Adjustments & top-ups", value: topUp },
                { label: "Clawback / recoveries", value: recovery },
              ].filter((s) => s.value > 0);
              return (
                <section className="mt-6">
                  <ShareDonut
                    label={`Payment composition · trailing 12 months${periodLabel ? ` · ${periodLabel}` : ""}`}
                    caption="Where NHS revenue came from over the last 12 reported months. Dispensing reimbursement is the residual gross drug cost net of service fees. Methadone supervision and EHC are estimated at PCA reference rates (£2.50/dose · £11/item) — actual amounts may vary."
                    formatValue={(n) => "£" + n.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    segments={segments}
                  />
                </section>
              );
            })()}

            {/* GP prescribing */}
            <section className="mt-6">
              <GpPrescribingCard pharmacyOds={pharmacy.ods_code} />
            </section>

            {/* Local landscape */}
            <LocalLandscape
              pharmacyName={pharmacyDisplayName(pharmacy.name, pharmacy.trading_name, pharmacy.ods_code)}
              postcode={pharmacy.postcode}
              address={pharmacy.address}
            />

            {/* Market share */}
            <MarketShareSection
              pharmacyId={pharmacy.id}
              pharmacyOds={pharmacy.ods_code}
              pharmacyName={pharmacyDisplayName(pharmacy.name, pharmacy.trading_name, pharmacy.ods_code)}
              lat={pharmacy.lat}
              lng={pharmacy.lng}
            />

            {/* Monthly history table */}
            <div className="mt-6 rounded-lg bg-card border border-border shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-semibold">Monthly history — last 24 months</h2>
                <span className="text-xs text-muted-foreground">Newest first</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Month</th>
                      <th className="text-right px-3 py-2 font-medium">Items</th>
                      {isEngland && <th className="text-right px-3 py-2 font-medium">EPS items</th>}
                      {isEngland && <th className="text-right px-3 py-2 font-medium">EPS nom.</th>}
                      {isEngland && <th className="text-right px-3 py-2 font-medium">NMS</th>}
                      <th className="text-right px-3 py-2 font-medium">PF</th>
                      <th className="text-right px-3 py-2 font-medium">PF £</th>
                      {isScotland && <th className="text-right px-3 py-2 font-medium">EHC</th>}
                      {isScotland && <th className="text-right px-3 py-2 font-medium">Meth.</th>}
                      {isScotland && <th className="text-right px-3 py-2 font-medium">Smoke.</th>}
                      {isScotland && <th className="text-right px-3 py-2 font-medium">MCR £</th>}
                      {(isScotland || isWales) && <th className="text-right px-3 py-2 font-medium">Gross £</th>}
                      {(isScotland || isWales) && <th className="text-right px-3 py-2 font-medium">Final £</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((r) => {
                      const fmtGbp = (v: number | string | null) => "£" + (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
                      return (
                        <tr key={`${r.year}-${r.month}`} className="border-t border-border">
                          <td className="px-3 py-2 whitespace-nowrap">{MONTHS[r.month - 1]} {r.year}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.items_dispensed.toLocaleString()}</td>
                          {isEngland && <td className="px-3 py-2 text-right tabular-nums">{r.eps_items.toLocaleString()}</td>}
                          {isEngland && <td className="px-3 py-2 text-right tabular-nums">{r.eps_nominations.toLocaleString()}</td>}
                          {isEngland && <td className="px-3 py-2 text-right tabular-nums">{r.nms_count.toLocaleString()}</td>}
                          <td className="px-3 py-2 text-right tabular-nums">{r.pharmacy_first_count.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtGbp(r.pharmacy_first_payment)}</td>
                          {isScotland && <td className="px-3 py-2 text-right tabular-nums">{r.ehc_items.toLocaleString()}</td>}
                          {isScotland && <td className="px-3 py-2 text-right tabular-nums">{r.methadone_items.toLocaleString()}</td>}
                          {isScotland && <td className="px-3 py-2 text-right tabular-nums">{r.smoking_cessation.toLocaleString()}</td>}
                          {isScotland && <td className="px-3 py-2 text-right tabular-nums">{fmtGbp(r.mcr_payment)}</td>}
                          {(isScotland || isWales) && <td className="px-3 py-2 text-right tabular-nums">{fmtGbp(r.gross_cost)}</td>}
                          {(isScotland || isWales) && <td className="px-3 py-2 text-right tabular-nums">{fmtGbp(r.final_payment)}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <DataAttribution />
      </div>
    </div>
    <AnalysisPanel pharmacy={pharmacy} open={analyseOpen} onClose={() => setAnalyseOpen(false)} />
    </>
  );
}

// ── MetricCard (flip-to-reveal description) ───────────────────────────────────

const METRIC_DESCRIPTIONS: Record<string, string> = {
  "Items dispensed": "Total prescription items dispensed this month. The primary driver of NHS pharmacy income — each item earns a dispensing fee plus drug cost reimbursement.",
  "EPS items": "Items dispensed via the Electronic Prescription Service. Higher EPS share means a faster, more efficient workflow and quicker reimbursement.",
  "EPS nominations": "Patients who have nominated this pharmacy as their default EPS dispenser. A leading indicator of future script volume and patient loyalty.",
  "NMS": "New Medicine Service consultations — paid by the NHS (~£28 each) when a pharmacist supports a patient newly started on a long-term medicine.",
  "Pharmacy First": "Pharmacy First clinical consultations. In England paid per consultation plus a monthly fixed fee; in Scotland forms a core part of the contract.",
  "MCR registrations": "Patients registered for Medicines: Care & Review — the Scottish chronic medication service. A higher count means a larger ongoing managed caseload.",
  "MCR items": "Items dispensed under the MCR service this month. Tracks the active workload of the Scottish chronic medication caseload.",
  "EHC items": "Emergency hormonal contraception supplies (Plan B / Levonelle) under the NHS Public Health Service.",
  "Methadone items": "Substance misuse / opioid replacement prescriptions dispensed under the Pharmacy Public Health Service.",
  "Supervised doses": "Methadone or buprenorphine doses consumed under direct pharmacist supervision. Paid per supervised dose.",
  "Smoking cessation": "Smoking cessation interventions delivered under the Public Health Service. Each completed episode attracts a service payment.",
  "Smoking cessation £": "Total NHS payment received this month for smoking cessation services delivered.",
  "Pharmacy First £": "Total NHS payment received this month for Pharmacy First consultations and the associated fixed fee.",
  "MCR payment": "Total NHS payment received this month for the Medicines: Care & Review service.",
  "Gross cost": "Total gross drug cost reimbursed by the NHS for items dispensed this month, before clawbacks and deductions.",
  "Final NHS payment": "The actual net payment received from the NHS for this month — gross cost plus all fees and service payments, less clawbacks and deductions.",
};

type MetricAccent = "indigo" | "emerald" | "amber" | "rose" | "sky" | "violet" | "slate" | "teal";

const METRIC_ACCENTS: Record<MetricAccent, { ring: string; chip: string; glow: string; bar: string }> = {
  indigo:  { ring: "ring-indigo-500/15",  chip: "bg-indigo-500/10 text-indigo-600",   glow: "from-indigo-500/15",  bar: "bg-indigo-500" },
  emerald: { ring: "ring-emerald-500/15", chip: "bg-emerald-500/10 text-emerald-600", glow: "from-emerald-500/15", bar: "bg-emerald-500" },
  amber:   { ring: "ring-amber-500/15",   chip: "bg-amber-500/10 text-amber-600",     glow: "from-amber-500/15",   bar: "bg-amber-500" },
  rose:    { ring: "ring-rose-500/15",    chip: "bg-rose-500/10 text-rose-600",       glow: "from-rose-500/15",    bar: "bg-rose-500" },
  sky:     { ring: "ring-sky-500/15",     chip: "bg-sky-500/10 text-sky-600",         glow: "from-sky-500/15",     bar: "bg-sky-500" },
  violet:  { ring: "ring-violet-500/15",  chip: "bg-violet-500/10 text-violet-600",   glow: "from-violet-500/15",  bar: "bg-violet-500" },
  slate:   { ring: "ring-slate-500/15",   chip: "bg-slate-500/10 text-slate-600",     glow: "from-slate-500/15",   bar: "bg-slate-500" },
  teal:    { ring: "ring-teal-500/15",    chip: "bg-teal-500/10 text-teal-600",       glow: "from-teal-500/15",    bar: "bg-teal-500" },
};

function metricStyle(label: string): { icon: LucideIcon; accent: MetricAccent } {
  const l = label.toLowerCase();
  if (l.includes("pharmacy first")) return { icon: Stethoscope, accent: "emerald" };
  if (l.includes("nms")) return { icon: ClipboardCheck, accent: "sky" };
  if (l.includes("eps")) return { icon: FileText, accent: "violet" };
  if (l.includes("mcr")) return { icon: HeartPulse, accent: "rose" };
  if (l.includes("smoking")) return { icon: Cigarette, accent: "amber" };
  if (l.includes("methadone") || l.includes("supervised")) return { icon: Pill, accent: "teal" };
  if (l.includes("ehc")) return { icon: Syringe, accent: "rose" };
  if (l.includes("£") || l.includes("payment") || l.includes("cost")) return { icon: PoundSterling, accent: "amber" };
  if (l.includes("items")) return { icon: Package, accent: "indigo" };
  return { icon: Activity, accent: "slate" };
}

function MetricCard({ label, value, prior, yoy, format, rank, period, windowLabel }: {
  label: string; value: number; prior: number; yoy: number;
  format?: (n: number) => string;
  rank?: { rank: number; total: number };
  period?: string;
  windowLabel?: string;
}) {
  const [flipped, setFlipped] = useState(false);
  const fmt = format ?? ((n: number) => n.toLocaleString());
  const delta = prior ? ((value - prior) / prior) * 100 : 0;
  const yoyDelta = yoy ? ((value - yoy) / yoy) * 100 : 0;
  const TrendIcon = delta > 1 ? TrendingUp : delta < -1 ? TrendingDown : Minus;
  const trendColor = delta > 1 ? "bg-emerald-500/10 text-emerald-600" : delta < -1 ? "bg-rose-500/10 text-rose-600" : "bg-muted text-muted-foreground";
  const description = METRIC_DESCRIPTIONS[label] || "No description available for this metric yet.";
  const { icon: Icon, accent } = metricStyle(label);
  const a = METRIC_ACCENTS[accent];
  return (
    <button
      type="button"
      onClick={() => setFlipped((f) => !f)}
      className="group relative w-full text-left [perspective:1000px] focus:outline-none rounded-xl"
      aria-label={`${label}: tap to ${flipped ? "hide" : "show"} description`}
    >
      <div className={`relative h-full min-h-[10.5rem] transition-transform duration-500 [transform-style:preserve-3d] ${flipped ? "[transform:rotateY(180deg)]" : ""}`}>
        <div
          className={cn(
            "absolute inset-0 overflow-hidden rounded-xl bg-card border border-border p-4 shadow-sm ring-1 [backface-visibility:hidden] flex flex-col transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md",
            a.ring,
          )}
        >
          <div className={cn("pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full bg-gradient-to-br to-transparent opacity-70 blur-2xl", a.glow)} />
          <div className={cn("absolute left-0 top-0 h-full w-[3px]", a.bar)} />
          <div className="relative flex items-start justify-between gap-2">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground flex-1 min-w-0 truncate">{label}</p>
            <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", a.chip)}>
              <Icon className="h-3.5 w-3.5" />
            </div>
          </div>
          <p className="relative mt-2 text-[1.55rem] leading-none font-semibold tracking-tight text-foreground tabular-nums">{fmt(value)}</p>
          {period && <p className="relative mt-1.5 text-[10px] text-muted-foreground">{windowLabel ?? "Monthly"} · {period}</p>}
          <div className="relative mt-auto pt-2 flex flex-wrap items-center gap-1.5">
            {prior > 0 && (
              <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold", trendColor)}>
                <TrendIcon className="h-2.5 w-2.5" />
                {Math.abs(delta).toFixed(1)}%
                <span className="font-normal opacity-70">vs prior</span>
              </span>
            )}
            {yoy > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {yoyDelta >= 0 ? "+" : ""}{yoyDelta.toFixed(1)}% YoY
              </span>
            )}
            {rank && rank.total > 0 && (
              <span className="text-[10px] text-muted-foreground">
                #{rank.rank.toLocaleString()} / {rank.total.toLocaleString()}
              </span>
            )}
          </div>
          <span className="absolute bottom-2 right-3 text-[9px] text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">tap ⓘ</span>
        </div>
        <div className="absolute inset-0 rounded-xl border border-gold/50 bg-gold/5 p-4 shadow-sm [backface-visibility:hidden] [transform:rotateY(180deg)] overflow-auto">
          <p className="text-[11px] uppercase tracking-wider text-gold font-semibold">{label}</p>
          <p className="text-xs leading-relaxed mt-1.5 text-foreground/90">{description}</p>
          <p className="text-[10px] text-muted-foreground mt-2">Tap to flip back.</p>
        </div>
      </div>
    </button>
  );
}

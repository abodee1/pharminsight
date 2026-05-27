import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CountryBadge } from "@/components/CountryBadge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, ArrowLeft, Star, X, ShieldCheck, Sparkles, Package, Stethoscope, ClipboardCheck, FileText, PoundSterling, Cigarette, Pill, Syringe, HeartPulse, Activity } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PharmacySearch } from "@/components/PharmacySearch";
import { PercentileRail, AnnotatedSparkline, ShareDonut } from "@/components/Infographics";
import { LocalLandscape } from "@/components/LocalLandscape";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { fetchAll } from "@/lib/fetchAll";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pharmacy/$odsCode")({ component: PharmacyProfile });

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const PF_SERVICES: { key: string; label: string }[] = [
  { key: "acute", label: "Acute conditions" },
  { key: "uti", label: "UTI" },
  { key: "impetigo", label: "Impetigo" },
  { key: "skin_infection", label: "Skin infection" },
  { key: "sexual_health", label: "Sexual health" },
  { key: "hayfever", label: "Hayfever" },
  { key: "bridging_contraception", label: "Bridging contraception" },
  { key: "emergency_contraception", label: "Emergency contraception" },
];

type Pharmacy = {
  id: string; ods_code: string; name: string;
  address: string | null; postcode: string | null;
  region: string | null; country: string | null;
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

function PharmacyProfile() {
  const { odsCode } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pharmacy, setPharmacy] = useState<Pharmacy | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [myPharmacyId, setMyPharmacyId] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [hasUserPharmacy, setHasUserPharmacy] = useState<boolean | null>(null);
  const [ranks, setRanks] = useState<Partial<Record<RankKey, { rank: number; total: number }>>>({});
  const [hasFp34c, setHasFp34c] = useState(false);
  const [pfPeerAvg, setPfPeerAvg] = useState<Record<string, number> | null>(null);
  const [pfPeerCount, setPfPeerCount] = useState(0);
  const [peerDistribution, setPeerDistribution] = useState<{
    items_dispensed: number[]; nms_count: number[]; pharmacy_first_count: number[]; eps_items: number[];
  } | null>(null);
  const [peerPeriods, setPeerPeriods] = useState<{
    items_dispensed: string; nms_count: string; pharmacy_first_count: string; eps_items: string;
  }>({ items_dispensed: "", nms_count: "", pharmacy_first_count: "", eps_items: "" });
  const [analyseOpen, setAnalyseOpen] = useState(false);

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

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: p } = await supabase
        .from("pharmacies")
        .select("id,ods_code,name,address,postcode,region,country")
        .eq("ods_code", odsCode.toUpperCase())
        .maybeSingle();
      setPharmacy((p as Pharmacy) || null);
      if (p) {
        const { data: d } = await supabase
          .from("dispensing_data")
          .select("month,year,items_dispensed,nms_count,pharmacy_first_count,flu_vaccinations,eps_items,eps_nominations,gross_cost,pharmacy_first_payment,mcr_payment,mcr_registrations,mcr_items,ehc_items,methadone_items,supervised_methadone_doses,smoking_cessation,smoking_cessation_payment,final_payment,is_actual_payment,pharmacy_first_services")
          .eq("pharmacy_id", (p as Pharmacy).id)
          .order("year", { ascending: true })
          .order("month", { ascending: true });
        setRows((d as Row[]) || []);
      }
      setLoading(false);
    })();
  }, [odsCode]);

  useEffect(() => {
    (async () => {
      if (!user) { setHasUserPharmacy(false); return; }
      const { data } = await supabase
        .from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle();
      setMyPharmacyId(data?.pharmacy_id ?? null);
      setHasUserPharmacy(!!data);
    })();
  }, [user]);

  // National rank for latest month across the key metrics
  useEffect(() => {
    (async () => {
      if (rows.length === 0) return;
      // Use latest row with reported activity for all pharmacies (same logic
      // everywhere — don't prefer is_actual_payment, which lags 2+ months).
      let latest = rows[rows.length - 1];
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (r.items_dispensed > 0 || r.pharmacy_first_count > 0 || r.nms_count > 0) { latest = r; break; }
      }
      const keys: RankKey[] = ["items_dispensed", "nms_count", "pharmacy_first_count", "flu_vaccinations", "eps_items"];
      const out: Partial<Record<RankKey, { rank: number; total: number }>> = {};
      await Promise.all(keys.map(async (k) => {
        const value = (latest as any)[k] as number;
        const totalQ = await supabase
          .from("dispensing_data")
          .select("pharmacy_id", { count: "exact", head: true })
          .eq("year", latest.year).eq("month", latest.month);
        const aheadQ = await supabase
          .from("dispensing_data")
          .select("pharmacy_id", { count: "exact", head: true })
          .eq("year", latest.year).eq("month", latest.month)
          .gt(k, value);
        const total = totalQ.count ?? 0;
        const rank = (aheadQ.count ?? 0) + 1;
        out[k] = { rank, total };
      }));
      setRanks(out);
    })();
  }, [rows, pharmacy]);

  // Peer PF service mix — average per pharmacy for the same region+month.
  useEffect(() => {
    (async () => {
      if (!pharmacy || rows.length === 0) return;
      if ((pharmacy.country || "").toLowerCase() !== "scotland") { setPfPeerAvg(null); return; }
      // Find latest month with PF activity for this pharmacy
      let latest = rows[rows.length - 1];
      for (let i = rows.length - 1; i >= 0; i--) {
        if ((rows[i].pharmacy_first_count || 0) > 0) { latest = rows[i]; break; }
      }
      const peerRows = await fetchAll<{ id: string }>((from, to) =>
        supabase
          .from("pharmacies")
          .select("id")
          .eq("country", "Scotland")
          .eq("region", pharmacy.region ?? "")
          .range(from, to),
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

  // National peer distribution for percentile rails. Each metric uses its own
  // latest reported period — items, PF, NMS and EPS can each lag differently.
  useEffect(() => {
    (async () => {
      if (!pharmacy || rows.length === 0) return;
      // Paginate to fetch ALL country pharmacies (Scotland 1800+, England 16k+)
      const peerRows = await fetchAll<{ id: string }>((from, to) =>
        supabase
          .from("pharmacies")
          .select("id")
          .eq("country", pharmacy.country ?? "")
          .range(from, to),
      );
      const peerIds = peerRows.map((p) => p.id);
      if (!peerIds.length) return;
      const peerIdSet = new Set(peerIds);

      // Determine latest reported period per-metric for THIS pharmacy
      const latestFor = (key: keyof Row): { y: number; m: number } | null => {
        for (let i = rows.length - 1; i >= 0; i--) {
          if ((Number(rows[i][key]) || 0) > 0) return { y: rows[i].year, m: rows[i].month };
        }
        return null;
      };
      const periods: Record<"items_dispensed" | "nms_count" | "pharmacy_first_count" | "eps_items", { y: number; m: number } | null> = {
        items_dispensed: latestFor("items_dispensed"),
        nms_count: latestFor("nms_count"),
        pharmacy_first_count: latestFor("pharmacy_first_count"),
        eps_items: latestFor("eps_items"),
      };

      const fetchPeriod = async (y: number, m: number) => {
        const all = await fetchAll<{ pharmacy_id: string; items_dispensed: number; nms_count: number; pharmacy_first_count: number; eps_items: number }>((from, to) =>
          supabase
            .from("dispensing_data")
            .select("pharmacy_id,items_dispensed,nms_count,pharmacy_first_count,eps_items")
            .eq("year", y).eq("month", m)
            .range(from, to),
        );
        return all.filter((r) => peerIdSet.has(r.pharmacy_id));
      };

      // Cache fetches per (y,m) to avoid duplicate queries when metrics share a period
      const cache = new Map<string, Awaited<ReturnType<typeof fetchPeriod>>>();
      const getRows = async (p: { y: number; m: number } | null) => {
        if (!p) return [];
        const k = `${p.y}-${p.m}`;
        if (!cache.has(k)) cache.set(k, await fetchPeriod(p.y, p.m));
        return cache.get(k) || [];
      };

      const [itemsRows, nmsRows, pfRows, epsRows] = await Promise.all([
        getRows(periods.items_dispensed),
        getRows(periods.nms_count),
        getRows(periods.pharmacy_first_count),
        getRows(periods.eps_items),
      ]);

      setPeerDistribution({
        items_dispensed: itemsRows.map((r) => r.items_dispensed || 0),
        nms_count: nmsRows.map((r) => r.nms_count || 0),
        pharmacy_first_count: pfRows.map((r) => r.pharmacy_first_count || 0),
        eps_items: epsRows.map((r) => r.eps_items || 0),
      });
      setPeerPeriods({
        items_dispensed: periods.items_dispensed ? `${MONTHS[periods.items_dispensed.m - 1]} ${periods.items_dispensed.y}` : "",
        nms_count: periods.nms_count ? `${MONTHS[periods.nms_count.m - 1]} ${periods.nms_count.y}` : "",
        pharmacy_first_count: periods.pharmacy_first_count ? `${MONTHS[periods.pharmacy_first_count.m - 1]} ${periods.pharmacy_first_count.y}` : "",
        eps_items: periods.eps_items ? `${MONTHS[periods.eps_items.m - 1]} ${periods.eps_items.y}` : "",
      });
    })();
  }, [rows, pharmacy]);


  const claimAsMine = async () => {
    if (!user || !pharmacy) {
      navigate({ to: "/login" });
      return;
    }
    await supabase.from("user_pharmacy").delete().eq("user_id", user.id);
    const { error } = await supabase
      .from("user_pharmacy")
      .insert({ user_id: user.id, pharmacy_id: pharmacy.id, is_primary: true });
    if (error) return toast.error(error.message);
    setMyPharmacyId(pharmacy.id);
    setHasUserPharmacy(true);
    toast.success(`${pharmacy.name} set as your pharmacy`);
  };

  const isScotlandPharm = (pharmacy?.country || "").toLowerCase() === "scotland";
  // Latest row with ANY reported activity — used as the headline "as of" date,
  // chart cut-off, and YoY anchor. Applies to all countries; we no longer
  // prefer is_actual_payment because Scottish verified payments lag 2 months
  // behind provisional dispensing data.
  const latestIdx = useMemo(() => {
    if (rows.length === 0) return -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.items_dispensed > 0 || r.pharmacy_first_count > 0 || r.nms_count > 0) return i;
    }
    return rows.length - 1;
  }, [rows]);
  const latest = latestIdx >= 0 ? rows[latestIdx] : undefined;
  const prior = latestIdx > 0 ? rows[latestIdx - 1] : undefined;
  const yoy = useMemo(() => {
    if (!latest) return null;
    return rows.find((r) => r.year === latest.year - 1 && r.month === latest.month) ?? null;
  }, [rows, latest]);

  // Per-metric latest reported row — each metric finds its own most recent
  // non-zero month so a single laggy field doesn't drag everything to a
  // months-old period.
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

  if (loading) {
    return <div className="p-10 text-sm text-muted-foreground">Loading pharmacy…</div>;
  }
  if (!pharmacy) {
    return (
      <div className="p-10 max-w-2xl mx-auto">
        <h1 className="text-xl font-semibold">Pharmacy not found</h1>
        <p className="text-sm text-muted-foreground mt-2">
          No pharmacy with ODS code <span className="font-mono">{odsCode}</span> in our database.
        </p>
        <Link to="/" className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back home
        </Link>
      </div>
    );
  }

  const isMine = myPharmacyId === pharmacy.id;
  const showClaimBanner = user && hasUserPharmacy === false && !bannerDismissed;

  const gbp = (n: number) => "£" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const isScotland = (pharmacy.country || "").toLowerCase() === "scotland";
  const showVerified = isScotland;
  type MetricDef = {
    label: string;
    key: RankKey | "money";
    field: keyof Row;
    format?: (n: number) => string;
  };
  const buildMetric = (m: MetricDef) => {
    const found = latestFor(m.field);
    const row = found?.row ?? latest;
    const p = found?.prior ?? prior ?? undefined;
    const y = found?.yoy ?? yoy ?? undefined;
    return {
      label: m.label,
      key: m.key,
      value: row ? Number(row[m.field]) || 0 : 0,
      prior: p ? Number(p[m.field]) || 0 : 0,
      yoy: y ? Number(y[m.field]) || 0 : 0,
      format: m.format,
      period: row ? `${MONTHS[row.month - 1]} ${row.year}` : "",
    };
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
            { label: "EPS nominations", key: "items_dispensed", field: "eps_nominations" },
            { label: "NMS", key: "nms_count", field: "nms_count" },
            { label: "Pharmacy First", key: "pharmacy_first_count", field: "pharmacy_first_count" },
          ])
    : [];
  const scottishDefs: MetricDef[] = isScotland && latest
    ? [
        { label: "MCR registrations", key: "items_dispensed", field: "mcr_registrations" },
        { label: "MCR items", key: "items_dispensed", field: "mcr_items" },
        { label: "EHC items", key: "items_dispensed", field: "ehc_items" },
        { label: "Methadone items", key: "items_dispensed", field: "methadone_items" },
        { label: "Supervised doses", key: "items_dispensed", field: "supervised_methadone_doses" },
        { label: "Smoking cessation", key: "items_dispensed", field: "smoking_cessation" },
        { label: "Smoking cessation £", key: "money", field: "smoking_cessation_payment", format: gbp },
        { label: "Pharmacy First £", key: "money", field: "pharmacy_first_payment", format: gbp },
        { label: "MCR payment", key: "money", field: "mcr_payment", format: gbp },
        { label: "Gross cost", key: "money", field: "gross_cost", format: gbp },
        { label: "Final NHS payment", key: "money", field: "final_payment", format: gbp },
      ]
    : [];
  const metrics = [...baseDefs, ...scottishDefs].map(buildMetric);

  const tableRows = [...trimmedRows].slice(-24).reverse();

  const backTo = user ? "/dashboard" : "/";
  const backLabel = user ? "Back to dashboard" : "Back home";

  return (
    <>
    <div>
      <div className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="max-w-6xl mx-auto px-4 md:px-10 py-3 flex items-center gap-3">
          <Link
            to={backTo}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground shrink-0"
          >
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">{backLabel}</span>
          </Link>
          <div className="flex-1 min-w-0 max-w-xl ml-auto">
            <PharmacySearch compact placeholder="Search another pharmacy…" />
          </div>
        </div>
      </div>
      <div className="p-6 md:p-10 max-w-6xl mx-auto">

      {showClaimBanner && (
        <div className="mb-6 rounded-lg border border-gold/40 bg-gold/10 p-4 flex items-start gap-3">
          <Star className="h-5 w-5 text-gold shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold">Is this your pharmacy?</p>
            <p className="text-muted-foreground mt-0.5">
              Set it as your default for personalised benchmarking and smart insights.
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={claimAsMine}>Yes, set as mine</Button>
              <Button size="sm" variant="ghost" onClick={() => setBannerDismissed(true)}>Dismiss</Button>
            </div>
          </div>
          <button onClick={() => setBannerDismissed(true)} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{pharmacy.name}</h1>
            {isMine && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 border border-gold/40 px-2.5 py-0.5 text-xs font-semibold text-gold">
                <Star className="h-3 w-3 fill-current" /> Your pharmacy
              </span>
            )}
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
          {user && (
            <Button size="sm" className="gap-1.5" onClick={() => setAnalyseOpen(true)}>
              <Sparkles className="h-4 w-4" /> Analyse This Pharmacy
            </Button>
          )}
          {user && !isMine && !showClaimBanner && (
            <button onClick={claimAsMine} className="text-xs text-primary hover:underline">
              Set as my pharmacy
            </button>
          )}
        </div>
      </div>

      {metrics.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">No dispensing data available for this pharmacy yet.</p>
      ) : (
        <>
          <div className="mt-6 flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold tracking-tight">Headline metrics</h2>
            <p className="text-xs text-muted-foreground italic">
              All figures are monthly totals. Each card shows its latest reported month.
            </p>
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
              />
            ))}
          </div>

          {!showVerified && !hasFp34c && (
            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              Payment data isn't publicly available for this pharmacy.
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MiniChart title="Items dispensed" data={chartData} dataKey="items" />
            {!isScotland && <MiniChart title="EPS items" data={chartData} dataKey="eps_items" />}
            {!isScotland && <MiniChart title="NMS" data={chartData} dataKey="nms" />}
            <MiniChart title="Pharmacy First" data={chartData} dataKey="pf" />
            <MiniChart title="Gross cost (£)" data={chartData} dataKey="cost" />
          </div>

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
                {!isScotland && (
                  <PercentileRail
                    label={`New Medicine Service${peerPeriods.nms_count ? ` · ${peerPeriods.nms_count}` : ""}`}
                    value={latestFor("nms_count")?.row.nms_count ?? latest.nms_count}
                    values={peerDistribution.nms_count}
                    peerLabel={`${pharmacy.country} avg`}
                    nationalLabel="Highest"
                    caption={`NMS interventions versus ${peerDistribution.nms_count.length.toLocaleString()} country peers.`}
                  />
                )}
                {!isScotland && (
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


          {isScotland && latest && (
            <section className="mt-6">
              <ShareDonut
                label={`Payment composition · ${MONTHS[latest.month - 1]} ${latest.year}`}
                caption="Where this month's NHS revenue came from. Pharmacy First, MCR and smoking-cessation are shown as paid fees; dispensing is the residual gross cost minus these service streams."
                formatValue={(n) => "£" + n.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                segments={[
                  { label: "Pharmacy First", value: Number(latest.pharmacy_first_payment) || 0 },
                  { label: "MCR", value: Number(latest.mcr_payment) || 0 },
                  { label: "Smoking cessation", value: Number(latest.smoking_cessation_payment) || 0 },
                  {
                    label: "Dispensing & other",
                    value: Math.max(
                      0,
                      (Number(latest.gross_cost) || 0)
                        - (Number(latest.pharmacy_first_payment) || 0)
                        - (Number(latest.mcr_payment) || 0)
                        - (Number(latest.smoking_cessation_payment) || 0),
                    ),
                  },
                ]}
              />
            </section>
          )}

          <LocalLandscape
            pharmacyName={pharmacy.name}
            postcode={pharmacy.postcode}
            address={pharmacy.address}
          />

          {/* Pharmacy First service mix hidden for now
          {isScotland && latest && latest.pharmacy_first_services && (
            <PFServiceMix
              services={latest.pharmacy_first_services}
              peerAvg={pfPeerAvg}
              peerCount={pfPeerCount}
              region={pharmacy.region}
              period={`${MONTHS[latest.month - 1]} ${latest.year}`}
            />
          )}
          */}

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
                    {!isScotland && <th className="text-right px-3 py-2 font-medium">EPS items</th>}
                    {!isScotland && <th className="text-right px-3 py-2 font-medium">EPS nom.</th>}
                    {!isScotland && <th className="text-right px-3 py-2 font-medium">NMS</th>}
                    <th className="text-right px-3 py-2 font-medium">PF</th>
                    <th className="text-right px-3 py-2 font-medium">PF £</th>
                    {isScotland && <th className="text-right px-3 py-2 font-medium">EHC</th>}
                    {isScotland && <th className="text-right px-3 py-2 font-medium">Meth.</th>}
                    {isScotland && <th className="text-right px-3 py-2 font-medium">Smoke.</th>}
                    {isScotland && <th className="text-right px-3 py-2 font-medium">MCR £</th>}
                    {isScotland && <th className="text-right px-3 py-2 font-medium">Gross £</th>}
                    {isScotland && <th className="text-right px-3 py-2 font-medium">Final £</th>}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => {
                    const fmtGbp = (v: number | string | null) => "£" + (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
                    return (
                      <tr key={`${r.year}-${r.month}`} className="border-t border-border">
                        <td className="px-3 py-2 whitespace-nowrap">{MONTHS[r.month - 1]} {r.year}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.items_dispensed.toLocaleString()}</td>
                        {!isScotland && <td className="px-3 py-2 text-right tabular-nums">{r.eps_items.toLocaleString()}</td>}
                        {!isScotland && <td className="px-3 py-2 text-right tabular-nums">{r.eps_nominations.toLocaleString()}</td>}
                        {!isScotland && <td className="px-3 py-2 text-right tabular-nums">{r.nms_count.toLocaleString()}</td>}
                        <td className="px-3 py-2 text-right tabular-nums">{r.pharmacy_first_count.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtGbp(r.pharmacy_first_payment)}</td>
                        {isScotland && <td className="px-3 py-2 text-right tabular-nums">{r.ehc_items.toLocaleString()}</td>}
                        {isScotland && <td className="px-3 py-2 text-right tabular-nums">{r.methadone_items.toLocaleString()}</td>}
                        {isScotland && <td className="px-3 py-2 text-right tabular-nums">{r.smoking_cessation.toLocaleString()}</td>}
                        {isScotland && <td className="px-3 py-2 text-right tabular-nums">{fmtGbp(r.mcr_payment)}</td>}
                        {isScotland && <td className="px-3 py-2 text-right tabular-nums">{fmtGbp(r.gross_cost)}</td>}
                        {isScotland && <td className="px-3 py-2 text-right tabular-nums">{fmtGbp(r.final_payment)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!user && (
        <div className="mt-8 rounded-lg border border-border bg-secondary/40 p-5 text-sm">
          <p className="font-semibold">Want deeper insights?</p>
          <p className="text-muted-foreground mt-1">
            Create a free PharmInsight account to benchmark, compare, and unlock expert commentary.
          </p>
          <div className="mt-3 flex gap-2">
            <Link to="/register"><Button size="sm">Create account</Button></Link>
            <Link to="/login"><Button size="sm" variant="outline">Sign in</Button></Link>
          </div>
        </div>
      )}
      </div>
    </div>
    {pharmacy && <AnalysisPanel pharmacy={pharmacy} open={analyseOpen} onClose={() => setAnalyseOpen(false)} />}
    </>
  );
}

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

function MetricCard({ label, value, prior, yoy, format, rank, period }: {
  label: string; value: number; prior: number; yoy: number;
  format?: (n: number) => string;
  rank?: { rank: number; total: number };
  period?: string;
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
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground flex-1 min-w-0 truncate">
              {label}
            </p>
            <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", a.chip)}>
              <Icon className="h-3.5 w-3.5" />
            </div>
          </div>

          <p className="relative mt-2 text-[1.55rem] leading-none font-semibold tracking-tight text-foreground tabular-nums">
            {fmt(value)}
          </p>

          {period && (
            <p className="relative mt-1.5 text-[10px] text-muted-foreground">Monthly · {period}</p>
          )}

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

function MiniChart({ title, data, dataKey }: { title: string; data: any[]; dataKey: string }) {
  return (
    <div className="rounded-lg bg-card border border-border p-4 shadow-sm">
      <h3 className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">{title}</h3>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 8, bottom: 0, left: -15 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
            <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
            <Line type="monotone" dataKey={dataKey} stroke="var(--chart-2)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PFServiceMix({
  services, peerAvg, peerCount, region, period,
}: {
  services: Record<string, number>;
  peerAvg: Record<string, number> | null;
  peerCount: number;
  region: string | null;
  period: string;
}) {
  const data = PF_SERVICES.map((s) => ({
    label: s.label,
    you: Number(services[s.key]) || 0,
    peer: peerAvg ? Math.round((peerAvg[s.key] || 0) * 10) / 10 : 0,
  }));
  const total = data.reduce((acc, d) => acc + d.you, 0);
  if (total === 0 && !peerAvg) {
    return (
      <div className="mt-6 rounded-lg bg-card border border-border p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Pharmacy First service mix</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          No Pharmacy First consultations recorded for {period}.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-6 rounded-lg bg-card border border-border p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold">Pharmacy First service mix · {period}</h2>
        <p className="text-xs text-muted-foreground">
          {total.toLocaleString()} consultations
          {peerAvg && region && (
            <> · vs avg of {peerCount.toLocaleString()} peers in {region}</>
          )}
        </p>
      </div>
      <div className="h-72 mt-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 16, bottom: 0, left: 30 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
            <YAxis dataKey="label" type="category" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={140} />
            <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
            <Bar dataKey="you" name="This pharmacy" fill="var(--chart-2)" radius={[0, 4, 4, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={peerAvg && d.you > d.peer ? "var(--chart-1)" : "var(--chart-2)"} />
              ))}
            </Bar>
            {peerAvg && <Bar dataKey="peer" name="Regional avg" fill="var(--muted-foreground)" fillOpacity={0.35} radius={[0, 4, 4, 0]} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {peerAvg && (
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {data.filter((d) => d.you > 0 || d.peer > 0).map((d) => {
            const delta = d.peer > 0 ? Math.round(((d.you - d.peer) / d.peer) * 100) : null;
            return (
              <div key={d.label} className="rounded border border-border bg-secondary/40 px-2 py-1.5">
                <div className="text-muted-foreground">{d.label}</div>
                <div className="font-semibold tabular-nums">
                  {d.you} <span className="text-muted-foreground font-normal">vs {d.peer}</span>
                </div>
                {delta !== null && (
                  <div className={delta >= 0 ? "text-emerald-600" : "text-red-600"}>
                    {delta >= 0 ? "+" : ""}{delta}%
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

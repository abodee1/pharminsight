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
import { TrendingUp, TrendingDown, Minus, ArrowLeft, Star, X, ShieldCheck } from "lucide-react";
import { PharmacySearch } from "@/components/PharmacySearch";

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
      const isScot = (pharmacy?.country || "").toLowerCase() === "scotland";
      let latest = rows[rows.length - 1];
      if (isScot) {
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i].is_actual_payment) { latest = rows[i]; break; }
        }
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
      let latest = rows[rows.length - 1];
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].is_actual_payment) { latest = rows[i]; break; }
      }
      const peers = await supabase
        .from("pharmacies")
        .select("id")
        .eq("country", "Scotland")
        .eq("region", pharmacy.region ?? "");
      const peerIds = (peers.data ?? []).map((p) => p.id);
      if (peerIds.length === 0) { setPfPeerAvg(null); return; }
      // Chunk in 500s to keep URL length sane.
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
  const latestIdx = useMemo(() => {
    if (rows.length === 0) return -1;
    if (isScotlandPharm) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].is_actual_payment) return i;
    }
    return rows.length - 1;
  }, [rows, isScotlandPharm]);
  const latest = latestIdx >= 0 ? rows[latestIdx] : undefined;
  const prior = latestIdx > 0 ? rows[latestIdx - 1] : undefined;
  const yoy = useMemo(() => {
    if (!latest) return null;
    return rows.find((r) => r.year === latest.year - 1 && r.month === latest.month) ?? null;
  }, [rows, latest]);

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
  const baseMetrics: { label: string; key: RankKey | "money"; value: number; prior: number; yoy: number; format?: (n: number) => string }[] = latest
    ? (isScotland
        ? [
            { label: "Items dispensed", key: "items_dispensed", value: latest.items_dispensed, prior: prior?.items_dispensed ?? 0, yoy: yoy?.items_dispensed ?? 0 },
            { label: "Pharmacy First", key: "pharmacy_first_count", value: latest.pharmacy_first_count, prior: prior?.pharmacy_first_count ?? 0, yoy: yoy?.pharmacy_first_count ?? 0 },
          ]
        : [
            { label: "Items dispensed", key: "items_dispensed", value: latest.items_dispensed, prior: prior?.items_dispensed ?? 0, yoy: yoy?.items_dispensed ?? 0 },
            { label: "EPS items", key: "eps_items", value: latest.eps_items, prior: prior?.eps_items ?? 0, yoy: yoy?.eps_items ?? 0 },
            { label: "EPS nominations", key: "items_dispensed", value: latest.eps_nominations, prior: prior?.eps_nominations ?? 0, yoy: yoy?.eps_nominations ?? 0 },
            { label: "NMS", key: "nms_count", value: latest.nms_count, prior: prior?.nms_count ?? 0, yoy: yoy?.nms_count ?? 0 },
            { label: "Pharmacy First", key: "pharmacy_first_count", value: latest.pharmacy_first_count, prior: prior?.pharmacy_first_count ?? 0, yoy: yoy?.pharmacy_first_count ?? 0 },
            { label: "Flu vaccinations", key: "flu_vaccinations", value: latest.flu_vaccinations, prior: prior?.flu_vaccinations ?? 0, yoy: yoy?.flu_vaccinations ?? 0 },
          ])
    : [];
  const scottishMetrics = isScotland && latest
    ? [
        { label: "MCR registrations", key: "items_dispensed" as RankKey, value: latest.mcr_registrations, prior: prior?.mcr_registrations ?? 0, yoy: yoy?.mcr_registrations ?? 0 },
        { label: "MCR items", key: "items_dispensed" as RankKey, value: latest.mcr_items, prior: prior?.mcr_items ?? 0, yoy: yoy?.mcr_items ?? 0 },
        { label: "EHC items", key: "items_dispensed" as RankKey, value: latest.ehc_items, prior: prior?.ehc_items ?? 0, yoy: yoy?.ehc_items ?? 0 },
        { label: "Methadone items", key: "items_dispensed" as RankKey, value: latest.methadone_items, prior: prior?.methadone_items ?? 0, yoy: yoy?.methadone_items ?? 0 },
        { label: "Supervised doses", key: "items_dispensed" as RankKey, value: latest.supervised_methadone_doses, prior: prior?.supervised_methadone_doses ?? 0, yoy: yoy?.supervised_methadone_doses ?? 0 },
        { label: "Smoking cessation", key: "items_dispensed" as RankKey, value: latest.smoking_cessation, prior: prior?.smoking_cessation ?? 0, yoy: yoy?.smoking_cessation ?? 0 },
        { label: "Smoking cessation £", key: "money" as const, value: Number(latest.smoking_cessation_payment) || 0, prior: Number(prior?.smoking_cessation_payment) || 0, yoy: Number(yoy?.smoking_cessation_payment) || 0, format: gbp },
        { label: "Pharmacy First £", key: "money" as const, value: Number(latest.pharmacy_first_payment) || 0, prior: Number(prior?.pharmacy_first_payment) || 0, yoy: Number(yoy?.pharmacy_first_payment) || 0, format: gbp },
        { label: "MCR payment", key: "money" as const, value: Number(latest.mcr_payment) || 0, prior: Number(prior?.mcr_payment) || 0, yoy: Number(yoy?.mcr_payment) || 0, format: gbp },
        { label: "Gross cost", key: "money" as const, value: Number(latest.gross_cost) || 0, prior: Number(prior?.gross_cost) || 0, yoy: Number(yoy?.gross_cost) || 0, format: gbp },
        { label: "Final NHS payment", key: "money" as const, value: Number(latest.final_payment) || 0, prior: Number(prior?.final_payment) || 0, yoy: Number(yoy?.final_payment) || 0, format: gbp },
      ]
    : [];
  const metrics = [...baseMetrics, ...scottishMetrics];

  const tableRows = [...trimmedRows].slice(-24).reverse();

  const backTo = user ? "/dashboard" : "/";
  const backLabel = user ? "Back to dashboard" : "Back home";

  return (
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
        {user && !isMine && !showClaimBanner && (
          <button onClick={claimAsMine} className="text-xs text-primary hover:underline">
            Set as my pharmacy
          </button>
        )}
      </div>

      {metrics.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">No dispensing data available for this pharmacy yet.</p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {metrics.map((m) => (
              <MetricCard
                key={m.label}
                label={m.label}
                value={m.value}
                prior={m.prior}
                yoy={m.yoy}
                format={m.format}
                rank={m.key !== "money" ? ranks[m.key as RankKey] : undefined}
              />
            ))}
          </div>

          {!showVerified && !hasFp34c && (
            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                Payment data isn't publicly available for this pharmacy.
              </span>
              <Link to="/income" className="text-primary font-medium hover:underline whitespace-nowrap">
                View income estimator →
              </Link>
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MiniChart title="Items dispensed" data={chartData} dataKey="items" />
            {!isScotland && <MiniChart title="EPS items" data={chartData} dataKey="eps_items" />}
            {!isScotland && <MiniChart title="NMS" data={chartData} dataKey="nms" />}
            <MiniChart title="Pharmacy First" data={chartData} dataKey="pf" />
            {!isScotland && <MiniChart title="Flu vaccinations" data={chartData} dataKey="flu" />}
            <MiniChart title="Gross cost (£)" data={chartData} dataKey="cost" />
          </div>

          {isScotland && latest && latest.pharmacy_first_services && (
            <PFServiceMix
              services={latest.pharmacy_first_services}
              peerAvg={pfPeerAvg}
              peerCount={pfPeerCount}
              region={pharmacy.region}
              period={`${MONTHS[latest.month - 1]} ${latest.year}`}
            />
          )}

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
                    {!isScotland && <th className="text-right px-3 py-2 font-medium">Flu</th>}
                    {isScotland && <th className="text-right px-3 py-2 font-medium">Flu</th>}
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
                        <td className="px-3 py-2 text-right tabular-nums">{r.flu_vaccinations.toLocaleString()}</td>
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
            Create a free PharmIQ account to benchmark, compare, and unlock expert commentary.
          </p>
          <div className="mt-3 flex gap-2">
            <Link to="/register"><Button size="sm">Create account</Button></Link>
            <Link to="/login"><Button size="sm" variant="outline">Sign in</Button></Link>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, prior, yoy, format, rank }: {
  label: string; value: number; prior: number; yoy: number;
  format?: (n: number) => string;
  rank?: { rank: number; total: number };
}) {
  const fmt = format ?? ((n: number) => n.toLocaleString());
  const delta = prior ? ((value - prior) / prior) * 100 : 0;
  const yoyDelta = yoy ? ((value - yoy) / yoy) * 100 : 0;
  const Icon = delta > 1 ? TrendingUp : delta < -1 ? TrendingDown : Minus;
  const color = delta > 1 ? "text-emerald-600" : delta < -1 ? "text-red-600" : "text-muted-foreground";
  return (
    <div className="rounded-lg bg-card border border-border p-4 shadow-sm">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold">{fmt(value)}</p>
      {prior > 0 && (
        <div className={`mt-1 flex items-center gap-1 text-xs ${color}`}>
          <Icon className="h-3 w-3" />
          {Math.abs(delta).toFixed(1)}% vs prior
        </div>
      )}
      {yoy > 0 && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {yoyDelta >= 0 ? "+" : ""}{yoyDelta.toFixed(1)}% YoY
        </div>
      )}
      {rank && rank.total > 0 && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          Rank #{rank.rank.toLocaleString()} of {rank.total.toLocaleString()}
        </div>
      )}
    </div>
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

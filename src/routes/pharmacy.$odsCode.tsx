import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CountryBadge } from "@/components/CountryBadge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, ArrowLeft, Star, X } from "lucide-react";

export const Route = createFileRoute("/pharmacy/$odsCode")({ component: PharmacyProfile });

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

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
  ehc_items: number; methadone_items: number; smoking_cessation: number;
  final_payment: number | string | null;
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
          .select("month,year,items_dispensed,nms_count,pharmacy_first_count,flu_vaccinations,eps_items,eps_nominations,gross_cost,pharmacy_first_payment,mcr_payment,ehc_items,methadone_items,smoking_cessation,final_payment")
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
      const latest = rows[rows.length - 1];
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
  }, [rows]);

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

  const latest = rows[rows.length - 1];
  const prior = rows[rows.length - 2];
  const yoy = useMemo(() => {
    if (!latest) return null;
    return rows.find((r) => r.year === latest.year - 1 && r.month === latest.month) ?? null;
  }, [rows, latest]);

  const chartData = useMemo(() => rows.slice(-24).map((r) => ({
    label: `${MONTHS[r.month - 1]} ${String(r.year).slice(2)}`,
    items: r.items_dispensed,
    eps_items: r.eps_items,
    nms: r.nms_count,
    pf: r.pharmacy_first_count,
    flu: r.flu_vaccinations,
    cost: Number(r.gross_cost) || 0,
  })), [rows]);

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
  const metrics: { label: string; key: RankKey | "money"; value: number; prior: number; yoy: number; format?: (n: number) => string }[] = latest
    ? [
        { label: "Items dispensed", key: "items_dispensed", value: latest.items_dispensed, prior: prior?.items_dispensed ?? 0, yoy: yoy?.items_dispensed ?? 0 },
        { label: "EPS items", key: "eps_items", value: latest.eps_items, prior: prior?.eps_items ?? 0, yoy: yoy?.eps_items ?? 0 },
        { label: "EPS nominations", key: "items_dispensed", value: latest.eps_nominations, prior: prior?.eps_nominations ?? 0, yoy: yoy?.eps_nominations ?? 0 },
        { label: "NMS", key: "nms_count", value: latest.nms_count, prior: prior?.nms_count ?? 0, yoy: yoy?.nms_count ?? 0 },
        { label: "Pharmacy First", key: "pharmacy_first_count", value: latest.pharmacy_first_count, prior: prior?.pharmacy_first_count ?? 0, yoy: yoy?.pharmacy_first_count ?? 0 },
        { label: "Flu vaccinations", key: "flu_vaccinations", value: latest.flu_vaccinations, prior: prior?.flu_vaccinations ?? 0, yoy: yoy?.flu_vaccinations ?? 0 },
        { label: "EHC items", key: "items_dispensed", value: latest.ehc_items, prior: prior?.ehc_items ?? 0, yoy: yoy?.ehc_items ?? 0 },
        { label: "Methadone items", key: "items_dispensed", value: latest.methadone_items, prior: prior?.methadone_items ?? 0, yoy: yoy?.methadone_items ?? 0 },
        { label: "Smoking cessation", key: "items_dispensed", value: latest.smoking_cessation, prior: prior?.smoking_cessation ?? 0, yoy: yoy?.smoking_cessation ?? 0 },
        { label: "Pharmacy First £", key: "money", value: Number(latest.pharmacy_first_payment) || 0, prior: Number(prior?.pharmacy_first_payment) || 0, yoy: Number(yoy?.pharmacy_first_payment) || 0, format: gbp },
        { label: "MCR payment", key: "money", value: Number(latest.mcr_payment) || 0, prior: Number(prior?.mcr_payment) || 0, yoy: Number(yoy?.mcr_payment) || 0, format: gbp },
        { label: "Gross cost", key: "money", value: Number(latest.gross_cost) || 0, prior: Number(prior?.gross_cost) || 0, yoy: Number(yoy?.gross_cost) || 0, format: gbp },
        { label: "Final payment", key: "money", value: Number(latest.final_payment) || 0, prior: Number(prior?.final_payment) || 0, yoy: Number(yoy?.final_payment) || 0, format: gbp },
      ]
    : [];

  const tableRows = [...rows].slice(-24).reverse();

  return (
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

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MiniChart title="Items dispensed" data={chartData} dataKey="items" />
            <MiniChart title="EPS items" data={chartData} dataKey="eps_items" />
            <MiniChart title="NMS" data={chartData} dataKey="nms" />
            <MiniChart title="Pharmacy First" data={chartData} dataKey="pf" />
            <MiniChart title="Flu vaccinations" data={chartData} dataKey="flu" />
            <MiniChart title="Gross cost (£)" data={chartData} dataKey="cost" />
          </div>

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
                    <th className="text-right px-3 py-2 font-medium">EPS items</th>
                    <th className="text-right px-3 py-2 font-medium">EPS nom.</th>
                    <th className="text-right px-3 py-2 font-medium">NMS</th>
                    <th className="text-right px-3 py-2 font-medium">Pharm. First</th>
                    <th className="text-right px-3 py-2 font-medium">Flu</th>
                    <th className="text-right px-3 py-2 font-medium">Gross cost</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => (
                    <tr key={`${r.year}-${r.month}`} className="border-t border-border">
                      <td className="px-3 py-2 whitespace-nowrap">{MONTHS[r.month - 1]} {r.year}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.items_dispensed.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.eps_items.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.eps_nominations.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.nms_count.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.pharmacy_first_count.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.flu_vaccinations.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">£{(Number(r.gross_cost) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    </tr>
                  ))}
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

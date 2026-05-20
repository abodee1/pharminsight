import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
};

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
          .select("month,year,items_dispensed,nms_count,pharmacy_first_count,flu_vaccinations,eps_items,eps_nominations")
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

  // build latest + prior month metrics
  const latest = rows[rows.length - 1];
  const prior = rows[rows.length - 2];
  const metrics: { label: string; value: number; prior: number }[] = latest
    ? [
        { label: "Items", value: latest.items_dispensed, prior: prior?.items_dispensed ?? 0 },
        { label: "NMS", value: latest.nms_count, prior: prior?.nms_count ?? 0 },
        { label: "Pharmacy First", value: latest.pharmacy_first_count, prior: prior?.pharmacy_first_count ?? 0 },
        { label: "Flu Vaccinations", value: latest.flu_vaccinations, prior: prior?.flu_vaccinations ?? 0 },
        { label: "EPS Items", value: latest.eps_items, prior: prior?.eps_items ?? 0 },
        { label: "EPS Nominations", value: latest.eps_nominations, prior: prior?.eps_nominations ?? 0 },
      ]
    : [];

  const chart = rows.slice(-12).map((r) => ({
    label: `${MONTHS[r.month - 1]} ${String(r.year).slice(2)}`,
    items: r.items_dispensed,
  }));

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
          <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {metrics.map((m) => <MetricCard key={m.label} {...m} />)}
          </div>

          <div className="mt-6 rounded-lg bg-card border border-border p-6 shadow-sm">
            <h2 className="text-sm font-semibold mb-4">Items dispensed — last 12 months</h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 5, right: 12, bottom: 0, left: -10 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
                  <Line type="monotone" dataKey="items" name="Items" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
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

function MetricCard({ label, value, prior }: { label: string; value: number; prior: number }) {
  const delta = prior ? ((value - prior) / prior) * 100 : 0;
  const Icon = delta > 1 ? TrendingUp : delta < -1 ? TrendingDown : Minus;
  const color = delta > 1 ? "text-emerald-600" : delta < -1 ? "text-red-600" : "text-muted-foreground";
  return (
    <div className="rounded-lg bg-card border border-border p-4 shadow-sm">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold">{value.toLocaleString()}</p>
      {prior > 0 && (
        <div className={`mt-1 flex items-center gap-1 text-xs ${color}`}>
          <Icon className="h-3 w-3" />
          {Math.abs(delta).toFixed(1)}% vs prior
        </div>
      )}
    </div>
  );
}

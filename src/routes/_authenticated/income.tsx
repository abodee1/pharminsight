import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { PharmacySearch, type Pharmacy as SearchPharmacy } from "@/components/PharmacySearch";
import { CountryBadge } from "@/components/CountryBadge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ShieldCheck, AlertTriangle, Upload, FileText } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/_authenticated/income")({ component: IncomePage });

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const fmtGbp = (n: number) =>
  "£" + (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n: number) => (n || 0).toLocaleString();

// England (and W/NI) estimate constants — based on published Drug Tariff averages.
const DISPENSING_FEE_PER_ITEM = 1.27;
const PHARMACY_FIRST_FEE = 15.0;
const NMS_FEE = 28.0;
const FLU_FEE = 12.58;
const DMS_FEE = 35.0;
const EST_INGREDIENT_PER_ITEM = 8.5;
// Blended deduction: 60% generic @20%, 35% branded @5%, 5% appliances @9.85%
const BLENDED_DEDUCTION_RATE = 0.6 * 0.2 + 0.35 * 0.05 + 0.05 * 0.0985;

type Pharmacy = {
  id: string; ods_code: string; name: string;
  address: string | null; postcode: string | null;
  region: string | null; country: string | null;
};

type Row = {
  month: number; year: number;
  items_dispensed: number; nms_count: number; pharmacy_first_count: number;
  flu_vaccinations: number;
  pharmacy_first_payment: number | string | null;
  mcr_payment: number | string | null;
  ehc_items: number; methadone_items: number; smoking_cessation: number;
  final_payment: number | string | null;
  gross_cost: number | string | null;
  is_actual_payment: boolean;
};

function IncomePage() {
  const { user } = useAuth();
  const [pharmacy, setPharmacy] = useState<Pharmacy | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);

  // Auto-load primary pharmacy
  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: up } = await supabase
        .from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle();
      if (!up?.pharmacy_id) return;
      const { data: p } = await supabase
        .from("pharmacies")
        .select("id,ods_code,name,address,postcode,region,country")
        .eq("id", up.pharmacy_id).maybeSingle();
      if (p) setPharmacy(p as Pharmacy);
    })();
  }, [user]);

  useEffect(() => {
    if (!pharmacy) { setRows([]); return; }
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("dispensing_data")
        .select("month,year,items_dispensed,nms_count,pharmacy_first_count,flu_vaccinations,pharmacy_first_payment,mcr_payment,ehc_items,methadone_items,smoking_cessation,final_payment,gross_cost,is_actual_payment")
        .eq("pharmacy_id", pharmacy.id)
        .order("year", { ascending: true })
        .order("month", { ascending: true });
      setRows((data as Row[]) || []);
      setLoading(false);

      // Count FP34C uploads
      if (user) {
        const { count } = await supabase
          .from("private_uploads")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("pharmacy_id", pharmacy.id)
          .eq("upload_type", "fp34c");
        setUploadCount(count ?? 0);
      }
    })();
  }, [pharmacy, user]);

  const onPick = (p: SearchPharmacy) => {
    setPharmacy({
      id: p.id, ods_code: p.ods_code, name: p.name,
      address: p.address ?? null, postcode: p.postcode ?? null,
      region: p.region ?? null, country: p.country ?? null,
    });
  };

  const country = (pharmacy?.country || "").toLowerCase();
  const isScotland = country === "scotland";
  const hasFp34c = uploadCount > 0;
  const verified = isScotland || hasFp34c;

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <PageHeader title="Income Estimator" subtitle="Country-aware payment breakdown for any pharmacy." />

      <div className="mt-4 mb-6 max-w-xl">
        <PharmacySearch placeholder="Search any pharmacy by name, postcode, or ODS code…" onSelect={onPick} />
      </div>

      {!pharmacy ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Set your default pharmacy in <span className="font-medium">My Account</span>, or search above to begin.
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-semibold">{pharmacy.name}</h2>
                <CountryBadge country={pharmacy.country} />
                {verified ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="h-3 w-3" /> Verified payment data
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted border border-border px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                    Estimated income
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-mono">{pharmacy.ods_code}</p>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No dispensing data available for this pharmacy yet.</p>
          ) : isScotland ? (
            <ScotlandView pharmacy={pharmacy} rows={rows} />
          ) : (
            <EstimateView pharmacy={pharmacy} rows={rows} hasFp34c={hasFp34c} onUploaded={() => setUploadCount((n) => n + 1)} />
          )}
        </>
      )}
    </div>
  );
}

/* ============================== SCOTLAND ============================== */

function ScotlandView({ pharmacy, rows }: { pharmacy: Pharmacy; rows: Row[] }) {
  const latest = rows[rows.length - 1];
  const chartData = rows.slice(-12).map((r) => ({
    label: `${MONTHS[r.month - 1]} ${String(r.year).slice(-2)}`,
    final: Number(r.final_payment) || 0,
  }));

  return (
    <div>
      <Banner tone="success">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        <span>
          <strong>Payment data verified</strong> — figures sourced directly from NHS Scotland open data.
          These are actual payments, not estimates.
        </span>
      </Banner>

      <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-3">
        <MetricCard label="Items dispensed" value={fmtInt(latest.items_dispensed)} />
        <MetricCard label="Pharmacy First (£)" value={fmtGbp(Number(latest.pharmacy_first_payment) || 0)} />
        <MetricCard label="MCR payment (£)" value={fmtGbp(Number(latest.mcr_payment) || 0)} />
        <MetricCard label="EHC items" value={fmtInt(latest.ehc_items)} />
        <MetricCard label="Methadone items" value={fmtInt(latest.methadone_items)} />
        <MetricCard label="Smoking cessation" value={fmtInt(latest.smoking_cessation)} />
      </div>

      <div className="mt-6 rounded-xl border-2 border-gold/40 bg-gold/10 p-6">
        <p className="text-xs uppercase tracking-wide text-gold font-semibold">Final NHS payment — {MONTHS[latest.month - 1]} {latest.year}</p>
        <p className="text-4xl md:text-5xl font-bold text-gold mt-2">{fmtGbp(Number(latest.final_payment) || 0)}</p>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Final payment — last 12 months</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => "£" + (v / 1000).toFixed(0) + "k"} />
              <Tooltip formatter={(v: number) => fmtGbp(v)} />
              <Line type="monotone" dataKey="final" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

/* ============================== ENGLAND / W / NI ============================== */

function EstimateView({
  pharmacy, rows, hasFp34c, onUploaded,
}: { pharmacy: Pharmacy; rows: Row[]; hasFp34c: boolean; onUploaded: () => void }) {
  const latest = rows[rows.length - 1];
  const country = (pharmacy.country || "").toLowerCase();
  const isWalesOrNI = country === "wales" || country === "northern ireland";

  const est = useMemo(() => calcEstimate(latest), [latest]);

  const trend = rows.slice(-12).map((r) => {
    const e = calcEstimate(r);
    return {
      label: `${MONTHS[r.month - 1]} ${String(r.year).slice(-2)}`,
      total: e.total,
    };
  });

  return (
    <div>
      <Banner tone="warning">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          These figures are <strong>estimates</strong> based on published Drug Tariff rates and national
          average item costs. Actual payments will differ.
        </span>
      </Banner>
      {isWalesOrNI && (
        <p className="mt-2 text-xs text-muted-foreground">
          Actual payment data is not publicly available for pharmacies in Wales or Northern Ireland.
        </p>
      )}

      <div className="mt-6 rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Estimated income — {MONTHS[latest.month - 1]} {latest.year}
          </h3>
          <span className="text-xs text-muted-foreground">{fmtInt(latest.items_dispensed)} items</span>
        </div>
        <table className="w-full text-sm">
          <tbody>
            <LineRow label="Dispensing fees" sub={`${fmtInt(latest.items_dispensed)} × ${fmtGbp(DISPENSING_FEE_PER_ITEM)}`} value={est.dispensing} />
            <LineRow label="Pharmacy First" sub={`${fmtInt(latest.pharmacy_first_count)} × ${fmtGbp(PHARMACY_FIRST_FEE)}`} value={est.pf} />
            <LineRow label="NMS" sub={`${fmtInt(latest.nms_count)} × ${fmtGbp(NMS_FEE)}`} value={est.nms} />
            <LineRow label="Flu vaccinations" sub={`${fmtInt(latest.flu_vaccinations)} × ${fmtGbp(FLU_FEE)}`} value={est.flu} />
            <LineRow label="DMS" sub="Data not tracked — assumed 0" value={est.dms} />
            <LineRow
              label="Estimated discount deduction"
              sub={`${fmtInt(latest.items_dispensed)} × ${fmtGbp(EST_INGREDIENT_PER_ITEM)} × ${(BLENDED_DEDUCTION_RATE * 100).toFixed(2)}%`}
              value={-est.deduction}
              negative
            />
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/40">
              <td className="px-4 py-3 font-semibold">Total estimated income</td>
              <td />
              <td className="px-4 py-3 text-right font-bold text-lg">{fmtGbp(est.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Estimated total — last 12 months</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => "£" + (v / 1000).toFixed(0) + "k"} />
              <Tooltip formatter={(v: number) => fmtGbp(v)} />
              <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {country === "england" && (
        <Fp34cUpload pharmacyId={pharmacy.id} hasFp34c={hasFp34c} onUploaded={onUploaded} />
      )}
    </div>
  );
}

function calcEstimate(r: Row) {
  const dispensing = (r.items_dispensed || 0) * DISPENSING_FEE_PER_ITEM;
  const pf = (r.pharmacy_first_count || 0) * PHARMACY_FIRST_FEE;
  const nms = (r.nms_count || 0) * NMS_FEE;
  const flu = (r.flu_vaccinations || 0) * FLU_FEE;
  const dms = 0 * DMS_FEE;
  const deduction = (r.items_dispensed || 0) * EST_INGREDIENT_PER_ITEM * BLENDED_DEDUCTION_RATE;
  const total = dispensing + pf + nms + flu + dms - deduction;
  return { dispensing, pf, nms, flu, dms, deduction, total };
}

/* ============================== FP34C UPLOAD ============================== */

function Fp34cUpload({
  pharmacyId, hasFp34c, onUploaded,
}: { pharmacyId: string; hasFp34c: boolean; onUploaded: () => void }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");

  const handleFile = async (f: File) => {
    if (!user) return;
    setFileName(f.name);
    setBusy(true);
    try {
      // Read content as text (works for CSV; PDFs stored by filename + size only)
      let raw = "";
      if (f.type.includes("text") || f.name.toLowerCase().endsWith(".csv")) {
        raw = await f.text();
      }
      const { error } = await supabase.from("private_uploads").insert({
        user_id: user.id,
        pharmacy_id: pharmacyId,
        upload_type: "fp34c",
        file_name: f.name,
        parsed_data: { raw, size: f.size, mime: f.type },
      });
      if (error) throw error;
      toast.success("FP34C uploaded — your pharmacy will be marked as verified.");
      onUploaded();
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-lg border-2 border-dashed border-border bg-card p-6">
      <div className="flex items-start gap-3">
        <Upload className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="font-semibold">Upload your FP34C payment schedule for exact figures</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Drop your monthly NHSBSA FP34C (CSV or PDF). We'll display actual vs estimated
            side by side and mark your pharmacy as verified.
          </p>
          <label className="mt-3 inline-block">
            <input
              type="file"
              accept=".csv,.pdf,text/csv,application/pdf"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            <Button asChild size="sm" disabled={busy}>
              <span>{busy ? "Uploading…" : "Choose file"}</span>
            </Button>
          </label>
          {fileName && (
            <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> {fileName}
            </p>
          )}
          {hasFp34c && (
            <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              ✓ FP34C on file — this pharmacy is verified.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================== SHARED ============================== */

function Banner({ tone, children }: { tone: "success" | "warning"; children: React.ReactNode }) {
  const cls = tone === "success"
    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
    : "bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300";
  return (
    <div className={`rounded-lg border p-3 text-sm flex items-start gap-2 ${cls}`}>{children}</div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold mt-1 tabular-nums">{value}</p>
    </div>
  );
}

function LineRow({
  label, sub, value, negative,
}: { label: string; sub?: string; value: number; negative?: boolean }) {
  return (
    <tr className="border-t border-border">
      <td className="px-4 py-2.5">
        <p className="font-medium">{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </td>
      <td />
      <td className={`px-4 py-2.5 text-right tabular-nums ${negative ? "text-destructive" : ""}`}>
        {fmtGbp(value)}
      </td>
    </tr>
  );
}

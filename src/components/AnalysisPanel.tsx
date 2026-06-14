import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { X, Star, Loader2, RefreshCw, AlertTriangle, CheckCircle2, TrendingUp, TrendingDown, Minus, FileText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";
import { confirmCompany, rejectCandidate, searchCompany } from "@/lib/companiesHouse.functions";
import { generateInsight } from "@/lib/insights.functions";
import { RemunerationReport } from "@/components/RemunerationReport";
import { InteractiveTrend } from "@/components/InteractiveTrend";
import { LocationInsights } from "@/components/LocationInsights";
import { pharmacyDisplayName } from "@/lib/pharmacyName";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

type Pharmacy = { id: string; ods_code: string; name: string; trading_name?: string | null; address: string | null; postcode: string | null; region: string | null; country: string | null };
type DRow = {
  month: number; year: number;
  items_dispensed: number; nms_count: number; pharmacy_first_count: number; flu_vaccinations: number;
  eps_items: number; eps_nominations: number;
  mcr_registrations: number; mcr_items: number; ehc_items: number;
  methadone_items: number; supervised_methadone_doses: number; smoking_cessation: number;
  pharmacy_first_payment: number | string | null; mcr_payment: number | string | null;
  smoking_cessation_payment: number | string | null;
  final_payment: number | string | null; is_actual_payment: boolean;
};
type Company = {
  id: string; pharmacy_id: string; company_number: string | null; company_name: string | null;
  company_status: string | null; incorporation_date: string | null; sic_codes: string[] | null;
  registered_address: string | null; registered_postcode: string | null;
  last_accounts_date: string | null; accounts_type: string | null;
  turnover: number | null; gross_profit: number | null; operating_profit: number | null;
  net_profit: number | null; total_payroll: number | null; avg_employees: number | null;
  net_assets: number | null; accounts_year: number | null;
  match_confidence: string | null; matched_by: string | null;
  is_chain: boolean; chain_name: string | null; fetched_at: string | null;
};
type Tab = "overview" | "financials" | "benchmarking" | "acquisition" | "insights";

const gbp = (n: number | null | undefined) => n == null ? "—" : "£" + Math.round(n).toLocaleString();
const pct = (n: number) => `${n.toFixed(1)}%`;

const METRIC_INFO: Record<string, string> = {
  "Items": "Total prescription items dispensed this month. Items are the main driver of NHS pharmacy income — each item earns a dispensing fee (~£1.27) plus reimbursement of the drug cost.",
  "NMS": "New Medicine Service consultations. The NHS pays ~£28 each time a pharmacist supports a patient newly prescribed a medicine for asthma, COPD, hypertension, type 2 diabetes or blood thinners.",
  "Pharmacy First": "NHS England's walk-in clinical service for 7 common conditions (sore throat, UTI, sinusitis, etc.). The NHS pays ~£15 per consultation plus a monthly fixed payment when minimum thresholds are met.",
  "Flu vaccinations": "Seasonal NHS flu jabs delivered in pharmacy. Paid at ~£12.58 per vaccination — a key autumn/winter income stream.",
  "EPS rate": "Percentage of items dispensed via the Electronic Prescription Service rather than paper. Higher EPS means a more efficient workflow, faster reimbursement, and fewer lost scripts. Above 95% is excellent.",
  "MCR registrations": "Patients registered for Medicines: Care & Review — the Scottish chronic medication service. Indicates the size of the active managed caseload.",
  "MCR items": "Items dispensed under the Scottish MCR service this month. A direct proxy for chronic dispensing workload and serial-prescription income.",
  "EHC items": "Emergency hormonal contraception (Plan B / Levonelle) supplied under the Scottish Public Health Service. Each supply attracts a service fee.",
  "Methadone items": "Opioid replacement therapy items dispensed under the Pharmacy Public Health Service — a significant fee-paying workload in many Scottish pharmacies.",
  "Supervised doses": "Methadone or buprenorphine doses consumed under direct pharmacist supervision. Paid per supervised dose — material monthly income for pharmacies with active OST caseloads.",
  "Smoking cessation": "Completed smoking-cessation interventions under the Public Health Service. Each completed episode attracts a service payment.",
  "Turnover": "Total sales income reported to Companies House for the most recent filed year. Includes NHS, private and retail income before any costs.",
  "Gross margin": "Gross profit ÷ turnover. What's left after the cost of goods sold (mainly drug purchases). A typical community pharmacy sits around 30-40%.",
  "Net margin": "Net profit ÷ turnover. What's left after all costs including staff, rent and tax. Community pharmacy averages 2-5%; above 7% is strong.",
  "Total payroll": "Total annual staff cost from the company's accounts — wages, NI and pension. Usually the single largest expense.",
  "Payroll": "Total annual staff cost from the company's accounts — wages, NI and pension. Usually the single largest expense.",
  "Net assets": "The company's assets minus all liabilities at year-end. Negative net assets (net liabilities) is a red flag.",
  "Operating profit": "Profit from trading activities before interest and tax. The cleanest measure of how well the pharmacy is run.",
  "Net profit": "Profit after every cost including tax. What actually flows to the owner.",
  "Conservative · 4x": "Lower-end valuation = EBITDA × 4. Used for pharmacies with declining items, lease risk or single-handed dispensing.",
  "Mid-range · 5x": "Mid-market valuation = EBITDA × 5. The typical going rate for a stable independent community pharmacy.",
  "Premium · 6x": "Premium valuation = EBITDA × 6. Reserved for high-growth, high-margin pharmacies in desirable locations with services income.",
  "Estimated annual NHS income": "Our estimate of the NHS payment this pharmacy receives per year, based on items, NMS, Pharmacy First and flu volumes multiplied by published Drug Tariff rates, less a 5% clawback. For Scotland, actual payment data is used where available.",
  "Actual annual NHS income": "Annualised NHS payment based on verified monthly payment data (Scotland open data or your uploaded FP34C schedules). This is not an estimate.",
};

function FlipCard({ title, value, sub, description, className = "" }: {
  title: string; value: React.ReactNode; sub?: React.ReactNode; description: string; className?: string;
}) {
  const [flipped, setFlipped] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setFlipped((f) => !f)}
      className={`group relative w-full text-left [perspective:1000px] focus:outline-none rounded-xl ${className}`}
      aria-label={`${title}: tap to ${flipped ? "hide" : "show"} description`}
    >
      <div className={`relative h-full min-h-[6.5rem] transition-transform duration-500 [transform-style:preserve-3d] ${flipped ? "[transform:rotateY(180deg)]" : ""}`}>
        <div className="absolute inset-0 rounded-xl border border-border bg-card p-4 [backface-visibility:hidden] group-hover:border-gold/60 transition-colors">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center justify-between gap-2">
            <span className="truncate">{title}</span><span className="text-[9px] opacity-40 group-hover:opacity-100 shrink-0">tap ⓘ</span>
          </p>
          <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
          {sub && <div className="mt-1">{sub}</div>}
        </div>
        <div className="absolute inset-0 rounded-xl border border-gold/50 bg-gold/5 p-4 [backface-visibility:hidden] [transform:rotateY(180deg)] overflow-auto">
          <p className="text-[11px] uppercase tracking-wider text-gold font-semibold">{title}</p>
          <p className="text-xs leading-relaxed mt-1.5 text-foreground/90">{description}</p>
          <p className="text-[10px] text-muted-foreground mt-2">Tap again to flip back.</p>
        </div>
      </div>
    </button>
  );
}

function trendArrow(diff: number) {
  if (diff > 0) return <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />;
  if (diff < 0) return <TrendingDown className="h-3.5 w-3.5 text-rose-600" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

export function AnalysisPanel({ pharmacy, open, onClose }: { pharmacy: Pharmacy; open: boolean; onClose: () => void }) {
  const { user, profile } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [rows, setRows] = useState<DRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [saved, setSaved] = useState<{ id: string; is_shortlisted: boolean } | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoadingRows(true);
    (async () => {
      const { data } = await supabase
        .from("dispensing_data")
        .select("month,year,items_dispensed,nms_count,pharmacy_first_count,flu_vaccinations,eps_items,eps_nominations,mcr_registrations,mcr_items,ehc_items,methadone_items,supervised_methadone_doses,smoking_cessation,pharmacy_first_payment,mcr_payment,smoking_cessation_payment,final_payment,is_actual_payment")
        .eq("pharmacy_id", pharmacy.id)
        .order("year").order("month");
      setRows((data as DRow[]) || []);
      setLoadingRows(false);
    })();
    if (user) {
      supabase.from("saved_analyses").select("id,is_shortlisted").eq("user_id", user.id).eq("pharmacy_id", pharmacy.id).maybeSingle()
        .then(({ data }) => setSaved(data));
    }
  }, [open, pharmacy.id, user]);

  const role = (profile?.role || "").toLowerCase();
  const canAcquire = role.includes("owner") || role.includes("consultant");

  const saveAnalysis = async () => {
    if (!user) return toast.error("Sign in to save");
    if (saved) return toast.info("Already saved");
    const { data, error } = await supabase.from("saved_analyses")
      .insert({ user_id: user.id, pharmacy_id: pharmacy.id }).select("id,is_shortlisted").maybeSingle();
    if (error) return toast.error(error.message);
    setSaved(data);
    toast.success("Saved to My Analyses");
  };
  const toggleShortlist = async () => {
    if (!user) return toast.error("Sign in to shortlist");
    if (!saved) {
      const { data, error } = await supabase.from("saved_analyses")
        .insert({ user_id: user.id, pharmacy_id: pharmacy.id, is_shortlisted: true })
        .select("id,is_shortlisted").maybeSingle();
      if (error) return toast.error(error.message);
      setSaved(data);
      toast.success("Added to shortlist");
      return;
    }
    const { data, error } = await supabase.from("saved_analyses")
      .update({ is_shortlisted: !saved.is_shortlisted }).eq("id", saved.id)
      .select("id,is_shortlisted").maybeSingle();
    if (error) return toast.error(error.message);
    setSaved(data);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose} />
      <aside className="w-full md:w-[85%] bg-background border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <header className="flex items-center gap-2 border-b border-border px-3 md:px-6 py-2.5 sticky top-0 bg-background z-10">
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-base md:text-lg truncate">{pharmacyDisplayName(pharmacy.name, pharmacy.trading_name, pharmacy.ods_code)}</h2>
            <p className="text-[11px] md:text-xs text-muted-foreground truncate">{pharmacy.address} · {pharmacy.postcode}</p>
          </div>
          <Button variant="outline" size="sm" onClick={saveAnalysis} className="hidden sm:inline-flex">{saved ? "Saved" : "Save"}</Button>
          <Button variant={saved?.is_shortlisted ? "default" : "outline"} size="sm" onClick={toggleShortlist} className="gap-1.5 px-2 sm:px-3">
            <Star className={"h-4 w-4 " + (saved?.is_shortlisted ? "fill-current" : "")} />
            <span className="hidden md:inline">Shortlist</span>
          </Button>
          <button onClick={saveAnalysis} className="sm:hidden p-2 rounded-md hover:bg-secondary" aria-label="Save">
            <FileText className="h-5 w-5" />
          </button>
          <button onClick={onClose} className="p-2 rounded-md hover:bg-secondary" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>
        <div className="border-b border-border px-3 md:px-6 flex gap-1 overflow-x-auto sticky top-[49px] md:top-[57px] bg-background z-10">
          {(["overview","financials","benchmarking","acquisition","insights"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={["px-3 md:px-4 py-2.5 md:py-3 text-xs md:text-sm font-medium capitalize whitespace-nowrap transition-colors border-b-2",
                tab === t ? "border-gold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"].join(" ")}>
              {t === "insights"
                ? <><Sparkles className="inline h-3.5 w-3.5 mr-1 align-middle text-gold" /><span className="align-middle">Insights</span></>
                : t}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingRows ? (
            <div className="p-10 text-center text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Loading data…</div>
          ) : (
            <>
              {tab === "overview" && <OverviewTab pharmacy={pharmacy} rows={rows} />}
              {tab === "financials" && <FinancialsTab pharmacy={pharmacy} />}
              {tab === "benchmarking" && <BenchmarkingTab pharmacy={pharmacy} rows={rows} />}
              {tab === "insights" && <InsightsTab pharmacy={pharmacy} rows={rows} />}
              {tab === "acquisition" && (canAcquire ? <AcquisitionTab pharmacy={pharmacy} rows={rows} /> :
                <div className="p-10 text-center">
                  <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-8">
                    <FileText className="h-8 w-8 mx-auto text-gold mb-3" />
                    <p className="font-semibold">Acquisition tools locked</p>
                    <p className="text-sm text-muted-foreground mt-2">Available for pharmacy owners and consultants. Update your role in settings.</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

// ------------------------- OVERVIEW TAB -------------------------
function OverviewTab({ pharmacy, rows }: { pharmacy: Pharmacy; rows: DRow[] }) {
  const isScot = (pharmacy.country || "").toLowerCase() === "scotland";

  const latestIdx = useMemo(() => {
    if (!rows.length) return -1;
    if (isScot) for (let i = rows.length - 1; i >= 0; i--) if (rows[i].is_actual_payment) return i;
    // skip trailing all-zero rows
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.items_dispensed > 0 || r.pharmacy_first_count > 0 || r.nms_count > 0) return i;
    }
    return rows.length - 1;
  }, [rows, isScot]);

  const latest = latestIdx >= 0 ? rows[latestIdx] : undefined;
  const prior = latestIdx > 0 ? rows[latestIdx - 1] : undefined;

  const last12 = useMemo(() => rows.slice(Math.max(0, latestIdx - 11), latestIdx + 1), [rows, latestIdx]);
  const chartData = useMemo(() => last12.map((r, i, arr) => {
    const prev = i > 0 ? arr[i - 1].items_dispensed : r.items_dispensed;
    const change = prev ? Math.abs((r.items_dispensed - prev) / prev) : 0;
    return { label: `${MONTHS[r.month - 1]} ${String(r.year).slice(2)}`, items: r.items_dispensed, flag: change > 0.15 };
  }), [last12]);

  const epsRate = latest && latest.items_dispensed ? (latest.eps_items / latest.items_dispensed) * 100 : 0;
  const epsColor = epsRate > 95 ? "text-emerald-600" : epsRate >= 80 ? "text-amber-600" : "text-rose-600";

  const last6Nominations = rows.slice(Math.max(0, latestIdx - 5), latestIdx + 1).map((r) => ({ x: `${r.month}/${String(r.year).slice(2)}`, v: r.eps_nominations }));

  const cards = latest ? (isScot ? [
    { label: "Items", v: latest.items_dispensed, p: prior?.items_dispensed ?? 0 },
    { label: "Pharmacy First", v: latest.pharmacy_first_count, p: prior?.pharmacy_first_count ?? 0 },
    { label: "MCR registrations", v: latest.mcr_registrations, p: prior?.mcr_registrations ?? 0 },
    { label: "MCR items", v: latest.mcr_items, p: prior?.mcr_items ?? 0 },
    { label: "Methadone items", v: latest.methadone_items, p: prior?.methadone_items ?? 0 },
    { label: "Supervised doses", v: latest.supervised_methadone_doses, p: prior?.supervised_methadone_doses ?? 0 },
    { label: "EHC items", v: latest.ehc_items, p: prior?.ehc_items ?? 0 },
    { label: "Smoking cessation", v: latest.smoking_cessation, p: prior?.smoking_cessation ?? 0 },
  ] : [
    { label: "Items", v: latest.items_dispensed, p: prior?.items_dispensed ?? 0 },
    { label: "NMS", v: latest.nms_count, p: prior?.nms_count ?? 0 },
    { label: "Pharmacy First", v: latest.pharmacy_first_count, p: prior?.pharmacy_first_count ?? 0 },
    { label: "Flu vaccinations", v: latest.flu_vaccinations, p: prior?.flu_vaccinations ?? 0 },
  ]) : [];


  if (!latest) return <div className="p-10 text-center text-sm text-muted-foreground">No dispensing data yet.</div>;

  return (
    <div className="p-3 md:p-6 space-y-5 md:space-y-6">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center text-[11px] md:text-xs rounded-full bg-secondary px-2.5 py-1">Data current to {MONTHS[latest.month - 1]} {latest.year}</span>
      </div>

      <InteractiveTrend
        rows={rows as any}
        available={isScot
          ? ["items", "pf", "eps", "final"]
          : ["items", "pf", "nms", "eps", "final"]}
        windows={[6, 12, 18, 24]}
        initialWindow={12}
        title="Performance over time"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => {
          const diff = c.v - c.p;
          const pctv = c.p ? Math.round((diff / c.p) * 100) : 0;
          return (
            <FlipCard
              key={c.label}
              title={c.label}
              value={c.v.toLocaleString()}
              sub={<p className="flex items-center gap-1 text-xs">{trendArrow(diff)} <span className={diff > 0 ? "text-emerald-700" : diff < 0 ? "text-rose-700" : "text-muted-foreground"}>{diff === 0 ? "—" : `${diff > 0 ? "+" : ""}${pctv}% vs prior`}</span></p>}
              description={METRIC_INFO[c.label] || ""}
            />
          );
        })}
      </div>

      {isScot ? (
        <div className="grid md:grid-cols-2 gap-4">
          <FlipCard
            title="Pharmacy First £ (latest)"
            value={gbp(Number(latest.pharmacy_first_payment) || 0)}
            sub={<p className="text-xs text-muted-foreground">Verified NHS payment</p>}
            description="Total NHS payment received for Pharmacy First consultations and the associated fixed monthly fee."
          />
          <FlipCard
            title="MCR payment (latest)"
            value={gbp(Number(latest.mcr_payment) || 0)}
            sub={<p className="text-xs text-muted-foreground">Verified NHS payment</p>}
            description="Total NHS payment received for the Medicines: Care & Review service this month."
          />
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          <FlipCard
            title="EPS rate"
            value={<span className={epsColor}>{pct(epsRate)}</span>}
            sub={<p className="text-xs text-muted-foreground">{">"}95% green · 80-95% amber · {"<"}80% red</p>}
            description={METRIC_INFO["EPS rate"]}
          />
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Nominations (6m)</p>
            <div className="h-16"><ResponsiveContainer><LineChart data={last6Nominations}><Line type="monotone" dataKey="v" stroke="var(--gold)" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>
          </div>
        </div>
      )}


      <LocationInsights
        pharmacyId={pharmacy.id}
        pharmacyName={pharmacyDisplayName(pharmacy.name, pharmacy.trading_name, pharmacy.ods_code)}
        postcode={pharmacy.postcode}
        address={pharmacy.address}
      />

      <RemunerationReport pharmacy={pharmacy} rows={rows} />
    </div>
  );
}

// ------------------------- FINANCIALS TAB -------------------------
function FinancialsTab({ pharmacy }: { pharmacy: Pharmacy }) {
  const search = useServerFn(searchCompany);
  const confirm = useServerFn(confirmCompany);
  const reject = useServerFn(rejectCandidate);
  const [state, setState] = useState<"loading" | "cached" | "chain" | "candidates" | "none" | "confirming" | "confirmed" | "error">("loading");
  const [company, setCompany] = useState<Company | null>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [chain, setChain] = useState<{ company_number: string; chain_name: string } | null>(null);
  const [error, setError] = useState<string>("");

  const runSearch = async () => {
    setState("loading");
    try {
      const r = await search({ data: { pharmacy_id: pharmacy.id, pharmacy_name: pharmacy.name, postcode: pharmacy.postcode } });
      if (r.cached && r.data) { setCompany(r.data as Company); setState("cached"); return; }
      if (r.chain) { setChain(r.chain); setState("chain"); return; }
      if (r.error) { setError(r.error); setState("error"); return; }
      if (r.candidates && r.candidates.length) { setCandidates(r.candidates); setState("candidates"); return; }
      setState("none");
    } catch (e: any) { setError(e.message || "Search failed"); setState("error"); }
  };

  useEffect(() => { runSearch(); /* eslint-disable-next-line */ }, [pharmacy.id]);

  const handleConfirm = async (company_number: string, is_chain = false, chain_name?: string) => {
    setState("confirming");
    try {
      const r = await confirm({ data: { pharmacy_id: pharmacy.id, company_number, is_chain, chain_name } });
      setCompany(r.data as Company);
      setState("confirmed");
      toast.success("Accounts fetched");
    } catch (e: any) { setError(e.message); setState("error"); toast.error(e.message); }
  };

  const handleReject = async (company_number: string) => {
    await reject({ data: { pharmacy_id: pharmacy.id, company_number } });
    setCandidates((c) => c.filter((x) => x.company_number !== company_number));
    if (candidates.length <= 1) setState("none");
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {state === "loading" && <div className="text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Searching Companies House records…</div>}

      {state === "chain" && chain && (
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm">Matched to <span className="font-semibold">{chain.chain_name}</span> (Companies House: <span className="font-mono">{chain.company_number}</span>)</p>
          <Button className="mt-3" onClick={() => handleConfirm(chain.company_number, true, chain.chain_name)}>Confirm and fetch accounts</Button>
        </div>
      )}

      {state === "candidates" && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-base font-semibold">Confirm the registered company</h3>
          <p className="text-sm text-muted-foreground mt-1">We need to match this pharmacy to its Companies House filing.</p>
          <div className="mt-4 space-y-3">
            {candidates.map((c) => {
              const conf = c.score >= 6 ? "Strong match" : c.score >= 3 ? "Possible match" : "Weak match";
              return (
                <div key={c.company_number} className="rounded-lg border border-border p-3">
                  <p className="font-semibold">{c.company_name}</p>
                  <p className="text-xs text-muted-foreground">{c.address}</p>
                  <div className="flex items-center gap-2 text-xs mt-1">
                    <span className="font-mono">{c.company_number}</span>
                    <span className="rounded px-2 py-0.5 bg-secondary">{c.company_status}</span>
                    <span className="ml-auto">{conf} ({c.score})</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => handleConfirm(c.company_number)}>This is correct</Button>
                    <Button size="sm" variant="outline" onClick={() => handleReject(c.company_number)}>Not this one</Button>
                  </div>
                </div>
              );
            })}
            <Button variant="ghost" size="sm" onClick={() => setState("none")}>None of these — skip financials</Button>
          </div>
        </div>
      )}

      {state === "confirming" && <div className="text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Fetching accounts…</div>}

      {(state === "cached" || state === "confirmed") && company && <CompanyDisplay company={company} onRefresh={runSearch} />}

      {state === "none" && (
        <div className="rounded-xl border border-border bg-secondary/40 p-5">
          <p className="text-sm">Financial data unavailable. Go to the Financials tab to confirm the Companies House match for this pharmacy.</p>
        </div>
      )}

      {state === "error" && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-sm">
          <p className="font-medium">Lookup failed</p>
          <p className="text-muted-foreground mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={runSearch}>Retry</Button>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">Source: Companies House public filing · Open Government Licence</p>
    </div>
  );
}

function CompanyDisplay({ company, onRefresh }: { company: Company; onRefresh: () => void }) {
  const hasFigures = company.turnover != null;
  const ageMonths = company.last_accounts_date ? Math.round((Date.now() - new Date(company.last_accounts_date).getTime()) / (30 * 24 * 3600 * 1000)) : null;
  const grossMargin = company.turnover && company.gross_profit ? (company.gross_profit / company.turnover) * 100 : null;
  const netMargin = company.turnover && company.net_profit ? (company.net_profit / company.turnover) * 100 : null;
  return (
    <div className="space-y-4">
      {company.is_chain && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-900 p-3 text-sm">
          This is a {company.chain_name} branch. Figures below represent the entire {company.chain_name} group.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs rounded-full bg-secondary px-2.5 py-1">{company.accounts_type || "Accounts"} · {company.accounts_year ?? "—"}</span>
        {ageMonths !== null && ageMonths > 18 && (
          <span className="text-xs rounded-full bg-amber-100 text-amber-900 px-2.5 py-1">Accounts {ageMonths} months old</span>
        )}
        <span className="text-xs rounded-full bg-secondary px-2.5 py-1">{company.company_status}</span>
        <button onClick={onRefresh} className="ml-auto text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><RefreshCw className="h-3 w-3" /> Refresh</button>
      </div>
      <p className="text-sm text-muted-foreground">{company.company_name} · <span className="font-mono">{company.company_number}</span> · {company.registered_address}</p>

      {hasFigures ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Cell label="Turnover" v={gbp(company.turnover)} />
            <Cell label="Gross margin" v={grossMargin != null ? pct(grossMargin) : "—"} />
            <Cell label="Net margin" v={netMargin != null ? pct(netMargin) : "—"} />
            <Cell label="Total payroll" v={gbp(company.total_payroll)} />
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-border bg-card p-5">
          <Cell label="Net assets" v={gbp(company.net_assets)} />
          <p className="text-xs text-muted-foreground mt-3">This company files small/abbreviated accounts. Turnover and profit are not publicly available, or we could not parse them from the filing.</p>
        </div>
      )}
    </div>
  );
}

function Cell({ label, v }: { label: string; v: string }) {
  return <FlipCard title={label} value={v} description={METRIC_INFO[label] || "No description available for this metric yet."} />;
}

// ------------------------- BENCHMARKING TAB -------------------------
function BenchmarkingTab({ pharmacy, rows }: { pharmacy: Pharmacy; rows: DRow[] }) {
  const [localAvg, setLocalAvg] = useState<Record<string, number>>({});
  const [nationalAvg, setNationalAvg] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);


  const isScot = (pharmacy.country || "").toLowerCase() === "scotland";
  const latestIdx = useMemo(() => {
    if (!rows.length) return -1;
    if (isScot) for (let i = rows.length - 1; i >= 0; i--) if (rows[i].is_actual_payment) return i;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.items_dispensed > 0 || r.pharmacy_first_count > 0 || r.nms_count > 0) return i;
    }
    return rows.length - 1;
  }, [rows, isScot]);
  const latest = latestIdx >= 0 ? rows[latestIdx] : undefined;

  const SCOT_COLS = ["items_dispensed","pharmacy_first_count","mcr_registrations","mcr_items","methadone_items","supervised_methadone_doses","ehc_items","smoking_cessation"] as const;
  const ENG_COLS = ["items_dispensed","nms_count","pharmacy_first_count","eps_items"] as const;

  useEffect(() => {
    if (!latest) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      const y = latest.year, m = latest.month;
      const cols = (isScot ? SCOT_COLS : ENG_COLS).join(",");

      async function avgFor(filter: (q: any) => any) {
        const base = filter(supabase.from("pharmacies").select("id"));
        const { data: peers } = await base;
        const ids = (peers || []).map((p: any) => p.id);
        if (!ids.length) return { count: 0, sums: {} as Record<string, number> };
        const sums: Record<string, number> = {};
        let count = 0;
        for (let i = 0; i < ids.length; i += 500) {
          const { data } = await supabase.from("dispensing_data")
            .select(cols).eq("year", y).eq("month", m)
            .in("pharmacy_id", ids.slice(i, i + 500));
          for (const r of (data || []) as any[]) {
            count++;
            for (const c of (isScot ? SCOT_COLS : ENG_COLS)) sums[c] = (sums[c] || 0) + (Number(r[c]) || 0);
          }
        }
        return { count, sums };
      }

      const local = await avgFor((q) => q.eq("country", pharmacy.country ?? "").eq("region", pharmacy.region ?? ""));
      const nat = await avgFor((q) => q.eq("country", pharmacy.country ?? ""));
      const toAvg = (r: { count: number; sums: Record<string, number> }) => {
        const out: Record<string, number> = {};
        if (!r.count) return out;
        for (const c of (isScot ? SCOT_COLS : ENG_COLS)) out[c] = (r.sums[c] || 0) / r.count;
        return out;
      };
      setLocalAvg(toAvg(local));
      setNationalAvg(toAvg(nat));
      setLoading(false);
    })();
  }, [pharmacy, latest, isScot]);

  if (!latest) return <div className="p-10 text-sm text-muted-foreground text-center">No data.</div>;
  if (loading) return <div className="p-10 text-sm text-muted-foreground text-center"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Computing benchmarks…</div>;

  const rowsTable = isScot ? [
    { label: "Items dispensed", self: latest.items_dispensed, local: localAvg.items_dispensed || 0, nat: nationalAvg.items_dispensed || 0 },
    { label: "Pharmacy First", self: latest.pharmacy_first_count, local: localAvg.pharmacy_first_count || 0, nat: nationalAvg.pharmacy_first_count || 0 },
    { label: "MCR registrations", self: latest.mcr_registrations, local: localAvg.mcr_registrations || 0, nat: nationalAvg.mcr_registrations || 0 },
    { label: "MCR items", self: latest.mcr_items, local: localAvg.mcr_items || 0, nat: nationalAvg.mcr_items || 0 },
    { label: "Methadone items", self: latest.methadone_items, local: localAvg.methadone_items || 0, nat: nationalAvg.methadone_items || 0 },
    { label: "Supervised doses", self: latest.supervised_methadone_doses, local: localAvg.supervised_methadone_doses || 0, nat: nationalAvg.supervised_methadone_doses || 0 },
    { label: "EHC items", self: latest.ehc_items, local: localAvg.ehc_items || 0, nat: nationalAvg.ehc_items || 0 },
    { label: "Smoking cessation", self: latest.smoking_cessation, local: localAvg.smoking_cessation || 0, nat: nationalAvg.smoking_cessation || 0 },
  ] : [
    { label: "Items dispensed", self: latest.items_dispensed, local: localAvg.items_dispensed || 0, nat: nationalAvg.items_dispensed || 0 },
    { label: "NMS", self: latest.nms_count, local: localAvg.nms_count || 0, nat: nationalAvg.nms_count || 0 },
    { label: "Pharmacy First", self: latest.pharmacy_first_count, local: localAvg.pharmacy_first_count || 0, nat: nationalAvg.pharmacy_first_count || 0 },
    { label: "EPS items", self: latest.eps_items, local: localAvg.eps_items || 0, nat: nationalAvg.eps_items || 0 },
  ];

  const colorFor = (self: number, ref: number) => {
    if (!ref) return "";
    const pct = ((self - ref) / ref) * 100;
    if (pct > 10) return "bg-emerald-50 text-emerald-900";
    if (pct < -10) return "bg-rose-50 text-rose-900";
    return "bg-amber-50 text-amber-900";
  };

  const radar = rowsTable.slice(0, 6).map((r) => ({ metric: r.label, you: r.nat ? Math.round((r.self / r.nat) * 100) : 0, nat: 100 }));

  // Deterministic narrative — strongest / weakest vs national, plus headline takeaway
  const ranked = rowsTable
    .filter((r) => r.nat > 0)
    .map((r) => ({ ...r, idx: (r.self / r.nat) * 100, gap: ((r.self - r.nat) / r.nat) * 100 }))
    .sort((a, b) => b.idx - a.idx);
  const strongest = ranked.slice(0, 2).filter((r) => r.gap > 0);
  const weakest = ranked.slice(-2).filter((r) => r.gap < 0).reverse();
  const overallIdx = ranked.length ? Math.round(ranked.reduce((s, r) => s + r.idx, 0) / ranked.length) : 0;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-muted-foreground"><tr>
            <th className="text-left px-4 py-2 font-medium">Metric</th>
            <th className="text-right px-4 py-2 font-medium">This pharmacy</th>
            <th className="text-right px-4 py-2 font-medium">{pharmacy.region || "Region"}</th>
            <th className="text-right px-4 py-2 font-medium">National</th>
          </tr></thead>
          <tbody>
            {rowsTable.map((r) => (
              <tr key={r.label} className="border-t border-border">
                <td className="px-4 py-2 font-medium">{r.label}</td>
                <td className={"px-4 py-2 text-right tabular-nums " + colorFor(r.self, r.nat)}>{Math.round(r.self).toLocaleString()}</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{Math.round(r.local).toLocaleString()}</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{Math.round(r.nat).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold mb-3">Shape vs national (100 = national average)</h3>
        <div className="h-64"><ResponsiveContainer><RadarChart data={radar}>
          <PolarGrid stroke="var(--border)" /><PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
          <PolarRadiusAxis tick={{ fontSize: 10 }} angle={30} />
          <Radar name="You" dataKey="you" stroke="var(--gold)" fill="var(--gold)" fillOpacity={0.25} />
          <Radar name="National" dataKey="nat" stroke="var(--muted-foreground)" fill="var(--muted-foreground)" fillOpacity={0.08} />
          <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
        </RadarChart></ResponsiveContainer></div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold mb-3">Benchmarking assessment</h3>
        <p className="text-sm leading-relaxed">
          Overall index: <span className="font-semibold">{overallIdx}</span> vs national 100.
          {overallIdx >= 110 && " This pharmacy trades materially above the national pace across most measured services."}
          {overallIdx < 110 && overallIdx >= 90 && " This pharmacy tracks broadly in line with the national pace."}
          {overallIdx < 90 && " This pharmacy is trading meaningfully below the national pace — material upside if service uptake is closed."}
        </p>
        {strongest.length > 0 && (
          <div className="mt-3 text-sm">
            <p className="font-medium text-emerald-800">Strongest vs national:</p>
            <ul className="mt-1 space-y-1">
              {strongest.map((r) => (
                <li key={r.label} className="text-sm">• <span className="font-medium">{r.label}</span> — {r.gap > 0 ? "+" : ""}{r.gap.toFixed(0)}% vs national average.</li>
              ))}
            </ul>
          </div>
        )}
        {weakest.length > 0 && (
          <div className="mt-3 text-sm">
            <p className="font-medium text-rose-800">Largest gaps to close:</p>
            <ul className="mt-1 space-y-1">
              {weakest.map((r) => (
                <li key={r.label} className="text-sm">• <span className="font-medium">{r.label}</span> — {r.gap.toFixed(0)}% vs national average. Closing this to peer parity would meaningfully lift service remuneration.</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// -------- Income composition donut --------
function IncomeDonut({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (!total) return null;
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90 shrink-0">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--secondary)" strokeWidth="14" />
        {segments.filter(s => s.value > 0).map((s, i) => {
          const len = (s.value / total) * c;
          const seg = (
            <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={s.color} strokeWidth="14"
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />
          );
          offset += len;
          return seg;
        })}
      </svg>
      <div className="space-y-1.5 text-xs">
        {segments.filter(s => s.value > 0).map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-semibold ml-2">{Math.round((s.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------- ACQUISITION TAB -------------------------
function AcquisitionTab({ pharmacy, rows }: { pharmacy: Pharmacy; rows: DRow[] }) {
  const [company, setCompany] = useState<Company | null>(null);
  const [manualPrivateIncome, setManualPrivateIncome] = useState<number | "">("");
  const [catchment, setCatchment] = useState<{
    competitors: number;
    gpFeeders: number;
    listSizeTotal: number;
    peerRankPct: number | null;
    nearest: { name: string; distance_m: number } | null;
  } | null>(null);

  useEffect(() => {
    supabase.from("companies").select("*").eq("pharmacy_id", pharmacy.id).maybeSingle()
      .then(({ data }) => setCompany(data as Company | null));
  }, [pharmacy.id]);

  useEffect(() => {
    (async () => {
      const { data: ph } = await supabase.from("pharmacies").select("lat,lng,country,region").eq("id", pharmacy.id).maybeSingle();
      if (!ph?.lat || !ph?.lng) return;
      const [{ data: nearPh }, { data: nearGp }, { data: peers }] = await Promise.all([
        supabase.rpc("pharmacies_near", { p_lat: ph.lat, p_lng: ph.lng, p_radius_m: 1600, p_limit: 50 }),
        supabase.rpc("gp_practices_near", { p_lat: ph.lat, p_lng: ph.lng, p_radius_m: 1600, p_limit: 30 }),
        supabase.rpc("pharmacies_near", { p_lat: ph.lat, p_lng: ph.lng, p_radius_m: 5000, p_limit: 200 }),
      ]);
      const compRows = (nearPh || []).filter((p: any) => p.id !== pharmacy.id);
      const nearest = compRows.length ? { name: compRows[0].name, distance_m: compRows[0].distance_m } : null;

      const peerIds = (peers || []).map((p: any) => p.id);
      let peerRankPct: number | null = null;
      if (peerIds.length > 5 && rows.length) {
        const latestRow = [...rows].reverse().find((r) => r.items_dispensed > 0);
        if (latestRow) {
          const { data: peerData } = await supabase.from("dispensing_data")
            .select("pharmacy_id,items_dispensed")
            .in("pharmacy_id", peerIds).eq("year", latestRow.year).eq("month", latestRow.month);
          const vals = (peerData || []).map((d: any) => d.items_dispensed || 0).filter((v) => v > 0);
          if (vals.length > 3) {
            const below = vals.filter((v) => v < latestRow.items_dispensed).length;
            peerRankPct = Math.round((below / vals.length) * 100);
          }
        }
      }

      let listSizeTotal = 0;
      const codes = (nearGp || []).map((g: any) => g.practice_code);
      if (codes.length) {
        const { data: ls } = await supabase.from("gp_list_sizes")
          .select("practice_code,registered_patients,list_size_date").in("practice_code", codes)
          .order("list_size_date", { ascending: false }).limit(codes.length * 3);
        const seen = new Set<string>();
        for (const r of ((ls as any[]) || [])) {
          if (seen.has(r.practice_code)) continue;
          seen.add(r.practice_code);
          listSizeTotal += r.registered_patients || 0;
        }
      }

      setCatchment({ competitors: compRows.length, gpFeeders: (nearGp || []).length, listSizeTotal, peerRankPct, nearest });
    })().catch(() => {});
  }, [pharmacy.id, rows]);

  const isScot = (pharmacy.country || "").toLowerCase() === "scotland";
  const isEngland = (pharmacy.country || "").toLowerCase() === "england";
  const last12 = rows.slice(-12);
  const NMS_RATE = 21; // changed April 2025 (£11 intervention + £10 follow-up)

  let itemsTotal = 0, pfTotal = 0, nmsTotal = 0, fluTotal = 0;
  last12.forEach((r) => { itemsTotal += r.items_dispensed; pfTotal += r.pharmacy_first_count; nmsTotal += r.nms_count; fluTotal += r.flu_vaccinations; });
  const estimated = itemsTotal * 1.27 + pfTotal * 15 + nmsTotal * NMS_RATE + fluTotal * 12.58;
  const estimatedNet = estimated * 0.95;

  let actualNHS: number | null = null;
  if (isScot) {
    const actuals = last12.filter((r) => r.is_actual_payment);
    if (actuals.length >= 6) actualNHS = actuals.reduce((s, r) => s + (Number(r.final_payment) || 0), 0) * (12 / actuals.length);
  }
  const nhsIncome = actualNHS ?? estimatedNet;
  const avgMonthlyIncome = nhsIncome / 12;
  const incomeLabel = actualNHS != null ? "Actual annual NHS income" : "Estimated annual NHS income";

  // NHS-only valuation: 1.0x–1.3x annual income (income-based, standard for independent community pharmacy)
  const nhsValLow = nhsIncome * 1.0;
  const nhsValHigh = nhsIncome * 1.3;

  // Companies House private income gap
  const chTurnover = company?.turnover ?? null;
  const chPrivateEst = chTurnover != null ? Math.max(0, chTurnover - nhsIncome) : null;
  const chPrivateRatio = chTurnover && chTurnover > 0 && chPrivateEst != null ? (chPrivateEst / chTurnover) * 100 : null;
  const chDiscrepancy = chTurnover != null && chTurnover > 0 && chTurnover < nhsIncome * 0.9;

  // Effective private income: manual input takes precedence, then CH estimate, then 0
  const effectivePrivate = manualPrivateIncome !== "" ? Number(manualPrivateIncome) : (chPrivateEst ?? 0);
  const hasPrivate = effectivePrivate > 0;
  const privateRatioPct = hasPrivate ? (effectivePrivate / (nhsIncome + effectivePrivate)) * 100 : 0;
  const sigPrivate = privateRatioPct > 20;

  // Adjusted valuation (NHS × 1.0–1.3 + private × 0.5–0.8)
  const adjValLow = nhsValLow + effectivePrivate * 0.5;
  const adjValHigh = nhsValHigh + effectivePrivate * 0.8;

  const monthlyBars = last12.map((r) => ({
    label: `${MONTHS[r.month - 1]} ${String(r.year).slice(2)}`,
    v: Math.round(r.items_dispensed * 1.27 + r.pharmacy_first_count * 15 + r.nms_count * NMS_RATE + r.flu_vaccinations * 12.58),
  }));

  const dispensingRevenue = itemsTotal * 1.27;
  const servicesRevenue = pfTotal * 15 + nmsTotal * NMS_RATE + fluTotal * 12.58;
  const servicesShare = (dispensingRevenue + servicesRevenue) > 0
    ? (servicesRevenue / (dispensingRevenue + servicesRevenue)) * 100 : 0;
  const monthlyItems = last12.map((r) => r.items_dispensed).filter((v) => v > 0);
  const mean = monthlyItems.reduce((a, b) => a + b, 0) / (monthlyItems.length || 1);
  const variance = monthlyItems.reduce((a, b) => a + (b - mean) ** 2, 0) / (monthlyItems.length || 1);
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const peakIdx = monthlyItems.length ? monthlyItems.indexOf(Math.max(...monthlyItems)) : -1;
  const troughIdx = monthlyItems.length ? monthlyItems.indexOf(Math.min(...monthlyItems)) : -1;
  const peakMonth = peakIdx >= 0 ? MONTHS[last12[peakIdx].month - 1] : "—";
  const troughMonth = troughIdx >= 0 ? MONTHS[last12[troughIdx].month - 1] : "—";
  const incomePerListMember = catchment && catchment.listSizeTotal > 0 ? nhsIncome / catchment.listSizeTotal : null;

  // Enhanced red flags
  const flags: { msg: string; detail?: string }[] = [];
  const nonZeroRows = last12.filter(r => r.items_dispensed > 0);
  if (nonZeroRows.length >= 3) {
    let consDecline = 0;
    for (let i = nonZeroRows.length - 1; i > 0; i--) {
      if (nonZeroRows[i].items_dispensed < nonZeroRows[i - 1].items_dispensed) consDecline++;
      else break;
    }
    if (consDecline >= 3) flags.push({
      msg: `Declining volume — ${consDecline} consecutive months of falling items`,
      detail: `${nonZeroRows[nonZeroRows.length - 1].items_dispensed.toLocaleString()} vs ${nonZeroRows[nonZeroRows.length - 1 - consDecline].items_dispensed.toLocaleString()} items`,
    });
  }
  if (last12.length >= 12) {
    const r6 = last12.slice(-6).reduce((s, r) => s + r.items_dispensed, 0);
    const p6 = last12.slice(0, 6).reduce((s, r) => s + r.items_dispensed, 0);
    if (p6 > 0 && (r6 - p6) / p6 < -0.10) {
      const pctDecline = Math.abs(Math.round(((r6 - p6) / p6) * 100));
      flags.push({ msg: `Items dispensed down ${pctDecline}% year-on-year`, detail: `Recent 6M: ${r6.toLocaleString()} vs prior 6M: ${p6.toLocaleString()}` });
    }
  }
  let consNomDecline = 0;
  for (let i = rows.length - 1; i > 0; i--) {
    if (rows[i].eps_nominations < rows[i - 1].eps_nominations) consNomDecline++;
    else break;
    if (consNomDecline >= 3) break;
  }
  if (consNomDecline >= 3) flags.push({ msg: "EPS nominations declining 3+ consecutive months", detail: `${consNomDecline} months` });
  const last3 = rows.slice(-3);
  if (isEngland && last3.length === 3 && last3.every((r) => r.nms_count === 0))
    flags.push({ msg: "NMS count is zero for last 3 months — potential revenue leakage", detail: "£0 NMS income reported" });
  if (company?.last_accounts_date) {
    const monthsOld = Math.round((Date.now() - new Date(company.last_accounts_date).getTime()) / (30 * 24 * 3600 * 1000));
    if (monthsOld > 18) flags.push({ msg: `Accounts ${monthsOld} months old`, detail: `Last filed: ${new Date(company.last_accounts_date).toLocaleDateString("en-GB")}` });
  }
  if (company?.company_status && company.company_status.toLowerCase() !== "active")
    flags.push({ msg: `Company status: ${company.company_status}`, detail: "Check Companies House filing" });
  if (company?.net_assets != null && company.net_assets < 0)
    flags.push({ msg: `Net liabilities: ${gbp(Math.abs(company.net_assets))}`, detail: "Negative net assets on balance sheet" });
  if (chDiscrepancy && chTurnover != null)
    flags.push({ msg: "Data discrepancy: NHS income estimate exceeds Companies House turnover", detail: `NHS est. ${gbp(nhsIncome)} vs CH turnover ${gbp(chTurnover)}` });

  // Opportunity flags
  const opps: { msg: string; detail?: string }[] = [];
  if (catchment && catchment.competitors <= 1)
    opps.push({ msg: "Low local competition — strong catchment moat", detail: `${catchment.competitors} competitor within 1 mile` });
  if (servicesShare > 15)
    opps.push({ msg: `Strong clinical services mix — ${servicesShare.toFixed(0)}% from services`, detail: "Good income diversification" });
  if (cv < 0.05 && monthlyItems.length >= 6)
    opps.push({ msg: "Highly consistent volume — predictable income stream", detail: `Coefficient of variation: ${(cv * 100).toFixed(1)}%` });
  if (catchment?.peerRankPct != null && catchment.peerRankPct >= 75)
    opps.push({ msg: `Top-quartile performer — ${catchment.peerRankPct}th percentile (5-mile catchment)`, detail: "Market leader position" });

  return (
    <div className="p-3 md:p-6 space-y-5 md:space-y-6">
      <Section title="Acquisition intelligence — at a glance">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Cell label="Local competitors (1mi)" v={catchment ? String(catchment.competitors) : "…"} />
          <Cell label="GP feeders (1mi)" v={catchment ? String(catchment.gpFeeders) : "…"} />
          <Cell label="Catchment list size" v={catchment && catchment.listSizeTotal ? catchment.listSizeTotal.toLocaleString() : "—"} />
          <Cell label="Peer rank (5mi)" v={catchment?.peerRankPct != null ? `${catchment.peerRankPct}th pct` : "—"} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <Cell label="Services share of revenue" v={`${servicesShare.toFixed(1)}%`} />
          <Cell label="Item volatility (CV)" v={`${(cv * 100).toFixed(1)}%`} />
          <Cell label="Peak month" v={peakMonth} />
          <Cell label="Trough month" v={troughMonth} />
        </div>
        {catchment?.nearest && (
          <p className="text-[11px] text-muted-foreground mt-3">
            Nearest competitor: <span className="font-medium text-foreground">{catchment.nearest.name}</span> ·{" "}
            {Math.round(catchment.nearest.distance_m)}m away
            {incomePerListMember != null && (
              <> · NHS income per catchment patient: <span className="font-medium text-foreground">£{incomePerListMember.toFixed(2)}</span></>
            )}
          </p>
        )}
      </Section>

      <Section title="Income composition">
        <div className="grid md:grid-cols-2 gap-5 items-start">
          <div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-lg bg-secondary/40 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{incomeLabel}</p>
                <p className="text-xl font-bold tabular-nums">{gbp(nhsIncome)}</p>
              </div>
              <div className="rounded-lg bg-secondary/40 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg monthly (NHS)</p>
                <p className="text-xl font-bold tabular-nums">{gbp(avgMonthlyIncome)}</p>
              </div>
            </div>
            <IncomeDonut segments={[
              { label: "Est. NHS income", value: nhsIncome, color: "var(--chart-1)" },
              ...(effectivePrivate > 0 ? [{ label: "Est. private income", value: effectivePrivate, color: "var(--chart-2)" }] : []),
            ]} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Monthly estimated NHS income (last 12 months)</p>
            <div className="h-48">
              <ResponsiveContainer>
                <BarChart data={monthlyBars} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => v >= 1000 ? `£${Math.round(v / 1000)}k` : `£${v}`} width={46} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: any) => [gbp(Number(v)), "Est. income"]} />
                  <Bar dataKey="v" fill="var(--gold)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </Section>

      {chTurnover != null && (
        <Section title="Private income analysis">
          {chDiscrepancy ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-900 p-3 text-sm flex gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Data discrepancy detected — Companies House turnover ({gbp(chTurnover)}) is lower than estimated NHS income ({gbp(nhsIncome)}).
                Accounts may be incomplete, filed under a parent company, or cover a different period.
              </span>
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-3">
              <div className="rounded-lg bg-secondary/40 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">CH total turnover</p>
                <p className="text-xl font-bold tabular-nums">{gbp(chTurnover)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{company?.accounts_year ?? "Latest filed"}</p>
              </div>
              <div className="rounded-lg bg-secondary/40 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Est. private income</p>
                <p className="text-xl font-bold tabular-nums">{gbp(chPrivateEst)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Turnover − NHS estimate</p>
              </div>
              <div className="rounded-lg bg-secondary/40 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Private income ratio</p>
                <p className="text-xl font-bold tabular-nums">{chPrivateRatio != null ? `${chPrivateRatio.toFixed(0)}%` : "—"}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Of total turnover</p>
              </div>
            </div>
          )}
          {sigPrivate && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              This pharmacy appears to have significant private income ({privateRatioPct.toFixed(0)}% est.). NHS metrics alone may not fully represent its performance or value.
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-2">Estimated from Companies House turnover vs NHS dispensing data — indicative only.</p>
        </Section>
      )}

      <Section title="Valuation estimate">
        <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4 mb-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">NHS-only indicative range</p>
          <p className="text-2xl font-bold tabular-nums">{gbp(nhsValLow)} – {gbp(nhsValHigh)}</p>
          <p className="text-xs text-muted-foreground mt-1">{incomeLabel} of {gbp(nhsIncome)} × 1.0–1.3×</p>
        </div>
        <div className="rounded-lg border border-border bg-secondary/30 p-4 mb-4">
          <p className="text-xs font-semibold mb-2">Adjust for private income</p>
          {chTurnover != null && chPrivateEst != null && chPrivateEst > 0 && !chDiscrepancy && (
            <p className="text-xs text-muted-foreground mb-2">Companies House estimate: {gbp(chPrivateEst)} ({chPrivateRatio?.toFixed(0)}% of turnover)</p>
          )}
          <p className="text-xs text-muted-foreground mb-1.5">Annual private income (£):</p>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-medium text-muted-foreground">£</span>
            <input
              type="number" min="0"
              placeholder={chPrivateEst != null && chPrivateEst > 0 ? String(Math.round(chPrivateEst)) : "0"}
              value={manualPrivateIncome}
              onChange={e => setManualPrivateIncome(e.target.value === "" ? "" : Number(e.target.value))}
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          {hasPrivate && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-[11px] text-muted-foreground">Adjusted range (NHS × 1.0–1.3 + private × 0.5–0.8):</p>
              <p className="text-lg font-bold text-emerald-900 mt-0.5 tabular-nums">{gbp(adjValLow)} – {gbp(adjValHigh)}</p>
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground italic">
          Indicative estimate based on NHS dispensing data and Companies House filings. Does not account for goodwill, lease terms, or physical assets. Always obtain a professional valuation before any transaction.
        </p>
      </Section>

      <Section title="Financial performance (Companies House)">
        {company?.turnover ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Cell label="Turnover" v={gbp(company.turnover)} />
            <Cell label="Operating profit" v={gbp(company.operating_profit)} />
            <Cell label="Net profit" v={gbp(company.net_profit)} />
            <Cell label="Payroll" v={gbp(company.total_payroll)} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No financial data available. Go to the Financials tab to find and confirm the Companies House match.</p>
        )}
      </Section>

      {opps.length > 0 && (
        <Section title="Strengths & opportunities">
          <div className="space-y-2">
            {opps.map((o, i) => (
              <div key={i} className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-emerald-900">{o.msg}</p>
                  {o.detail && <p className="text-xs text-emerald-700 mt-0.5">{o.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Red flags">
        {flags.length === 0 ? (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 p-3 text-sm inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> No significant red flags from available data.
          </div>
        ) : (
          <ul className="space-y-2">
            {flags.map((f, i) => (
              <li key={i} className="rounded-lg border border-rose-300 bg-rose-50 text-rose-900 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">{f.msg}</p>
                    {f.detail && <p className="text-xs text-rose-700 mt-0.5">{f.detail}</p>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <p className="text-[11px] text-muted-foreground text-center">
        Computed from public NHS dispensing data, registered GP list sizes, pharmacy geocoding, and Companies House filings — no uploads required.
      </p>
    </div>
  );
}

// -------- AI Insights tab helpers --------
function mdBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  if (parts.length === 1) return text;
  return <>{parts.map((p, i) => i % 2 === 1 ? <strong key={i}>{p}</strong> : p)}</>;
}
function renderInsightMd(text: string): React.ReactNode[] {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("## ")) return <h2 key={i} className="text-sm font-semibold mt-5 mb-1.5">{line.slice(3)}</h2>;
    if (line.startsWith("# ")) return <h1 key={i} className="text-base font-bold mt-6 mb-2">{line.slice(2)}</h1>;
    if (/^[-•*]\s/.test(line)) return <li key={i} className="ml-4 text-sm leading-relaxed mb-1">{mdBold(line.replace(/^[-•*]\s/, ""))}</li>;
    if (/^\d+\.\s/.test(line)) return <li key={i} className="ml-4 list-decimal text-sm leading-relaxed mb-1">{mdBold(line.replace(/^\d+\.\s/, ""))}</li>;
    if (!line.trim()) return <div key={i} className="h-2" />;
    return <p key={i} className="text-sm leading-relaxed mb-1.5">{mdBold(line)}</p>;
  });
}
function insightTimeAgo(ts: string) {
  const h = Math.round((Date.now() - new Date(ts).getTime()) / 3600000);
  if (h < 1) return "just now";
  if (h < 48) return `${h}h ago`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

type SavedInsight = { id: string; insight_type: string; insight_text: string; generated_at: string };

// -------- AI Insights tab --------
function InsightsTab({ pharmacy, rows }: { pharmacy: Pharmacy; rows: DRow[] }) {
  const { user } = useAuth();
  const isEng = (pharmacy.country || "").toLowerCase() === "england";
  const [natAvg, setNatAvg] = useState<Record<string, number>>({});
  const [generating, setGenerating] = useState<"swot" | "benchmark" | null>(null);
  const [savedInsights, setSavedInsights] = useState<SavedInsight[]>([]);
  const [activeInsight, setActiveInsight] = useState<SavedInsight | null>(null);

  const gen = useServerFn(generateInsight);

  const latestIdx = useMemo(() => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.items_dispensed > 0 || r.nms_count > 0 || r.pharmacy_first_count > 0) return i;
    }
    return rows.length - 1;
  }, [rows]);
  const latest = latestIdx >= 0 ? rows[latestIdx] : undefined;
  const last12 = useMemo(() => rows.slice(Math.max(0, latestIdx - 11), latestIdx + 1), [rows, latestIdx]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("ai_insights")
        .select("id,insight_type,insight_text,generated_at")
        .eq("pharmacy_id", pharmacy.id)
        .in("insight_type", ["swot", "benchmark"])
        .order("generated_at", { ascending: false })
        .limit(4);
      const arr = (data as SavedInsight[]) ?? [];
      setSavedInsights(arr);
      if (arr.length) setActiveInsight(arr[0]);
    })();
  }, [pharmacy.id, user]);

  // National averages for underclaimed services (England only, sample up to 5000 rows)
  useEffect(() => {
    if (!isEng || !latest) return;
    (async () => {
      const { data } = await supabase
        .from("dispensing_data")
        .select("items_dispensed,nms_count,pharmacy_first_count,flu_vaccinations")
        .eq("year", latest.year).eq("month", latest.month)
        .limit(5000);
      if (!data?.length) return;
      const sums = { nms_count: 0, pharmacy_first_count: 0, flu_vaccinations: 0 };
      for (const r of data as any[]) {
        sums.nms_count += r.nms_count || 0;
        sums.pharmacy_first_count += r.pharmacy_first_count || 0;
        sums.flu_vaccinations += r.flu_vaccinations || 0;
      }
      const n = data.length;
      setNatAvg({ nms_count: sums.nms_count / n, pharmacy_first_count: sums.pharmacy_first_count / n, flu_vaccinations: sums.flu_vaccinations / n });
    })();
  }, [isEng, latest]);

  const handleGenerate = async (type: "swot" | "benchmark") => {
    setGenerating(type);
    try {
      const r = await gen({ data: { pharmacy_id: pharmacy.id, insight_type: type } });
      const ins = r.insight as SavedInsight;
      setSavedInsights(prev => [ins, ...prev.filter(i => i.insight_type !== type)]);
      setActiveInsight(ins);
      toast.success("Analysis complete");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate");
    } finally {
      setGenerating(null);
    }
  };

  // NMS cap
  const nmsCap = latest ? Math.floor((latest.items_dispensed || 0) * 0.01) : 0;
  const nmsCount = latest?.nms_count || 0;
  const nmsUtil = nmsCap > 0 ? Math.min(100, (nmsCount / nmsCap) * 100) : 0;
  const nmsCapped = nmsCap > 0 && nmsCount >= nmsCap;
  const nmsHeadroom = Math.max(0, nmsCap - nmsCount);

  // Underclaimed services
  const nmsGap = natAvg.nms_count ? Math.max(0, natAvg.nms_count - nmsCount) : 0;
  const pfGap = natAvg.pharmacy_first_count ? Math.max(0, natAvg.pharmacy_first_count - (latest?.pharmacy_first_count || 0)) : 0;
  const fluGap = natAvg.flu_vaccinations ? Math.max(0, natAvg.flu_vaccinations - (latest?.flu_vaccinations || 0)) : 0;
  const nmsUplift = Math.round(nmsGap * 21);
  const pfUplift = Math.round(pfGap * 15);
  const fluUplift = Math.round(fluGap * 12.58);
  const totalUplift = nmsUplift + pfUplift + fluUplift;

  // PQS indicators
  const avgNms12 = last12.length ? last12.reduce((s, r) => s + (r.nms_count || 0), 0) / last12.length : 0;
  const hasPf = last12.some(r => (r.pharmacy_first_count || 0) > 0);
  const hasFlu = last12.some(r => [9,10,11,12,1,2,3].includes(r.month) && (r.flu_vaccinations || 0) > 0);
  const epsRateLatest = latest && latest.items_dispensed ? (latest.eps_items / latest.items_dispensed) * 100 : 0;
  const epsOk = epsRateLatest >= 89;
  const epsKnown = epsRateLatest > 0;

  const swotCached = savedInsights.find(i => i.insight_type === "swot");
  const benchCached = savedInsights.find(i => i.insight_type === "benchmark");

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* AI Analysis */}
      <Section title="AI analysis">
        <div className="flex flex-wrap gap-3 mb-4">
          <Button onClick={() => handleGenerate("swot")} disabled={!!generating} className="gap-2">
            {generating === "swot" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {swotCached ? "Refresh SWOT" : "SWOT Analysis"}
          </Button>
          <Button variant="outline" onClick={() => handleGenerate("benchmark")} disabled={!!generating} className="gap-2">
            {generating === "benchmark" ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
            {benchCached ? "Refresh Commentary" : "Performance Commentary"}
          </Button>
          {(swotCached || benchCached) && (
            <div className="flex gap-2 flex-wrap">
              {swotCached && (
                <button
                  onClick={() => setActiveInsight(swotCached)}
                  className={["text-xs px-3 py-1.5 rounded-full border transition-colors",
                    activeInsight?.id === swotCached.id
                      ? "border-gold bg-gold/10 text-amber-800"
                      : "border-border text-muted-foreground hover:text-foreground"].join(" ")}
                >
                  SWOT · {insightTimeAgo(swotCached.generated_at)}
                </button>
              )}
              {benchCached && (
                <button
                  onClick={() => setActiveInsight(benchCached)}
                  className={["text-xs px-3 py-1.5 rounded-full border transition-colors",
                    activeInsight?.id === benchCached.id
                      ? "border-sky-400 bg-sky-50 text-sky-800"
                      : "border-border text-muted-foreground hover:text-foreground"].join(" ")}
                >
                  Commentary · {insightTimeAgo(benchCached.generated_at)}
                </button>
              )}
            </div>
          )}
        </div>

        {generating && (
          <div className="rounded-xl border border-border bg-secondary/30 p-6 text-center space-y-2">
            <Loader2 className="h-6 w-6 animate-spin text-gold mx-auto" />
            <p className="text-sm font-medium">Analysing {pharmacyDisplayName(pharmacy.name, pharmacy.trading_name, pharmacy.ods_code)}…</p>
            <p className="text-xs text-muted-foreground">Processing 24 months of NHS dispensing data and local landscape intelligence. Takes 15–30 seconds.</p>
          </div>
        )}

        {activeInsight && !generating ? (
          <div className="rounded-xl border border-border bg-secondary/20 overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border flex-wrap bg-secondary/40">
              <div className="flex items-center gap-2">
                <span className="text-[10px] bg-gold/10 text-amber-700 border border-gold/25 rounded-full px-2.5 py-0.5 font-semibold uppercase tracking-wider">AI</span>
                <span className="text-xs font-semibold">
                  {activeInsight.insight_type === "swot" ? "SWOT Analysis" : "Performance Commentary"}
                </span>
                <span className="text-xs text-muted-foreground">· {insightTimeAgo(activeInsight.generated_at)}</span>
              </div>
              <button
                onClick={() => handleGenerate(activeInsight.insight_type as "swot" | "benchmark")}
                disabled={!!generating}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <RefreshCw className="h-3 w-3" /> Regenerate
              </button>
            </div>
            <div className="px-4 py-4 space-y-0.5 max-h-[55vh] overflow-y-auto">
              {renderInsightMd(activeInsight.insight_text)}
            </div>
            <div className="px-4 py-2 border-t border-border bg-secondary/30">
              <p className="text-[10px] text-muted-foreground">AI analysis using NHS open dispensing data. Not financial advice.</p>
            </div>
          </div>
        ) : !generating && (
          <p className="text-sm text-muted-foreground">Generate an AI-powered analysis using 24 months of dispensing data and local landscape intelligence.</p>
        )}
      </Section>

      {/* England-only sections */}
      {isEng && latest && (
        <>
          {/* NMS 1% Cap */}
          <Section title="NMS utilisation vs 1% cap">
            <p className="text-xs text-muted-foreground mb-4">NHSBSA caps NMS at 1% of monthly items dispensed. Tracking utilisation prevents revenue leakage and avoids delivering NMS above the cap which will not be reimbursed.</p>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded-lg border border-border bg-secondary/40 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Items dispensed</p>
                <p className="text-lg font-bold tabular-nums">{latest.items_dispensed.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-border bg-secondary/40 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">NMS cap (1%)</p>
                <p className="text-lg font-bold tabular-nums">{nmsCap.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-border bg-secondary/40 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">NMS delivered</p>
                <p className="text-lg font-bold tabular-nums">{nmsCount.toLocaleString()}</p>
              </div>
            </div>
            <div className="space-y-1.5 mb-3">
              <div className="flex justify-between text-xs">
                <span className="font-medium">Cap utilisation</span>
                <span className={nmsUtil > 90 ? "text-rose-600 font-semibold" : nmsUtil > 70 ? "text-amber-600 font-semibold" : "text-emerald-600 font-semibold"}>
                  {nmsUtil.toFixed(1)}%
                </span>
              </div>
              <div className="h-3 rounded-full bg-secondary overflow-hidden">
                <div
                  className={["h-full rounded-full transition-all", nmsUtil > 90 ? "bg-rose-500" : nmsUtil > 70 ? "bg-amber-400" : "bg-emerald-500"].join(" ")}
                  style={{ width: `${Math.min(100, nmsUtil)}%` }}
                />
              </div>
            </div>
            {nmsCapped ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-900 p-3 text-xs flex gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>NMS claims at or above the cap. Additional NMS delivered this month will not be reimbursed by NHSBSA.</span>
              </div>
            ) : nmsHeadroom > 0 && nmsUtil < 60 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 p-3 text-xs flex gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>Capacity for {nmsHeadroom} more NMS this month — worth up to <span className="font-semibold">£{(nmsHeadroom * 21).toLocaleString()}</span> additional income.</span>
              </div>
            ) : null}
            <p className="text-[10px] text-muted-foreground mt-3">NMS £21/completed NMS (from April 2025) · {MONTHS[latest.month - 1]} {latest.year} data · Cap = items × 0.01</p>
          </Section>

          {/* Underclaimed services */}
          {Object.keys(natAvg).length > 0 && (
            <Section title="Underclaimed services">
              <p className="text-xs text-muted-foreground mb-4">
                Services below England average for {MONTHS[latest.month - 1]} {latest.year}.
                Closing each gap to national average would generate the monthly revenue uplift shown.
              </p>
              {totalUplift === 0 ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 p-3 text-sm flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  This pharmacy is at or above the England average across all measured advanced services.
                </div>
              ) : (
                <div className="space-y-3">
                  {nmsGap > 0.5 && (
                    <ServiceGapRow label="New Medicine Service" current={nmsCount} avg={natAvg.nms_count} gap={nmsGap} rateLabel="£21/completed NMS" uplift={nmsUplift} />
                  )}
                  {pfGap > 0.5 && (
                    <ServiceGapRow label="Pharmacy First" current={latest.pharmacy_first_count || 0} avg={natAvg.pharmacy_first_count} gap={pfGap} rateLabel="~£15/consultation" uplift={pfUplift} />
                  )}
                  {fluGap > 0.5 && (
                    <ServiceGapRow label="Flu vaccinations" current={latest.flu_vaccinations || 0} avg={natAvg.flu_vaccinations} gap={fluGap} rateLabel="£12.58/jab" uplift={fluUplift} />
                  )}
                  <div className="mt-1 rounded-lg border border-gold/40 bg-gold/5 p-3.5 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold">Total monthly uplift potential</p>
                      <p className="text-xs text-muted-foreground">If all gaps closed to England average</p>
                    </div>
                    <p className="text-2xl font-bold text-gold">£{totalUplift.toLocaleString()}</p>
                  </div>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground mt-3">Drug Tariff rates · {MONTHS[latest.month - 1]} {latest.year} · Sample of up to 5,000 England pharmacies</p>
            </Section>
          )}

          {/* PQS Tracker */}
          <Section title="PQS readiness (2024-25 indicative)">
            <p className="text-xs text-muted-foreground mb-4">Indicative Pharmacy Quality Scheme criteria computed from NHS dispensing data. Does not cover the QI domain, declarations, or any criteria requiring the PQS portal.</p>
            <div className="space-y-2.5">
              <PqsCriterionRow
                label="NMS minimum — aspirational"
                met={avgNms12 >= 11}
                detail={`Average ${avgNms12.toFixed(1)} NMS/month over last 12 months (aspirational target ≥ 11/month)`}
              />
              <PqsCriterionRow
                label="Pharmacy First active"
                met={hasPf}
                detail={hasPf ? "Pharmacy First consultations recorded in the last 12 months" : "No Pharmacy First consultations found in last 12 months — confirm PF is activated"}
              />
              <PqsCriterionRow
                label="Seasonal flu vaccinations"
                met={hasFlu}
                detail={hasFlu ? "Flu vaccinations recorded in qualifying months (Sep–Mar)" : "No flu vaccinations found in eligible months (Sep–Mar) — check flu service setup"}
              />
              <PqsCriterionRow
                label="EPS nomination rate ≥ 89%"
                met={epsOk}
                detail={epsKnown
                  ? `${epsRateLatest.toFixed(1)}% EPS rate in latest month${!epsOk ? " — below the 89% gateway threshold" : ""}`
                  : "EPS nomination data unavailable for this period"}
                warn={epsKnown && !epsOk}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-3">PQS requires declaration via NHSBSA portal. Consult the current PQS framework for definitive gateways and aspirational thresholds.</p>
          </Section>
        </>
      )}
    </div>
  );
}

function ServiceGapRow({ label, current, avg, gap, rateLabel, uplift }: {
  label: string; current: number; avg: number; gap: number; rateLabel: string; uplift: number;
}) {
  const pctBehind = avg > 0 ? ((gap / avg) * 100).toFixed(0) : "0";
  return (
    <div className="rounded-lg border border-border bg-card p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          You: {Math.round(current).toLocaleString()} · Avg: {Math.round(avg).toLocaleString()} · {pctBehind}% below · {rateLabel}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold text-emerald-600">+£{uplift.toLocaleString()}</p>
        <p className="text-[10px] text-muted-foreground">per month</p>
      </div>
    </div>
  );
}

function PqsCriterionRow({ label, met, detail, warn }: { label: string; met: boolean; detail: string; warn?: boolean }) {
  const icon = met
    ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
    : warn
      ? <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
      : <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />;
  const badge = met ? "bg-emerald-50 text-emerald-700" : warn ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700";
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
      </div>
      <span className={["shrink-0 text-xs font-semibold rounded-full px-2.5 py-0.5", badge].join(" ")}>
        {met ? "✓ Met" : "✗ Check"}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-5"><h3 className="text-sm font-semibold mb-3">{title}</h3>{children}</div>;
}

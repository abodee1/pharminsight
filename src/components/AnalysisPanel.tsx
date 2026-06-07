import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { X, Star, Loader2, RefreshCw, Printer, AlertTriangle, CheckCircle2, TrendingUp, TrendingDown, Minus, Upload, FileText } from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";
import { confirmCompany, rejectCandidate, searchCompany } from "@/lib/companiesHouse.functions";
import { RemunerationReport } from "@/components/RemunerationReport";
import { InteractiveTrend } from "@/components/InteractiveTrend";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

type Pharmacy = { id: string; ods_code: string; name: string; address: string | null; postcode: string | null; region: string | null; country: string | null };
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
type Tab = "overview" | "financials" | "benchmarking" | "acquisition";

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
  "Estimated annual NHS income": "Our estimate of the NHS payment this pharmacy receives per year, based on items, NMS, Pharmacy First and flu volumes multiplied by published Drug Tariff rates, less a 5% clawback. Upload an FP34C to replace with actuals.",
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
            <h2 className="font-bold text-base md:text-lg truncate">{pharmacy.name}</h2>
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
          {(["overview","financials","benchmarking","acquisition"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={["px-3 md:px-4 py-2.5 md:py-3 text-xs md:text-sm font-medium capitalize whitespace-nowrap transition-colors border-b-2",
                tab === t ? "border-gold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"].join(" ")}>
              {t}
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
          <p className="text-sm">Financial data unavailable. Upload FP34C schedules in the Acquisition tab for manual entry.</p>
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

// ------------------------- ACQUISITION TAB -------------------------
function AcquisitionTab({ pharmacy, rows }: { pharmacy: Pharmacy; rows: DRow[] }) {
  const { user } = useAuth();
  const [company, setCompany] = useState<Company | null>(null);
  const [fp34c, setFp34c] = useState<{ actualMonthly: number[]; total: number } | null>(null);
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
    if (!user) return;
    supabase.from("private_uploads").select("parsed_data")
      .eq("user_id", user.id).eq("pharmacy_id", pharmacy.id).eq("upload_type", "acquisition_fp34c")
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        const parsed = (data?.parsed_data as any) || null;
        if (parsed?.monthly_payments) setFp34c({ actualMonthly: parsed.monthly_payments, total: parsed.monthly_payments.reduce((a: number, b: number) => a + b, 0) });
      });
  }, [user, pharmacy.id]);

  // Catchment intelligence (works without uploads)
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

      // peer ranking by latest items vs peers within 5km
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

      // GP list-size sum (latest)
      let listSizeTotal = 0;
      const codes = (nearGp || []).map((g: any) => g.practice_code);
      if (codes.length) {
        const { data: ls } = await supabase.from("gp_list_sizes")
          .select("practice_code,list_size,year,month").in("practice_code", codes)
          .order("year", { ascending: false }).order("month", { ascending: false }).limit(codes.length * 3);
        const seen = new Set<string>();
        for (const r of (ls || [])) {
          if (seen.has(r.practice_code)) continue;
          seen.add(r.practice_code);
          listSizeTotal += r.list_size || 0;
        }
      }

      setCatchment({
        competitors: compRows.length,
        gpFeeders: (nearGp || []).length,
        listSizeTotal,
        peerRankPct,
        nearest,
      });
    })().catch(() => {});
  }, [pharmacy.id, rows]);

  const isScot = (pharmacy.country || "").toLowerCase() === "scotland";
  const last12 = rows.slice(-12);

  // Income calc
  let itemsTotal = 0, pfTotal = 0, nmsTotal = 0, fluTotal = 0;
  last12.forEach((r) => { itemsTotal += r.items_dispensed; pfTotal += r.pharmacy_first_count; nmsTotal += r.nms_count; fluTotal += r.flu_vaccinations; });
  const estimated = itemsTotal * 1.27 + pfTotal * 15 + nmsTotal * 28 + fluTotal * 12.58;
  const discount = estimated * 0.05;
  const estimatedNet = estimated - discount;

  let actualNHS: number | null = null;
  if (isScot) {
    const actuals = last12.filter((r) => r.is_actual_payment);
    if (actuals.length >= 6) actualNHS = actuals.reduce((s, r) => s + (Number(r.final_payment) || 0), 0) * (12 / actuals.length);
  }
  if (fp34c) actualNHS = fp34c.total;

  const nhsIncome = actualNHS ?? estimatedNet;
  const incomeLabel = actualNHS != null ? "Actual annual NHS income" : "Estimated annual NHS income";

  const monthlyBars = last12.map((r) => ({
    label: `${MONTHS[r.month - 1]}`,
    v: Math.round(r.items_dispensed * 1.27 + r.pharmacy_first_count * 15 + r.nms_count * 28 + r.flu_vaccinations * 12.58),
  }));

  // Service mix + volatility (works without uploads)
  const dispensingRevenue = itemsTotal * 1.27;
  const servicesRevenue = pfTotal * 15 + nmsTotal * 28 + fluTotal * 12.58;
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

  const incomePerListMember = catchment && catchment.listSizeTotal > 0
    ? nhsIncome / catchment.listSizeTotal : null;

  // Valuation
  const turnover = company?.turnover || null;
  const opProfit = company?.operating_profit || null;
  const ebitda = opProfit != null ? opProfit + (turnover ? turnover * 0.02 : 0) : null;
  const val = ebitda ? { low: ebitda * 4, mid: ebitda * 5, high: ebitda * 6 } : null;

  // Red flags
  const flags: { ok: boolean; msg: string }[] = [];
  if (last12.length >= 12) {
    const recent6 = last12.slice(-6).reduce((s, r) => s + r.items_dispensed, 0);
    const prior6 = last12.slice(0, 6).reduce((s, r) => s + r.items_dispensed, 0);
    if (prior6 > 0 && (recent6 - prior6) / prior6 < -0.10) flags.push({ ok: false, msg: "Items dispensed declined >10% year on year" });
  }
  const last3 = rows.slice(-3);
  let consecutiveDecline = 0;
  for (let i = rows.length - 1; i > 0; i--) {
    if (rows[i].eps_nominations < rows[i - 1].eps_nominations) consecutiveDecline++; else break;
    if (consecutiveDecline >= 3) break;
  }
  if (consecutiveDecline >= 3) flags.push({ ok: false, msg: "EPS nominations declining 3+ months consecutively" });
  if (last3.length === 3 && last3.every((r) => r.nms_count === 0)) flags.push({ ok: false, msg: "NMS count is zero for last 3 months" });
  if (company?.last_accounts_date) {
    const months = Math.round((Date.now() - new Date(company.last_accounts_date).getTime()) / (30 * 24 * 3600 * 1000));
    if (months > 18) flags.push({ ok: false, msg: `Companies House accounts are ${months} months old` });
  }
  if (company?.company_status && company.company_status.toLowerCase() !== "active") flags.push({ ok: false, msg: `Company status: ${company.company_status}` });
  if (company?.net_assets != null && company.net_assets < 0) flags.push({ ok: false, msg: "Net liabilities on balance sheet" });

  const upload = async (file: File, kind: "acquisition_fp34c" | "acquisition_pl") => {
    if (!user) return toast.error("Sign in");
    const text = await file.text();
    let parsed: any = { raw: text.slice(0, 200) };
    if (file.name.toLowerCase().endsWith(".csv")) {
      const lines = text.trim().split(/\r?\n/);
      const rowsCsv = lines.slice(1).map((l) => l.split(",").map((c) => c.trim()));
      if (kind === "acquisition_fp34c") {
        const monthly = rowsCsv.map((r) => Number(r[1] ?? r[0]) || 0).filter((n) => n > 0);
        parsed = { monthly_payments: monthly };
      } else {
        const obj: Record<string, number> = {};
        for (const r of rowsCsv) if (r[0]) obj[r[0]] = Number(r[1]) || 0;
        parsed = { pl_lines: obj };
      }
    }
    const { error } = await supabase.from("private_uploads").insert({
      user_id: user.id, pharmacy_id: pharmacy.id, upload_type: kind, file_name: file.name, parsed_data: parsed,
    });
    if (error) return toast.error(error.message);
    toast.success(`Uploaded ${file.name}`);
    if (kind === "acquisition_fp34c" && parsed.monthly_payments)
      setFp34c({ actualMonthly: parsed.monthly_payments, total: parsed.monthly_payments.reduce((a: number, b: number) => a + b, 0) });
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <Section title={`Section 1 — ${incomeLabel}`}>
        <FlipCard
          title={incomeLabel}
          value={<span className="text-3xl">{gbp(nhsIncome)}</span>}
          description={METRIC_INFO[incomeLabel] || ""}
          className="md:max-w-sm"
        />
        <div className="h-40 mt-3"><ResponsiveContainer><BarChart data={monthlyBars} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} />
          <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: any) => [gbp(Number(v)), "Est."]} />
          <Bar dataKey="v" fill="var(--gold)" radius={[3,3,0,0]} />
        </BarChart></ResponsiveContainer></div>
      </Section>


      <Section title="Section 2 — Financial performance">
        {company?.turnover ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Cell label="Turnover" v={gbp(company.turnover)} />
            <Cell label="Operating profit" v={gbp(company.operating_profit)} />
            <Cell label="Net profit" v={gbp(company.net_profit)} />
            <Cell label="Payroll" v={gbp(company.total_payroll)} />
          </div>
        ) : <p className="text-sm text-muted-foreground">Financial data not yet fetched. Go to the Financials tab.</p>}
      </Section>

      <Section title="Section 3 — Valuation estimate">
        {val ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Cell label="Conservative · 4x" v={gbp(val.low)} />
              <Cell label="Mid-range · 5x" v={gbp(val.mid)} />
              <Cell label="Premium · 6x" v={gbp(val.high)} />
            </div>
            <div className="mt-4 h-3 rounded-full overflow-hidden bg-gradient-to-r from-rose-200 via-amber-200 to-emerald-200" />
            <p className="text-[11px] text-muted-foreground mt-2">EBITDA estimated as operating profit + 2% turnover (proxy for depreciation).</p>
            <p className="text-[11px] text-muted-foreground mt-1 italic">Valuation estimates use publicly filed accounts and estimated NHS income. Always verify with management accounts and FP34C schedules.</p>
          </>
        ) : <p className="text-sm text-muted-foreground">Match company and fetch full accounts to estimate valuation.</p>}
      </Section>

      <Section title="Section 4 — Red flags">
        {flags.length === 0 ? (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 p-3 text-sm inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> No significant red flags identified from available data.</div>
        ) : (
          <ul className="space-y-2">{flags.map((f, i) => (
            <li key={i} className="rounded-lg border border-rose-300 bg-rose-50 text-rose-900 p-3 text-sm flex items-start gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span>{f.msg}</span></li>
          ))}</ul>
        )}
      </Section>

      <Section title="Section 5 — Upload for accuracy">
        <div className="grid md:grid-cols-2 gap-4">
          <UploadBox label="FP34C Payment Schedules" hint="CSV with [month,total] rows for exact NHS income"
            onFile={(f) => upload(f, "acquisition_fp34c")} done={!!fp34c} />
          <UploadBox label="P&L / Management Accounts" hint="CSV with [line_item,value] rows for exact profitability"
            onFile={(f) => upload(f, "acquisition_pl")} done={false} />
        </div>
      </Section>

      <Button className="w-full bg-gold text-foreground hover:bg-gold/90" onClick={() => window.print()}>
        <Printer className="h-4 w-4" /> Download Due Diligence Report (PDF)
      </Button>
      <p className="text-[11px] text-center text-muted-foreground">Use your browser's "Save as PDF" in the print dialog.</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-5"><h3 className="text-sm font-semibold mb-3">{title}</h3>{children}</div>;
}
function UploadBox({ label, hint, onFile, done }: { label: string; hint: string; onFile: (f: File) => void; done: boolean }) {
  return (
    <label className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-6 text-center cursor-pointer hover:bg-secondary/40 transition-colors">
      <Upload className="h-5 w-5 text-muted-foreground mb-2" />
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground mt-1">{hint}</p>
      {done && <p className="text-xs text-emerald-700 mt-1">Uploaded ✓</p>}
      <input type="file" className="hidden" accept=".csv,.pdf" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </label>
  );
}

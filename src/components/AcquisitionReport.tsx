import { Printer, TrendingUp, TrendingDown, Minus, MapPin, Stethoscope, Pill, AlertTriangle, Sparkles, CheckCircle2, Target, Building2, Banknote, Star, ShieldAlert } from "lucide-react";
import { pharmacyDisplayName } from "@/lib/pharmacyName";

type Opportunity = { title: string; annual_uplift_gbp_low: number; annual_uplift_gbp_high: number; rationale: string };
type Competitor = { name: string; distance_m: number; threat: "low" | "med" | "high"; note: string };
type Risk = { title: string; severity: "low" | "med" | "high"; note: string };
type OpportunitySummary = { title: string; impact: "low" | "med" | "high"; note: string };
type Kpi = { label: string; value: string; hint: string };

export type AcquisitionReportData = {
  headline_score: number;
  confidence: "low" | "medium" | "high";
  recommendation: "BUY" | "HOLD" | "PASS";
  verdict_oneliner: string;
  executive_summary: string;
  kpis: Kpi[];
  location: { summary: string; competitor_count_1mi: number; gp_count_1mi: number; catchment_verdict: "strong" | "average" | "weak" };
  nhs_performance: { summary: string; trend: "growing" | "stable" | "declining"; vs_peers: "above" | "in-line" | "below" };
  service_potential: { summary: string; opportunities: Opportunity[] };
  competitive: { summary: string; key_competitors: Competitor[] };
  valuation: {
    summary: string;
    implied_annual_nhs_income_gbp: number;
    ebitda_estimate_gbp_low: number; ebitda_estimate_gbp_high: number;
    multiple_low: number; multiple_high: number;
    value_low_gbp: number; value_high_gbp: number;
    basis: string;
  };
  risks: Risk[];
  opportunities_summary: OpportunitySummary[];
  due_diligence_checklist: string[];
  next_steps: string[];
};

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n || 0);

const recColour: Record<string, string> = {
  BUY: "bg-emerald-600 text-white",
  HOLD: "bg-amber-500 text-white",
  PASS: "bg-rose-600 text-white",
};
const sev: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-800 border-emerald-200",
  med: "bg-amber-100 text-amber-800 border-amber-200",
  high: "bg-rose-100 text-rose-800 border-rose-200",
};
const verdictColour: Record<string, string> = {
  strong: "text-emerald-600", average: "text-amber-600", weak: "text-rose-600",
};

function ScoreGauge({ score }: { score: number }) {
  const safe = Math.max(0, Math.min(100, score || 0));
  const stroke = safe >= 70 ? "stroke-emerald-500" : safe >= 50 ? "stroke-amber-500" : "stroke-rose-500";
  const C = 2 * Math.PI * 56;
  const offset = C * (1 - safe / 100);
  return (
    <div className="relative h-40 w-40">
      <svg viewBox="0 0 128 128" className="h-40 w-40 -rotate-90">
        <circle cx="64" cy="64" r="56" className="stroke-muted fill-none" strokeWidth="12" />
        <circle cx="64" cy="64" r="56" className={`${stroke} fill-none transition-all`}
          strokeWidth="12" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={offset} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-4xl font-bold tracking-tight">{safe}</div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Opportunity score</div>
      </div>
    </div>
  );
}

function paragraphs(text: string) {
  return text.split(/\n\n+/).map((p, i) => (
    <p key={i} className="text-sm leading-relaxed text-foreground/90">{p.trim()}</p>
  ));
}

type Props = {
  report: AcquisitionReportData;
  pharmacy: { name: string; trading_name?: string | null; ods_code: string; address: string | null; postcode: string | null; country: string | null; region: string | null };
  generatedAt: string;
};

export function AcquisitionReport({ report, pharmacy, generatedAt }: Props) {
  const date = new Date(generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="acquisition-report">
      <style>{`
        @media print {
          @page { size: A4; margin: 16mm; }
          body { background: white !important; }
          .acq-no-print { display: none !important; }
          .acq-page-break { page-break-before: always; }
          .acquisition-report { color: black; }
          .acquisition-report section { break-inside: avoid; }
        }
      `}</style>

      {/* ===== Cover / Hero ===== */}
      <section className="rounded-2xl border border-border bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-8 md:p-10 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] opacity-70">Acquisition intelligence report</p>
            <h1 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">{pharmacyDisplayName(pharmacy.name, pharmacy.trading_name, pharmacy.ods_code)}</h1>
            <p className="mt-2 text-sm opacity-80">
              {[pharmacy.address, pharmacy.postcode].filter(Boolean).join(", ")}
            </p>
            <p className="mt-1 text-xs opacity-70">
              {[pharmacy.country, pharmacy.region].filter(Boolean).join(" · ")} · ODS {pharmacy.ods_code}
            </p>
          </div>
          <div className="flex items-center gap-6">
            <ScoreGauge score={report.headline_score} />
            <div>
              <span className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold tracking-wide ${recColour[report.recommendation] || "bg-muted"}`}>
                {report.recommendation}
              </span>
              <p className="text-xs uppercase tracking-widest opacity-70 mt-2">Confidence</p>
              <p className="text-sm font-semibold capitalize">{report.confidence}</p>
            </div>
          </div>
        </div>
        <p className="mt-6 text-lg font-medium leading-snug max-w-3xl">{report.verdict_oneliner}</p>
        <p className="mt-4 text-xs opacity-60">Prepared {date}</p>
      </section>

      {/* ===== KPI strip ===== */}
      {report.kpis?.length > 0 && (
        <section className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {report.kpis.map((k, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{k.label}</p>
              <p className="mt-1 text-xl font-bold tracking-tight">{k.value}</p>
              <p className="mt-1 text-[11px] text-muted-foreground leading-snug">{k.hint}</p>
            </div>
          ))}
        </section>
      )}

      {/* ===== Executive summary ===== */}
      <section className="mt-8 rounded-xl border border-border bg-card p-6 md:p-8">
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
          <Sparkles className="h-5 w-5 text-primary" /> Executive summary
        </h2>
        <div className="space-y-3 max-w-4xl">{paragraphs(report.executive_summary)}</div>
      </section>

      {/* ===== Location & Catchment ===== */}
      <section className="mt-6 rounded-xl border border-border bg-card p-6 md:p-8">
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <MapPin className="h-5 w-5 text-primary" /> Location & catchment
          </h2>
          <span className={`text-sm font-semibold uppercase tracking-wide ${verdictColour[report.location.catchment_verdict]}`}>
            {report.location.catchment_verdict}
          </span>
        </div>
        <div className="grid md:grid-cols-3 gap-4 mb-5">
          <div className="rounded-lg bg-secondary/50 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"><Pill className="h-3.5 w-3.5" /> Competitor pharmacies (1 mile)</div>
            <p className="mt-1 text-3xl font-bold">{report.location.competitor_count_1mi}</p>
          </div>
          <div className="rounded-lg bg-secondary/50 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"><Stethoscope className="h-3.5 w-3.5" /> GP surgeries (1 mile)</div>
            <p className="mt-1 text-3xl font-bold">{report.location.gp_count_1mi}</p>
          </div>
          <div className="rounded-lg bg-secondary/50 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"><Building2 className="h-3.5 w-3.5" /> Catchment</div>
            <p className={`mt-1 text-2xl font-bold capitalize ${verdictColour[report.location.catchment_verdict]}`}>{report.location.catchment_verdict}</p>
          </div>
        </div>
        <div className="space-y-3 max-w-4xl">{paragraphs(report.location.summary)}</div>
      </section>

      {/* ===== NHS Performance ===== */}
      <section className="mt-6 rounded-xl border border-border bg-card p-6 md:p-8">
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <TrendingUp className="h-5 w-5 text-primary" /> NHS performance
          </h2>
          <div className="flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border bg-secondary">
              {report.nhs_performance.trend === "growing" ? <TrendingUp className="h-3 w-3 text-emerald-600" /> :
               report.nhs_performance.trend === "declining" ? <TrendingDown className="h-3 w-3 text-rose-600" /> :
               <Minus className="h-3 w-3 text-muted-foreground" />}
              <span className="capitalize">{report.nhs_performance.trend}</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border bg-secondary">
              <span className="text-muted-foreground">vs peers:</span>
              <span className="capitalize font-semibold">{report.nhs_performance.vs_peers}</span>
            </span>
          </div>
        </div>
        <div className="space-y-3 max-w-4xl">{paragraphs(report.nhs_performance.summary)}</div>
      </section>

      {/* ===== Service potential ===== */}
      <section className="mt-6 rounded-xl border border-border bg-card p-6 md:p-8 acq-page-break">
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
          <Target className="h-5 w-5 text-primary" /> Service mix & untapped potential
        </h2>
        <div className="space-y-3 max-w-4xl mb-5">{paragraphs(report.service_potential.summary)}</div>
        <div className="grid md:grid-cols-2 gap-3">
          {report.service_potential.opportunities?.map((o, i) => (
            <div key={i} className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-sm">{o.title}</p>
                <span className="text-xs font-bold text-emerald-700 shrink-0">
                  +{gbp(o.annual_uplift_gbp_low)}–{gbp(o.annual_uplift_gbp_high)}/yr
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{o.rationale}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Competitive ===== */}
      <section className="mt-6 rounded-xl border border-border bg-card p-6 md:p-8">
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
          <Pill className="h-5 w-5 text-primary" /> Competitive landscape
        </h2>
        <div className="space-y-3 max-w-4xl mb-5">{paragraphs(report.competitive.summary)}</div>
        <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
          {report.competitive.key_competitors?.map((c, i) => (
            <li key={i} className="p-3 flex items-center justify-between gap-3 bg-card">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{c.name}</p>
                <p className="text-xs text-muted-foreground truncate">{c.note}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />{c.distance_m < 1000 ? `${c.distance_m} m` : `${(c.distance_m / 1000).toFixed(1)} km`}
                </span>
                <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded border ${sev[c.threat]}`}>{c.threat}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ===== Valuation ===== */}
      <section className="mt-6 rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-card p-6 md:p-8">
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
          <Banknote className="h-5 w-5 text-primary" /> Indicative valuation
        </h2>
        <div className="grid md:grid-cols-3 gap-4 mb-5">
          <div className="rounded-lg bg-card border border-border p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Annual NHS income</p>
            <p className="mt-1 text-2xl font-bold tracking-tight">{gbp(report.valuation.implied_annual_nhs_income_gbp)}</p>
          </div>
          <div className="rounded-lg bg-card border border-border p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Adj. EBITDA range</p>
            <p className="mt-1 text-2xl font-bold tracking-tight">
              {gbp(report.valuation.ebitda_estimate_gbp_low)}–{gbp(report.valuation.ebitda_estimate_gbp_high)}
            </p>
          </div>
          <div className="rounded-lg bg-card border border-border p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Multiple</p>
            <p className="mt-1 text-2xl font-bold tracking-tight">{report.valuation.multiple_low}×–{report.valuation.multiple_high}×</p>
          </div>
        </div>
        <div className="rounded-xl bg-primary text-primary-foreground p-6 mb-5">
          <p className="text-xs uppercase tracking-widest opacity-70">Indicative enterprise value</p>
          <p className="mt-1 text-4xl md:text-5xl font-bold tracking-tight">
            {gbp(report.valuation.value_low_gbp)} – {gbp(report.valuation.value_high_gbp)}
          </p>
        </div>
        <div className="space-y-3 max-w-4xl">{paragraphs(report.valuation.summary)}</div>
        <p className="mt-4 text-xs italic text-muted-foreground">{report.valuation.basis}</p>
      </section>

      {/* ===== Risks & opportunities side by side ===== */}
      <section className="mt-6 grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
            <ShieldAlert className="h-5 w-5 text-rose-600" /> Risks
          </h2>
          <ul className="space-y-3">
            {report.risks?.map((r, i) => (
              <li key={i} className="flex gap-3">
                <span className={`mt-0.5 shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase rounded border ${sev[r.severity]}`}>{r.severity}</span>
                <div>
                  <p className="text-sm font-semibold">{r.title}</p>
                  <p className="text-xs text-muted-foreground">{r.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
            <Star className="h-5 w-5 text-emerald-600" /> Opportunities
          </h2>
          <ul className="space-y-3">
            {report.opportunities_summary?.map((o, i) => (
              <li key={i} className="flex gap-3">
                <span className={`mt-0.5 shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase rounded border ${sev[o.impact]}`}>{o.impact}</span>
                <div>
                  <p className="text-sm font-semibold">{o.title}</p>
                  <p className="text-xs text-muted-foreground">{o.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ===== Due diligence checklist ===== */}
      <section className="mt-6 rounded-xl border border-border bg-card p-6 md:p-8 acq-page-break">
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
          <CheckCircle2 className="h-5 w-5 text-primary" /> Due diligence checklist
        </h2>
        <ul className="grid md:grid-cols-2 gap-2">
          {report.due_diligence_checklist?.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ===== Next steps ===== */}
      <section className="mt-6 rounded-xl border border-border bg-card p-6 md:p-8">
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
          <AlertTriangle className="h-5 w-5 text-amber-600" /> Recommended next steps
        </h2>
        <ol className="space-y-2 list-decimal list-inside text-sm">
          {report.next_steps?.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      </section>

      <p className="mt-6 text-[10px] text-muted-foreground italic max-w-3xl">
        This report is AI-generated from published NHS dispensing data, public Google Places signals, and peer benchmarks.
        Estimates are indicative only and must not be relied upon as financial advice. Always corroborate with FP34/audited
        accounts and formal due diligence before transacting.
      </p>
    </div>
  );
}

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="acq-no-print inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90"
    >
      <Printer className="h-4 w-4" /> Save as PDF
    </button>
  );
}

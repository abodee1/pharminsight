import { useMemo } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell as RCell } from "recharts";
import { TrendingUp, TrendingDown, Minus, CheckCircle2, AlertTriangle, Info } from "lucide-react";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

type Pharmacy = { country: string | null; region: string | null; name: string };
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

const gbp = (n: number | null | undefined) =>
  n == null ? "—" : "£" + Math.round(n).toLocaleString();
const num = (v: number | string | null | undefined) => Number(v) || 0;

// Drug Tariff / service indicative rates (used only to estimate where no actual payment exists)
const RATES = {
  itemFee: 1.27,        // Single Activity Fee (England)
  nms: 28,
  pfConsult: 15,
  flu: 12.58,
  mcrItem: 1.30,
  ehcItem: 11,
  methSupervision: 1.00,
  smokingEpisode: 30,
};

type Stream = {
  label: string;
  value: number;
  share: number;        // % of total remuneration
  trendPct: number;     // 6m vs prior 6m %
  status: "strong" | "average" | "weak" | "neutral";
  note: string;
  basis: "actual" | "estimate";
};

function bandFor(share: number, trendPct: number, value: number): Stream["status"] {
  if (value <= 0) return "neutral";
  if (trendPct >= 8 || share >= 8) return "strong";
  if (trendPct <= -8 || (share > 0 && share < 2)) return "weak";
  return "average";
}

function trendIcon(t: number) {
  if (t >= 3) return <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />;
  if (t <= -3) return <TrendingDown className="h-3.5 w-3.5 text-rose-600" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function statusChip(s: Stream["status"]) {
  const map = {
    strong: "bg-emerald-50 text-emerald-800 border-emerald-200",
    average: "bg-amber-50 text-amber-800 border-amber-200",
    weak: "bg-rose-50 text-rose-800 border-rose-200",
    neutral: "bg-secondary text-muted-foreground border-border",
  } as const;
  const label = { strong: "Strength", average: "Stable", weak: "Weakness", neutral: "Inactive" }[s];
  return (
    <span className={`text-[10px] uppercase tracking-wide font-semibold rounded-full border px-2 py-0.5 ${map[s]}`}>
      {label}
    </span>
  );
}

export function RemunerationReport({ pharmacy, rows }: { pharmacy: Pharmacy; rows: DRow[] }) {
  const isScot = (pharmacy.country || "").toLowerCase() === "scotland";

  const analysis = useMemo(() => {
    if (!rows.length) return null;

    // Trim trailing all-zero months
    let endIdx = rows.length - 1;
    while (
      endIdx > 0 &&
      rows[endIdx].items_dispensed === 0 &&
      rows[endIdx].pharmacy_first_count === 0 &&
      rows[endIdx].nms_count === 0
    ) endIdx--;

    const last12 = rows.slice(Math.max(0, endIdx - 11), endIdx + 1);
    const prior6 = rows.slice(Math.max(0, endIdx - 17), Math.max(0, endIdx - 5));
    const last6 = last12.slice(-6);

    const sum = <K extends keyof DRow>(arr: DRow[], k: K) =>
      arr.reduce((s, r) => s + num(r[k] as any), 0);

    const tot = {
      items: sum(last12, "items_dispensed"),
      nms: sum(last12, "nms_count"),
      pf: sum(last12, "pharmacy_first_count"),
      flu: sum(last12, "flu_vaccinations"),
      eps: sum(last12, "eps_items"),
      mcrItems: sum(last12, "mcr_items"),
      mcrReg: sum(last12, "mcr_registrations"),
      methItems: sum(last12, "methadone_items"),
      methSup: sum(last12, "supervised_methadone_doses"),
      ehc: sum(last12, "ehc_items"),
      smk: sum(last12, "smoking_cessation"),
      pfPay: sum(last12, "pharmacy_first_payment"),
      mcrPay: sum(last12, "mcr_payment"),
      smkPay: sum(last12, "smoking_cessation_payment"),
      finalPay: sum(last12, "final_payment"),
    };

    const trendPct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : 0);

    // Build streams
    const streams: Stream[] = [];
    const monthsActive = last12.filter((r) => r.items_dispensed > 0).length || 1;

    // ITEM-BASED DISPENSING
    const itemFeeValue = tot.items * RATES.itemFee;
    streams.push({
      label: "Dispensing fees (item-based)",
      value: itemFeeValue,
      share: 0,
      trendPct: trendPct(sum(last6, "items_dispensed"), sum(prior6, "items_dispensed")),
      status: "neutral",
      basis: "estimate",
      note: `${tot.items.toLocaleString()} items over 12 months at the indicative Single Activity Fee. The dominant baseline revenue stream — protect at all costs.`,
    });

    if (isScot) {
      // Scotland — prefer actuals from PHS payment files
      const pfValue = tot.pfPay > 0 ? tot.pfPay : tot.pf * RATES.pfConsult;
      streams.push({
        label: "Pharmacy First (Scotland)",
        value: pfValue,
        share: 0,
        trendPct: trendPct(sum(last6, "pharmacy_first_count"), sum(prior6, "pharmacy_first_count")),
        status: "neutral",
        basis: tot.pfPay > 0 ? "actual" : "estimate",
        note: tot.pf > 0
          ? `${tot.pf.toLocaleString()} consultations in 12m. Includes the fixed monthly fee where minimum activity thresholds are met.`
          : "No Pharmacy First activity recorded — significant uncaptured revenue opportunity.",
      });

      const mcrValue = tot.mcrPay > 0 ? tot.mcrPay : tot.mcrItems * RATES.mcrItem;
      streams.push({
        label: "MCR (chronic medication)",
        value: mcrValue,
        share: 0,
        trendPct: trendPct(sum(last6, "mcr_items"), sum(prior6, "mcr_items")),
        status: "neutral",
        basis: tot.mcrPay > 0 ? "actual" : "estimate",
        note: `${tot.mcrReg.toLocaleString()} registered patients · ${tot.mcrItems.toLocaleString()} serial items. Caseload-driven and highly predictable — the most defensible recurring revenue line.`,
      });

      const methValue = tot.methSup * RATES.methSupervision;
      streams.push({
        label: "Methadone supervision (PHS)",
        value: methValue,
        share: 0,
        trendPct: trendPct(sum(last6, "supervised_methadone_doses"), sum(prior6, "supervised_methadone_doses")),
        status: "neutral",
        basis: "estimate",
        note: `${tot.methSup.toLocaleString()} supervised doses + ${tot.methItems.toLocaleString()} OST items. Material if the active caseload is large; otherwise treat as supplemental.`,
      });

      const smkValue = tot.smkPay > 0 ? tot.smkPay : tot.smk * RATES.smokingEpisode;
      streams.push({
        label: "Smoking cessation (PHS)",
        value: smkValue,
        share: 0,
        trendPct: trendPct(sum(last6, "smoking_cessation"), sum(prior6, "smoking_cessation")),
        status: "neutral",
        basis: tot.smkPay > 0 ? "actual" : "estimate",
        note: `${tot.smk.toLocaleString()} completed episodes in 12m.`,
      });

      const ehcValue = tot.ehc * RATES.ehcItem;
      streams.push({
        label: "EHC supplies (PHS)",
        value: ehcValue,
        share: 0,
        trendPct: trendPct(sum(last6, "ehc_items"), sum(prior6, "ehc_items")),
        status: "neutral",
        basis: "estimate",
        note: `${tot.ehc.toLocaleString()} EHC supplies in 12m.`,
      });
    } else {
      // England / Wales / NI
      streams.push({
        label: "Pharmacy First consultations",
        value: tot.pf * RATES.pfConsult,
        share: 0,
        trendPct: trendPct(sum(last6, "pharmacy_first_count"), sum(prior6, "pharmacy_first_count")),
        status: "neutral",
        basis: "estimate",
        note: tot.pf > 0
          ? `${tot.pf.toLocaleString()} consultations in 12m. Each delivers ~£15 plus the monthly fixed payment once minimum thresholds are met (1 clinical pathway per month).`
          : "No Pharmacy First activity captured — the single largest service income opportunity for English contractors.",
      });

      streams.push({
        label: "New Medicine Service (NMS)",
        value: tot.nms * RATES.nms,
        share: 0,
        trendPct: trendPct(sum(last6, "nms_count"), sum(prior6, "nms_count")),
        status: "neutral",
        basis: "estimate",
        note: tot.nms > 0
          ? `${tot.nms.toLocaleString()} interventions in 12m at ~£28 each. Caseload-driven and the highest £-per-minute service.`
          : "No NMS activity captured — straightforward to deploy with existing chronic-disease patients.",
      });

      streams.push({
        label: "Flu vaccinations",
        value: tot.flu * RATES.flu,
        share: 0,
        trendPct: trendPct(sum(last6, "flu_vaccinations"), sum(prior6, "flu_vaccinations")),
        status: "neutral",
        basis: "estimate",
        note: `${tot.flu.toLocaleString()} jabs in 12m — concentrated Oct–Dec, materially boosting Q3/Q4 cash.`,
      });
    }

    // Compute shares + statuses + total
    const totalRev = streams.reduce((s, x) => s + x.value, 0);
    streams.forEach((s) => {
      s.share = totalRev > 0 ? (s.value / totalRev) * 100 : 0;
      s.status = bandFor(s.share, s.trendPct, s.value);
    });

    // Monthly remuneration time series (last 12m)
    const monthlySeries = last12.map((r) => {
      const v = isScot
        ? (num(r.final_payment) > 0
            ? num(r.final_payment)
            : r.items_dispensed * RATES.itemFee
              + (num(r.pharmacy_first_payment) || r.pharmacy_first_count * RATES.pfConsult)
              + (num(r.mcr_payment) || r.mcr_items * RATES.mcrItem)
              + r.supervised_methadone_doses * RATES.methSupervision
              + (num(r.smoking_cessation_payment) || r.smoking_cessation * RATES.smokingEpisode)
              + r.ehc_items * RATES.ehcItem)
        : r.items_dispensed * RATES.itemFee
          + r.pharmacy_first_count * RATES.pfConsult
          + r.nms_count * RATES.nms
          + r.flu_vaccinations * RATES.flu;
      return { label: `${MONTHS[r.month - 1]} ${String(r.year).slice(2)}`, v: Math.round(v) };
    });

    // EPS efficiency (England)
    const epsRate = tot.items > 0 ? (tot.eps / tot.items) * 100 : 0;

    // Concentration / diversification
    const top = [...streams].sort((a, b) => b.value - a.value);
    const topShare = top[0]?.share || 0;
    const serviceShare = streams
      .filter((s) => !s.label.toLowerCase().startsWith("dispensing"))
      .reduce((s, x) => s + x.share, 0);

    // Strengths / weaknesses
    const strengths: string[] = [];
    const weaknesses: string[] = [];

    streams.forEach((s) => {
      if (s.status === "strong") strengths.push(`${s.label}: ${gbp(s.value)} (${s.share.toFixed(1)}% of remuneration) with a ${s.trendPct > 0 ? "+" : ""}${s.trendPct.toFixed(1)}% 6-month trajectory.`);
      if (s.status === "weak" && s.value > 0) weaknesses.push(`${s.label}: only ${gbp(s.value)} (${s.share.toFixed(1)}%) — trend ${s.trendPct.toFixed(1)}%.`);
      if (s.status === "neutral" && s.value === 0) weaknesses.push(`${s.label}: no activity recorded. Direct revenue left on the table.`);
    });

    if (serviceShare >= 18) strengths.push(`Service-income mix at ${serviceShare.toFixed(1)}% of total remuneration — well above the ~10% sector average, reducing exposure to dispensing-only margin pressure.`);
    if (serviceShare > 0 && serviceShare < 8) weaknesses.push(`Service-income mix only ${serviceShare.toFixed(1)}% of remuneration — heavy dependence on item volume and category-M clawback risk.`);
    if (topShare >= 75) weaknesses.push(`Concentration risk: ${top[0].label} accounts for ${topShare.toFixed(0)}% of remuneration. Any contractual change to that line would hit hard.`);
    if (!isScot && epsRate >= 95) strengths.push(`EPS rate ${epsRate.toFixed(1)}% — operationally efficient, faster reimbursement and minimal lost-script risk.`);
    if (!isScot && epsRate > 0 && epsRate < 85) weaknesses.push(`EPS rate ${epsRate.toFixed(1)}% — below the 95% best-practice threshold. Paper handling is slowing reimbursement and increasing exception risk.`);

    // Year-on-year items trend
    const itemsTrend = trendPct(sum(last6, "items_dispensed"), sum(prior6, "items_dispensed"));
    if (itemsTrend >= 5) strengths.push(`Item volumes up ${itemsTrend.toFixed(1)}% over the last 6 months vs the previous 6 — defensible growth in the core revenue line.`);
    if (itemsTrend <= -5) weaknesses.push(`Item volumes down ${itemsTrend.toFixed(1)}% over the last 6 months vs the previous 6 — directly compresses dispensing remuneration.`);

    return {
      streams, totalRev, monthlySeries, topShare, serviceShare,
      epsRate, itemsTrend, strengths, weaknesses, monthsActive,
      latestMonth: rows[endIdx],
    };
  }, [rows, isScot]);

  if (!analysis) return null;

  const { streams, totalRev, monthlySeries, serviceShare, strengths, weaknesses, latestMonth } = analysis;

  const palette = ["#b6873d", "#0ea5e9", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#6366f1"];

  // Narrative paragraphs (deterministic, no LLM)
  const narrativeParas: string[] = [];
  narrativeParas.push(
    `${pharmacy.name} generated approximately ${gbp(totalRev)} in NHS remuneration over the trailing twelve months${latestMonth ? ` to ${MONTHS[latestMonth.month - 1]} ${latestMonth.year}` : ""}. ` +
    `Dispensing fees against ${streams[0].value > 0 ? `${(streams[0].value / RATES.itemFee).toLocaleString(undefined, { maximumFractionDigits: 0 })} items` : "the dispensed volume"} form the financial backbone, contributing ${streams[0].share.toFixed(1)}% of the total. ` +
    `Clinical and public-health services together contribute ${serviceShare.toFixed(1)}%, with the strongest line being ${[...streams].sort((a, b) => b.value - a.value).find((s) => s.label !== streams[0].label)?.label ?? "—"}.`
  );
  narrativeParas.push(
    isScot
      ? `As a Scottish contractor the remuneration profile is shaped by NHS Scotland's negotiated services — MCR underpins predictable monthly income, Pharmacy First (Scotland) layers in walk-in clinical revenue, and the Public Health Service streams (smoking cessation, EHC, supervised methadone) provide incremental fee income. Where figures are sourced from PHS payment files they are flagged "actual"; where no payment file exists yet we have estimated the line from activity volumes against published tariff rates.`
      : `As an English contractor the headline service opportunities are Pharmacy First, NMS and seasonal flu. These three lines together can shift remuneration by tens of thousands of pounds annually with no additional capital outlay — the binding constraint is pharmacist time and patient identification, not eligibility.`
  );
  if (strengths.length || weaknesses.length) {
    narrativeParas.push(
      `On balance the data shows ${strengths.length} clear ${strengths.length === 1 ? "strength" : "strengths"} and ${weaknesses.length} ${weaknesses.length === 1 ? "area" : "areas"} of revenue weakness or opportunity, detailed below. The priority interventions are the lines flagged red — each one represents either underused capacity in a paid service or a structural risk that compresses future remuneration.`
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-base font-semibold">Remuneration & Payment Services Report</h3>
          <span className="ml-auto inline-flex items-center text-[10px] rounded-full bg-secondary px-2 py-0.5">
            Trailing 12 months
          </span>
        </div>
        <div className="space-y-3 text-sm leading-relaxed">
          {narrativeParas.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      </div>

      {/* Top-line cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total NHS remuneration (12m)" value={gbp(totalRev)} />
        <Stat label="Dispensing share" value={`${streams[0].share.toFixed(1)}%`} />
        <Stat label="Service income share" value={`${serviceShare.toFixed(1)}%`}
          tone={serviceShare >= 18 ? "good" : serviceShare < 8 ? "bad" : "neutral"} />
        <Stat
          label={isScot ? "Active payment files" : "EPS efficiency"}
          value={isScot ? `${analysis.monthsActive} / 12` : `${analysis.epsRate.toFixed(1)}%`}
          tone={isScot ? "neutral" : analysis.epsRate >= 95 ? "good" : analysis.epsRate < 85 ? "bad" : "neutral"}
        />
      </div>

      {/* Stream breakdown table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="p-5 pb-3">
          <h4 className="text-sm font-semibold">Revenue stream breakdown</h4>
          <p className="text-xs text-muted-foreground mt-1">Each line is rated against its share of total remuneration and its 6-month direction of travel.</p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-secondary text-muted-foreground text-xs">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Stream</th>
              <th className="text-right px-4 py-2 font-medium">12m £</th>
              <th className="text-right px-4 py-2 font-medium">Share</th>
              <th className="text-right px-4 py-2 font-medium">6m trend</th>
              <th className="text-left px-4 py-2 font-medium">Rating</th>
              <th className="text-left px-4 py-2 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {streams.map((s) => (
              <tr key={s.label} className="border-t border-border align-top">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 max-w-md">{s.note}</div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{gbp(s.value)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{s.share.toFixed(1)}%</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  <span className="inline-flex items-center gap-1 justify-end">
                    {trendIcon(s.trendPct)}
                    <span className={s.trendPct > 0 ? "text-emerald-700" : s.trendPct < 0 ? "text-rose-700" : "text-muted-foreground"}>
                      {s.value > 0 ? `${s.trendPct > 0 ? "+" : ""}${s.trendPct.toFixed(1)}%` : "—"}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2.5">{statusChip(s.status)}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-[10px] uppercase tracking-wide ${s.basis === "actual" ? "text-emerald-700" : "text-muted-foreground"}`}>
                    {s.basis}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Composition chart */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h4 className="text-sm font-semibold mb-3">Composition of remuneration</h4>
        <div className="space-y-2">
          {streams.filter((s) => s.value > 0).map((s, i) => (
            <div key={s.label}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium truncate">{s.label}</span>
                <span className="tabular-nums text-muted-foreground">{gbp(s.value)} · {s.share.toFixed(1)}%</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.max(0.5, s.share)}%`, background: palette[i % palette.length] }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Monthly run-rate */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h4 className="text-sm font-semibold mb-3">Monthly remuneration run-rate</h4>
        <div className="h-56">
          <ResponsiveContainer>
            <BarChart data={monthlySeries} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `£${Math.round(v / 1000)}k`} />
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                formatter={(v: any) => [gbp(Number(v)), "Remuneration"]}
              />
              <Bar dataKey="v" radius={[3, 3, 0, 0]}>
                {monthlySeries.map((_, i) => <RCell key={i} fill="var(--gold)" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Strengths / weaknesses */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-700" />
            <h4 className="text-sm font-semibold text-emerald-900">Remuneration strengths</h4>
          </div>
          {strengths.length === 0 ? (
            <p className="text-sm text-muted-foreground">No standout remuneration strengths identified at current activity levels.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2"><span className="text-emerald-700 mt-1">•</span><span>{s}</span></li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-rose-700" />
            <h4 className="text-sm font-semibold text-rose-900">Weaknesses & opportunities</h4>
          </div>
          {weaknesses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No material remuneration weaknesses detected.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {weaknesses.map((w, i) => (
                <li key={i} className="flex items-start gap-2"><span className="text-rose-700 mt-1">•</span><span>{w}</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          Figures labelled <span className="text-emerald-700">actual</span> are taken directly from NHS payment files; figures labelled <span>estimate</span> apply published Drug Tariff / service rates to reported activity. Upload FP34C schedules in the Acquisition tab to replace all estimates with verified payments.
        </span>
      </p>
    </div>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "bad" | "neutral" }) {
  const cls =
    tone === "good" ? "text-emerald-700" :
    tone === "bad" ? "text-rose-700" :
    "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${cls}`}>{value}</p>
    </div>
  );
}

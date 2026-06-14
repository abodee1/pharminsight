import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader } from "@/components/PageHeader";
import { DataAttribution } from "@/components/DataAttribution";
import { useAuth } from "@/hooks/useAuth";
import {
  X, Trophy, TrendingUp, TrendingDown, Minus,
  Copy, Check, ChevronDown, ChevronRight, Info,
} from "lucide-react";
import { PharmacySearch } from "@/components/PharmacySearch";
import { CountryBadge } from "@/components/CountryBadge";
import { Badge } from "@/components/ui/badge";
import { GpFeederOverlap } from "@/components/GpFeederOverlap";
import { CompetitorHeatmap } from "@/components/CompetitorHeatmap";
import { getViewedPharmacy } from "@/lib/viewedPharmacy";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  PieChart, Pie, Cell,
} from "recharts";
import { cn } from "@/lib/utils";
import { pharmacyDisplayName } from "@/lib/pharmacyName";

export const Route = createFileRoute("/_authenticated/compare")({
  component: Compare,
  validateSearch: (s: Record<string, unknown>) => ({
    add: typeof s.add === "string" ? s.add : undefined,
  }),
});

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const SERIES_COLORS = ["var(--cmp-1)","var(--cmp-2)","var(--cmp-3)","var(--cmp-4)"];
const MAX_SELECT = 4;

type AggMode = "latest" | "total" | "avg";
type TrendWindow = 0 | 3 | 6 | 12 | 24;
type Group = "volume" | "services" | "rate" | "money";
type Applies = "all" | "england" | "scotland";

type MetricDef = {
  key: string;
  label: string;
  short: string;
  desc: string;
  group: Group;
  applies: Applies;
  compute: (r: Row) => number;
  format: (v: number) => string;
};

const fmtInt  = (v: number) => Math.round(v).toLocaleString();
const fmtPct  = (v: number) => `${v.toFixed(1)}%`;
const fmtGbp  = (v: number) => "£" + Math.round(v).toLocaleString();
const fmtGbp2 = (v: number) => "£" + v.toFixed(2);
const fmtRate = (v: number) => v.toFixed(2);

const METRICS: MetricDef[] = [
  // ── Volume ─────────────────────────────────────────────────────────────
  { key: "items_dispensed", label: "Items dispensed", short: "Items", group: "volume", applies: "all",
    desc: "Total prescription items dispensed. The primary driver of NHS pharmacy income.",
    compute: (r) => r?.items_dispensed ?? 0, format: fmtInt },
  { key: "eps_items", label: "EPS items", short: "EPS", group: "volume", applies: "england",
    desc: "Items dispensed via the Electronic Prescription Service.",
    compute: (r) => r?.eps_items ?? 0, format: fmtInt },
  { key: "eps_nominations", label: "EPS nominations", short: "Nom.", group: "volume", applies: "england",
    desc: "Patients nominally registered to this pharmacy via EPS — a key driver of future item volume.",
    compute: (r) => r?.eps_nominations ?? 0, format: fmtInt },
  { key: "flu_vaccinations", label: "Flu vaccinations", short: "Flu", group: "volume", applies: "england",
    desc: "Seasonal NHS flu vaccinations delivered.",
    compute: (r) => r?.flu_vaccinations ?? 0, format: fmtInt },
  { key: "mcr_items", label: "MCR items", short: "MCR items", group: "volume", applies: "scotland",
    desc: "Items dispensed under Scotland's Medicines Care & Review serial-prescription service.",
    compute: (r) => r?.mcr_items ?? 0, format: fmtInt },
  { key: "mcr_registrations", label: "MCR registrations", short: "MCR reg.", group: "volume", applies: "scotland",
    desc: "Patients registered for MCR — a proxy for chronic-care caseload.",
    compute: (r) => r?.mcr_registrations ?? 0, format: fmtInt },
  { key: "methadone_items", label: "Methadone items", short: "Methadone", group: "volume", applies: "scotland",
    desc: "Methadone (and other OST) items dispensed.",
    compute: (r) => r?.methadone_items ?? 0, format: fmtInt },
  { key: "supervised_methadone_doses", label: "Supervised doses", short: "Supervised", group: "volume", applies: "scotland",
    desc: "Doses consumed under direct pharmacist supervision.",
    compute: (r) => r?.supervised_methadone_doses ?? 0, format: fmtInt },
  { key: "ehc_items", label: "EHC items", short: "EHC", group: "volume", applies: "scotland",
    desc: "Emergency hormonal contraception supplies issued.",
    compute: (r) => r?.ehc_items ?? 0, format: fmtInt },
  { key: "smoking_cessation", label: "Smoking cessation", short: "Stop Sm.", group: "volume", applies: "scotland",
    desc: "Smoking-cessation interventions under NHS Scotland.",
    compute: (r) => r?.smoking_cessation ?? 0, format: fmtInt },

  // ── Clinical services ───────────────────────────────────────────────────
  { key: "pharmacy_first_count", label: "Pharmacy First consultations", short: "PF", group: "services", applies: "all",
    desc: "Pharmacy First consultations delivered. England: paid ~£15–45 each depending on condition.",
    compute: (r) => r?.pharmacy_first_count ?? 0, format: fmtInt },
  { key: "nms_count", label: "NMS consultations", short: "NMS", group: "services", applies: "england",
    desc: "New Medicine Service consultations — NHS pays ~£28 per completed intervention.",
    compute: (r) => r?.nms_count ?? 0, format: fmtInt },

  // ── Rates (size-adjusted) ───────────────────────────────────────────────
  { key: "eps_share", label: "EPS share", short: "EPS %", group: "rate", applies: "england",
    desc: "Share of items routed through EPS. Above 95% indicates excellent digital adoption.",
    compute: (r) => (r?.items_dispensed ?? 0) > 0 ? ((r?.eps_items ?? 0) / r.items_dispensed) * 100 : 0,
    format: fmtPct },
  { key: "nom_rate", label: "Nomination rate", short: "Nom %", group: "rate", applies: "england",
    desc: "EPS nominations as a % of items — measures how 'sticky' patient loyalty is.",
    compute: (r) => (r?.items_dispensed ?? 0) > 0 ? ((r?.eps_nominations ?? 0) / r.items_dispensed) * 100 : 0,
    format: fmtPct },
  { key: "pf_per_1k", label: "PF per 1k items", short: "PF/1k", group: "rate", applies: "all",
    desc: "Pharmacy First consultations per 1,000 items — size-adjusted clinical service intensity.",
    compute: (r) => (r?.items_dispensed ?? 0) > 0 ? ((r?.pharmacy_first_count ?? 0) * 1000) / r.items_dispensed : 0,
    format: fmtRate },
  { key: "nms_per_1k", label: "NMS per 1k items", short: "NMS/1k", group: "rate", applies: "england",
    desc: "NMS per 1,000 items — measures conversion of new prescriptions into paid NMS.",
    compute: (r) => (r?.items_dispensed ?? 0) > 0 ? ((r?.nms_count ?? 0) * 1000) / r.items_dispensed : 0,
    format: fmtRate },
  { key: "nms_cap_util", label: "NMS cap utilisation", short: "NMS cap%", group: "rate", applies: "england",
    desc: "NMS as % of the 1% monthly cap (nms / items × 100). Above 100% means overclaiming risk.",
    compute: (r) => (r?.items_dispensed ?? 0) > 0 ? ((r?.nms_count ?? 0) / (r.items_dispensed * 0.01)) * 100 : 0,
    format: fmtPct },
  { key: "mcr_share", label: "MCR share", short: "MCR %", group: "rate", applies: "scotland",
    desc: "Share of total items dispensed under the MCR pathway.",
    compute: (r) => (r?.items_dispensed ?? 0) > 0 ? ((r?.mcr_items ?? 0) / r.items_dispensed) * 100 : 0,
    format: fmtPct },

  // ── Payments (£) ────────────────────────────────────────────────────────
  { key: "final_payment", label: "Final NHS payment", short: "NHS £", group: "money", applies: "all",
    desc: "Final NHS payment for the month after all fees, allowances and clawbacks.",
    compute: (r) => Number(r?.final_payment) || 0, format: fmtGbp },
  { key: "gross_cost", label: "Gross ingredient cost", short: "Gross £", group: "money", applies: "all",
    desc: "Gross ingredient cost of drugs dispensed before deductions.",
    compute: (r) => Number(r?.gross_cost) || 0, format: fmtGbp },
  { key: "pharmacy_first_payment", label: "Pharmacy First payment", short: "PF £", group: "money", applies: "all",
    desc: "Direct NHS payments received for Pharmacy First consultations.",
    compute: (r) => Number(r?.pharmacy_first_payment) || 0, format: fmtGbp },
  { key: "mcr_payment", label: "MCR payment", short: "MCR £", group: "money", applies: "scotland",
    desc: "NHS Scotland payment for MCR service delivery.",
    compute: (r) => Number(r?.mcr_payment) || 0, format: fmtGbp },
  { key: "revenue_per_item", label: "Revenue per item", short: "£/item", group: "money", applies: "all",
    desc: "Final NHS payment ÷ items dispensed — a measure of revenue efficiency per script.",
    compute: (r) => (r?.items_dispensed ?? 0) > 0 ? (Number(r?.final_payment) || 0) / r.items_dispensed : 0,
    format: fmtGbp2 },
];

const GROUP_LABELS: Record<Group, string> = {
  volume: "Volumes",
  services: "Clinical services",
  rate: "Rates & intensity",
  money: "Payments (£)",
};

const isScot = (c: string | null | undefined) => (c || "").toLowerCase() === "scotland";

function appliesToCountry(applies: Applies, country: string | null | undefined) {
  if (applies === "all") return true;
  if (applies === "scotland") return isScot(country);
  return !isScot(country);
}

type Pharm = { id: string; ods_code: string; name: string; trading_name?: string | null; region: string | null; country: string | null; postcode: string | null; lat?: number | null; lng?: number | null };
type Row = {
  pharmacy_id: string; month: number; year: number;
  items_dispensed: number; nms_count: number; pharmacy_first_count: number;
  flu_vaccinations: number; eps_items: number; eps_nominations: number;
  gross_cost: number | string | null;
  pharmacy_first_payment: number | string | null;
  mcr_payment: number | string | null;
  final_payment: number | string | null;
  mcr_registrations: number; mcr_items: number;
  ehc_items: number; methadone_items: number; supervised_methadone_doses: number;
  smoking_cessation: number;
};

function periodKey(r: { year: number; month: number }) {
  return `${r.year}-${String(r.month).padStart(2, "0")}`;
}

function computeAgg(mt: MetricDef, phRows: Row[], aggMode: AggMode): number {
  if (phRows.length === 0) return 0;
  const sorted = [...phRows].sort((a, b) => (a.year - b.year) || (a.month - b.month));
  if (mt.group === "rate") {
    const nonZero = sorted.filter(r => mt.compute(r) > 0);
    return nonZero.length ? nonZero.reduce((s, r) => s + mt.compute(r), 0) / nonZero.length : 0;
  }
  if (aggMode === "latest") {
    for (let i = sorted.length - 1; i >= 0; i--) {
      const v = mt.compute(sorted[i]);
      if (v > 0) return v;
    }
    return 0;
  }
  if (aggMode === "total") return sorted.reduce((s, r) => s + mt.compute(r), 0);
  // avg
  const nonZero = sorted.filter(r => mt.compute(r) > 0);
  return nonZero.length ? nonZero.reduce((s, r) => s + mt.compute(r), 0) / nonZero.length : 0;
}

// ── Inline Sparkline ──────────────────────────────────────────────────────
function Sparkline({ vals, color }: { vals: number[]; color: string }) {
  if (vals.length < 2) return <span className="w-14 shrink-0" />;
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals.filter(v => v > 0), 0);
  const range = max - min || 1;
  const W = 56, H = 22;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={W} height={H} className="shrink-0 opacity-80">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── YoY badge ──────────────────────────────────────────────────────────────
function YoyBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[10px] text-muted-foreground">—</span>;
  if (Math.abs(pct) < 0.5) return (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
      <Minus className="h-2.5 w-2.5" />flat
    </span>
  );
  return pct > 0 ? (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
      <TrendingUp className="h-2.5 w-2.5" />+{pct.toFixed(1)}%
    </span>
  ) : (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-500">
      <TrendingDown className="h-2.5 w-2.5" />{pct.toFixed(1)}%
    </span>
  );
}

// ── compact number for Y axis ─────────────────────────────────────────────
function yFmt(v: number, group: Group): string {
  const abs = Math.abs(v);
  const prefix = group === "money" ? "£" : "";
  const suffix = group === "rate" ? (v.toString().includes(".") ? "" : "") : "";
  if (abs >= 1_000_000) return prefix + (v / 1_000_000).toFixed(1) + "m" + suffix;
  if (abs >= 10_000) return prefix + Math.round(v / 1000) + "k" + suffix;
  if (abs >= 1_000) return prefix + (v / 1000).toFixed(1) + "k" + suffix;
  if (group === "rate") return v.toFixed(1);
  return prefix + Math.round(v).toString();
}

// ── Main component ─────────────────────────────────────────────────────────
function Compare() {
  const { user } = useAuth();
  const { add: addOds } = Route.useSearch();
  const navigate = Route.useNavigate();

  const [pharms, setPharms] = useState<Pharm[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  // ── Controls ──────────────────────────────────────────────────────────
  const [trendWindow, setTrendWindow] = useState<TrendWindow>(12);
  const [aggMode, setAggMode] = useState<AggMode>("total");
  const [trendMetricKey, setTrendMetricKey] = useState<string>("items_dispensed");
  const [visibleGroups, setVisibleGroups] = useState<Set<Group>>(
    new Set(["volume", "services", "rate", "money"])
  );
  const [gpFeederWindow, setGpFeederWindow] = useState<0 | 3 | 6 | 12 | 24>(12);
  const [copied, setCopied] = useState(false);
  const [, setLoading] = useState(false);
  const [nearbyPharms, setNearbyPharms] = useState<{ id: string; ods_code: string; name: string; address: string | null; postcode: string | null; country: string | null; region?: string | null }[]>([]);

  // ── Collapsed sections ──────────────────────────────────────────────────
  const [radarOpen, setRadarOpen] = useState(true);
  const [gpOpen, setGpOpen] = useState(true);

  const colorFor = useCallback(
    (id: string) => SERIES_COLORS[selected.indexOf(id) % SERIES_COLORS.length],
    [selected]
  );

  // Preload subject pharmacy
  useEffect(() => {
    if (!user) return;
    (async () => {
      const viewed = getViewedPharmacy();
      let subjectId: string | null = null;
      if (viewed?.id) {
        subjectId = viewed.id;
      } else {
        const { data: up } = await supabase
          .from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle();
        subjectId = up?.pharmacy_id ?? null;
      }
      if (!subjectId) return;
      const { data: ph } = await supabase
        .from("pharmacies").select("id,name,trading_name,region,country,postcode,lat,lng")
        .eq("id", subjectId).maybeSingle();
      if (ph) {
        setPharms(cur => cur.some(x => x.id === ph.id) ? cur : [...cur, ph as Pharm]);
        setSelected(cur => cur.includes(ph.id) ? cur : [ph.id, ...cur]);
      }
    })();
  }, [user]);

  // Quick-add from ?add=<ods_code>
  useEffect(() => {
    if (!addOds) return;
    (async () => {
      const { data: ph } = await supabase
        .from("pharmacies").select("id,name,trading_name,region,country,postcode,lat,lng")
        .eq("ods_code", addOds).maybeSingle();
      if (ph) {
        setPharms(cur => cur.some(x => x.id === ph.id) ? cur : [...cur, ph as Pharm]);
        setSelected(cur => {
          if (cur.includes(ph.id)) return cur;
          if (cur.length >= MAX_SELECT) return cur;
          return [...cur, ph.id];
        });
      }
      navigate({ search: { add: undefined }, replace: true });
    })();
  }, [addOds, navigate]);

  // Fetch nearby pharmacies for search suggestions (based on first selected pharmacy)
  useEffect(() => {
    const subjectId = selected[0];
    if (!subjectId) { setNearbyPharms([]); return; }
    const subject = pharms.find(p => p.id === subjectId);
    const lat = subject?.lat;
    const lng = subject?.lng;
    if (!lat || !lng) { setNearbyPharms([]); return; }
    (async () => {
      const { data } = await supabase.rpc("pharmacies_near", {
        p_lat: lat, p_lng: lng, p_radius_m: 8047, p_limit: 20,
      });
      const nearby = ((data ?? []) as { id: string; ods_code: string; name: string; address: string | null; postcode: string | null; country: string | null; region?: string | null; distance_m: number }[])
        .filter(p => p.id !== subjectId)
        .sort((a, b) => a.distance_m - b.distance_m)
        .map(({ distance_m: _d, ...rest }) => rest);
      setNearbyPharms(nearby);
    })();
  }, [selected, pharms]);

  // Fetch dispensing data
  useEffect(() => {
    if (selected.length === 0) { setRows([]); return; }
    setLoading(true);
    (async () => {
      const now = new Date();
      const cutoffYear = now.getFullYear() - 5;
      const data = await fetchAll<Row>((from, to) =>
        supabase.from("dispensing_data")
          .select("pharmacy_id,month,year,items_dispensed,nms_count,pharmacy_first_count,flu_vaccinations,eps_items,eps_nominations,gross_cost,pharmacy_first_payment,mcr_payment,final_payment,mcr_registrations,mcr_items,ehc_items,methadone_items,supervised_methadone_doses,smoking_cessation")
          .in("pharmacy_id", selected)
          .gte("year", cutoffYear)
          .order("year", { ascending: true })
          .order("month", { ascending: true })
          .range(from, to)
      );
      setRows(data);
      setLoading(false);
    })();
  }, [selected]);

  const selectedPharms = useMemo(
    () => selected.map(id => pharms.find(p => p.id === id)).filter(Boolean) as Pharm[],
    [selected, pharms]
  );

  // All unique periods in data
  const allPeriods = useMemo(
    () => Array.from(new Set(rows.map(r => periodKey(r)))).sort(),
    [rows]
  );

  // Periods in the current window
  const windowPeriods = useMemo(
    () => new Set(trendWindow === 0 ? allPeriods : allPeriods.slice(-trendWindow)),
    [allPeriods, trendWindow]
  );

  // Periods for YoY comparison (same N months, 1 year prior)
  const priorPeriods = useMemo(() => {
    if (trendWindow === 0) return new Set<string>();
    const shifted = new Set<string>();
    windowPeriods.forEach(p => {
      const [y, m] = p.split("-").map(Number);
      shifted.add(`${y - 1}-${String(m).padStart(2, "0")}`);
    });
    return shifted;
  }, [windowPeriods, trendWindow]);

  // Metrics applicable to AT LEAST one selected pharmacy
  const activeMetrics = useMemo(
    () => METRICS.filter(mt => selectedPharms.some(ph => appliesToCountry(mt.applies, ph.country))),
    [selectedPharms]
  );

  // Metrics filtered by visible groups
  const visibleMetrics = useMemo(
    () => activeMetrics.filter(mt => visibleGroups.has(mt.group)),
    [activeMetrics, visibleGroups]
  );

  // Per pharmacy × metric: { current, prior, yoy, sparkVals }
  const tableData = useMemo(() => {
    const out = new Map<string, { current: number; prior: number; yoy: number | null; spark: number[] }>();
    selectedPharms.forEach(ph => {
      const phRows = rows.filter(r => r.pharmacy_id === ph.id);
      const phCurrent = phRows.filter(r => windowPeriods.has(periodKey(r)));
      const phPrior = phRows.filter(r => priorPeriods.has(periodKey(r)));
      METRICS.forEach(mt => {
        const current = computeAgg(mt, phCurrent, aggMode);
        const prior = computeAgg(mt, phPrior, aggMode);
        const yoy = prior > 0 ? ((current - prior) / prior) * 100 : null;
        // Sparkline: monthly values over window sorted
        const spark = [...phCurrent]
          .sort((a, b) => (a.year - b.year) || (a.month - b.month))
          .map(r => mt.compute(r));
        out.set(`${ph.id}::${mt.key}`, { current, prior, yoy, spark });
      });
    });
    return out;
  }, [selectedPharms, rows, windowPeriods, priorPeriods, aggMode]);

  // Winners per metric
  const winners = useMemo(() => {
    const out: Record<string, string> = {};
    activeMetrics.forEach(mt => {
      let best = -1; let id = "";
      selectedPharms.forEach(ph => {
        if (!appliesToCountry(mt.applies, ph.country)) return;
        const v = tableData.get(`${ph.id}::${mt.key}`)?.current ?? 0;
        if (v > best) { best = v; id = ph.id; }
      });
      if (id && best > 0) out[mt.key] = id;
    });
    return out;
  }, [selectedPharms, tableData, activeMetrics]);

  const winsCount = useMemo(() => {
    const out: Record<string, number> = {};
    selectedPharms.forEach(ph => { out[ph.id] = 0; });
    Object.values(winners).forEach(id => { out[id] = (out[id] ?? 0) + 1; });
    return out;
  }, [winners, selectedPharms]);

  // Trend chart data
  const trendMetricDef = useMemo(
    () => METRICS.find(m => m.key === trendMetricKey) ?? METRICS[0],
    [trendMetricKey]
  );

  const trendData = useMemo(() => {
    const mt = trendMetricDef;
    const periods = trendWindow === 0 ? allPeriods : allPeriods.slice(-trendWindow);
    return periods.map(p => {
      const [y, m] = p.split("-").map(Number);
      const point: Record<string, any> = { label: `${MONTHS[m - 1]} '${String(y).slice(2)}` };
      selectedPharms.forEach(ph => {
        if (!appliesToCountry(mt.applies, ph.country)) { point[ph.id] = null; return; }
        const r = rows.find(rr => rr.pharmacy_id === ph.id && rr.year === y && rr.month === m);
        point[ph.id] = r ? mt.compute(r) : 0;
      });
      return point;
    }).map((point, i, arr) => {
      // Trim trailing zeros per pharmacy
      selectedPharms.forEach(ph => {
        let lastNonZero = -1;
        for (let j = arr.length - 1; j >= 0; j--) {
          if ((arr[j][ph.id] ?? 0) > 0) { lastNonZero = j; break; }
        }
        if (i > lastNonZero) point[ph.id] = null;
      });
      return point;
    });
  }, [trendMetricDef, allPeriods, trendWindow, selectedPharms, rows]);

  // Items share for donut
  const itemsShare = useMemo(() => {
    return selectedPharms.map(ph => {
      const phRows = rows.filter(r => r.pharmacy_id === ph.id && windowPeriods.has(periodKey(r)));
      const total = phRows.reduce((s, r) => s + (r.items_dispensed || 0), 0);
      return { id: ph.id, name: pharmacyDisplayName(ph.name, ph.trading_name, ph.ods_code), value: total };
    });
  }, [selectedPharms, rows, windowPeriods]);
  const itemsTotal = itemsShare.reduce((s, x) => s + x.value, 0);

  // Radar (non-money, normalised)
  const radar = useMemo(() => {
    return activeMetrics.filter(mt => mt.group !== "money").map(mt => {
      const point: Record<string, any> = { metric: mt.short };
      const vals = selectedPharms.map(ph =>
        appliesToCountry(mt.applies, ph.country)
          ? (tableData.get(`${ph.id}::${mt.key}`)?.current ?? 0) : 0
      );
      const max = Math.max(1, ...vals);
      selectedPharms.forEach((ph, i) => { point[ph.id] = Math.round((vals[i] / max) * 100); });
      return point;
    });
  }, [selectedPharms, tableData, activeMetrics]);

  function remove(id: string) { setSelected(cur => cur.filter(x => x !== id)); }

  function toggleGroup(g: Group) {
    setVisibleGroups(prev => {
      const next = new Set(prev);
      if (next.has(g)) { if (next.size > 1) next.delete(g); } else next.add(g);
      return next;
    });
  }

  function exportCsv() {
    const aggLabel = aggMode === "latest" ? "Latest" : aggMode === "total" ? "Total" : "Monthly avg";
    const lines: string[] = [];
    const header = ["Metric", "Group", ...selectedPharms.flatMap(ph => { const dn = pharmacyDisplayName(ph.name, ph.trading_name, ph.ods_code); return [`"${dn}" ${aggLabel}`, `${dn} YoY%`]; })];
    lines.push(header.join(","));
    visibleMetrics.forEach(mt => {
      const row = [`"${mt.label}"`, mt.group];
      selectedPharms.forEach(ph => {
        const d = tableData.get(`${ph.id}::${mt.key}`);
        row.push(d && d.current > 0 ? mt.format(d.current) : "—");
        row.push(d?.yoy != null ? `${d.yoy.toFixed(1)}%` : "—");
      });
      lines.push(row.join(","));
    });
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  const windowLabel = trendWindow === 0 ? "All time" : `Last ${trendWindow} months`;
  const aggLabel = aggMode === "latest" ? "Latest month" : aggMode === "total" ? `${windowLabel} total` : `${windowLabel} avg/month`;

  return (
    <div className="p-3 sm:p-6 md:p-10 max-w-7xl mx-auto space-y-5">
      <PageHeader
        title="Compare pharmacies"
        subtitle="Pick up to 4 pharmacies. Customise the period, metric groups, and aggregation mode for a full side-by-side view."
      />

      {/* ── Pharmacy selector ─────────────────────────────────────────── */}
      <div className="rounded-xl bg-card border border-border p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="md:w-[400px] shrink-0">
            {selected.length < MAX_SELECT ? (
              <PharmacySearch
                placeholder="Search by name, postcode or ODS code…"
                excludeIds={selected}
                clearOnSelect
                suggestions={nearbyPharms}
                suggestionsLabel={selectedPharms[0] ? `Nearby ${pharmacyDisplayName(selectedPharms[0].name, selectedPharms[0].trading_name, selectedPharms[0].ods_code)}` : "Nearby pharmacies"}
                onSelect={async (p) => {
                  if (selected.includes(p.id) || selected.length >= MAX_SELECT) return;
                  const { data: geo } = await supabase
                    .from("pharmacies").select("lat,lng").eq("id", p.id).maybeSingle();
                  setPharms(cur =>
                    cur.some(x => x.id === p.id) ? cur :
                    [...cur, { id: p.id, name: p.name, trading_name: p.trading_name ?? null, region: p.region ?? null, country: p.country ?? null, postcode: p.postcode ?? null, lat: geo?.lat ?? null, lng: geo?.lng ?? null }]
                  );
                  setSelected(cur => [...cur, p.id]);
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground italic py-2">Maximum {MAX_SELECT} selected — remove one to add another.</p>
            )}
            <p className="mt-1.5 text-[11px] text-muted-foreground">{selected.length}/{MAX_SELECT} selected</p>
          </div>

          <div className="flex-1 flex flex-wrap items-start gap-2 min-h-[36px]">
            {selectedPharms.length === 0 && (
              <span className="text-sm text-muted-foreground self-center">Add at least 2 pharmacies to compare.</span>
            )}
            {selectedPharms.map(ph => (
              <span key={ph.id}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary pl-3 pr-1 py-1 text-sm max-w-full">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: colorFor(ph.id) }} />
                <span className="font-medium truncate max-w-[180px]">{pharmacyDisplayName(ph.name, ph.trading_name, ph.ods_code)}</span>
                <CountryBadge country={ph.country} />
                {ph.region && <span className="text-xs text-muted-foreground truncate max-w-[100px]">{ph.region}</span>}
                <button onClick={() => remove(ph.id)} className="ml-1 rounded-full p-1 hover:bg-background" aria-label="Remove">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>

      {selectedPharms.length >= 1 && (
        <>
          {/* ── Control bar ───────────────────────────────────────────── */}
          <div className="rounded-xl bg-card border border-border p-3 sm:p-4 shadow-sm space-y-3">
            <div className="flex flex-wrap gap-4 items-start">

              {/* Period */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Period</p>
                <div className="inline-flex rounded-md border border-border bg-secondary/40 p-0.5">
                  {([3, 6, 12, 24, 0] as TrendWindow[]).map(w => (
                    <button key={w} type="button" onClick={() => setTrendWindow(w)}
                      className={cn("px-2.5 py-1 text-[11px] font-semibold rounded transition-colors",
                        trendWindow === w ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      )}>
                      {w === 0 ? "All" : `${w}M`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Aggregation */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Table shows</p>
                <div className="inline-flex rounded-md border border-border bg-secondary/40 p-0.5">
                  {(["latest", "total", "avg"] as AggMode[]).map(m => (
                    <button key={m} type="button" onClick={() => setAggMode(m)}
                      className={cn("px-2.5 py-1 text-[11px] font-semibold rounded transition-colors",
                        aggMode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      )}>
                      {m === "latest" ? "Latest" : m === "total" ? "Total" : "Avg/mo"}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">{aggLabel} · YoY vs same period prior year</p>
              </div>

              {/* Group toggles */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Show groups</p>
                <div className="flex flex-wrap gap-1">
                  {(["volume", "services", "rate", "money"] as Group[]).map(g => (
                    <button key={g} type="button" onClick={() => toggleGroup(g)}
                      className={cn("px-2.5 py-1 text-[11px] font-semibold rounded-md border transition-colors",
                        visibleGroups.has(g)
                          ? "bg-foreground text-background border-foreground"
                          : "bg-secondary/40 text-muted-foreground border-border hover:text-foreground"
                      )}>
                      {GROUP_LABELS[g]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Export */}
              <div className="ml-auto self-end">
                <button type="button" onClick={exportCsv}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[11px] font-semibold hover:bg-secondary/60 transition-colors">
                  {copied ? <><Check className="h-3.5 w-3.5 text-emerald-500" /> Copied!</> : <><Copy className="h-3.5 w-3.5" /> Export CSV</>}
                </button>
              </div>
            </div>
          </div>

          {/* ── Summary scorecards ─────────────────────────────────────── */}
          {selectedPharms.length >= 2 && (
            <div className={cn("grid gap-3", selectedPharms.length === 2 ? "grid-cols-2" : selectedPharms.length === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4")}>
              {selectedPharms.map(ph => {
                const items = tableData.get(`${ph.id}::items_dispensed`)?.current ?? 0;
                const itemsYoy = tableData.get(`${ph.id}::items_dispensed`)?.yoy ?? null;
                const nhs = tableData.get(`${ph.id}::final_payment`)?.current ?? 0;
                const nhsYoy = tableData.get(`${ph.id}::final_payment`)?.yoy ?? null;
                const pf = tableData.get(`${ph.id}::pharmacy_first_count`)?.current ?? 0;
                const wins = winsCount[ph.id] ?? 0;
                const total = Object.keys(winners).length;
                return (
                  <div key={ph.id} className="rounded-xl bg-card border border-border p-4 shadow-sm"
                    style={{ borderTop: `3px solid ${colorFor(ph.id)}` }}>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{pharmacyDisplayName(ph.name, ph.trading_name, ph.ods_code)}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{ph.region}</p>
                      </div>
                      {wins > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400 shrink-0">
                          <Trophy className="h-3 w-3" />{wins}/{total}
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Items</p>
                        <div className="flex items-baseline gap-2">
                          <p className="text-base font-bold tabular-nums">{items ? fmtInt(items) : "—"}</p>
                          <YoyBadge pct={itemsYoy} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">NHS £</p>
                          <div className="flex items-baseline gap-1 flex-wrap">
                            <p className="text-sm font-bold tabular-nums">{nhs ? fmtGbp(nhs) : "—"}</p>
                            <YoyBadge pct={nhsYoy} />
                          </div>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">PF</p>
                          <p className="text-sm font-bold tabular-nums">{pf ? fmtInt(pf) : "—"}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Unified trend chart ───────────────────────────────────── */}
          {selectedPharms.length >= 2 && (
            <div className="rounded-xl bg-card border border-border p-4 sm:p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-sm font-semibold">Performance trend — {trendMetricDef.label}</h2>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{trendMetricDef.desc}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  {selectedPharms.map(ph => (
                    <span key={ph.id} className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-4 rounded-sm" style={{ background: colorFor(ph.id) }} />
                      <span className="text-muted-foreground truncate max-w-[100px]">{pharmacyDisplayName(ph.name, ph.trading_name, ph.ods_code)}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Metric picker */}
              <div className="flex flex-wrap gap-1 mb-4">
                {activeMetrics.map(mt => (
                  <button key={mt.key} type="button" onClick={() => setTrendMetricKey(mt.key)}
                    className={cn(
                      "px-2.5 py-1 text-[11px] font-semibold rounded-md border transition-colors",
                      trendMetricKey === mt.key
                        ? "bg-foreground text-background border-foreground"
                        : "bg-secondary/40 text-muted-foreground border-border hover:text-foreground"
                    )}>
                    {mt.short}
                  </button>
                ))}
              </div>

              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)"
                      tickFormatter={v => yFmt(v, trendMetricDef.group)} width={56} />
                    <Tooltip
                      contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number, _name: string, ctx: any) => {
                        const ph = pharms.find(p => p.id === ctx.dataKey);
                        return [trendMetricDef.format(v), ph ? pharmacyDisplayName(ph.name, ph.trading_name, ph.ods_code) : ctx.dataKey];
                      }}
                    />
                    {selectedPharms
                      .filter(ph => appliesToCountry(trendMetricDef.applies, ph.country))
                      .map(ph => (
                        <Line key={ph.id} type="monotone" dataKey={ph.id}
                          stroke={colorFor(ph.id)} strokeWidth={2.5}
                          dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
                      ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Side-by-side metrics table ────────────────────────────── */}
          {selectedPharms.length >= 2 && visibleMetrics.length > 0 && (
            <div className="rounded-xl bg-card border border-border shadow-sm overflow-hidden">
              <div className="px-4 sm:px-6 py-4 border-b border-border flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">Side-by-side metrics</h2>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{aggLabel} · ★ marks the leader per row · sparkline shows the period trend</p>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Info className="h-3.5 w-3.5" />
                  <span>Rate metrics always show period average</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[540px]">
                  <thead>
                    <tr className="bg-secondary/60 border-b border-border">
                      <th className="text-left px-4 sm:px-6 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold w-[200px]">Metric</th>
                      {selectedPharms.map(ph => (
                        <th key={ph.id} className="px-3 sm:px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ background: colorFor(ph.id) }} />
                            <span className="truncate max-w-[120px]">{pharmacyDisplayName(ph.name, ph.trading_name, ph.ods_code)}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(["volume", "services", "rate", "money"] as Group[]).map(group => {
                      const groupMetrics = visibleMetrics.filter(mt => mt.group === group);
                      if (!groupMetrics.length) return null;
                      return (
                        <Fragment key={group}>
                          <tr className="bg-secondary/30 border-t border-border">
                            <td colSpan={selectedPharms.length + 1} className="px-4 sm:px-6 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                              {GROUP_LABELS[group]}
                            </td>
                          </tr>
                          {groupMetrics.map(mt => {
                            const winnerId = winners[mt.key];
                            const anyData = selectedPharms.some(ph =>
                              appliesToCountry(mt.applies, ph.country) &&
                              (tableData.get(`${ph.id}::${mt.key}`)?.current ?? 0) > 0
                            );
                            return (
                              <tr key={mt.key} className="border-t border-border/60 hover:bg-secondary/20 transition-colors group">
                                <td className="px-4 sm:px-6 py-2.5">
                                  <div className="flex items-start gap-2">
                                    <div>
                                      <p className="text-xs font-medium leading-tight">{mt.label}</p>
                                      {mt.applies !== "all" && (
                                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
                                          {mt.applies === "england" ? "England" : "Scotland"}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                {selectedPharms.map(ph => {
                                  if (!appliesToCountry(mt.applies, ph.country)) {
                                    return <td key={ph.id} className="px-3 sm:px-4 py-2.5 text-right text-muted-foreground/40 italic text-xs">n/a</td>;
                                  }
                                  const d = tableData.get(`${ph.id}::${mt.key}`);
                                  const v = d?.current ?? 0;
                                  const isWin = ph.id === winnerId && v > 0 && anyData;
                                  return (
                                    <td key={ph.id} className="px-3 sm:px-4 py-2.5 text-right">
                                      <div className="flex flex-col items-end gap-0.5">
                                        <div className="flex items-center gap-2 justify-end">
                                          {isWin && <span className="text-amber-500 text-[10px]">★</span>}
                                          <span className={cn("text-sm tabular-nums font-medium", isWin ? "text-foreground font-bold" : "text-muted-foreground")}>
                                            {v > 0 ? mt.format(v) : "—"}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2 justify-end">
                                          <Sparkline vals={d?.spark ?? []} color={colorFor(ph.id)} />
                                          <YoyBadge pct={d?.yoy ?? null} />
                                        </div>
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Head-to-head scorecard ────────────────────────────────── */}
          {selectedPharms.length >= 2 && (
            <div className="rounded-xl bg-card border border-border p-4 sm:p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
                <div>
                  <h2 className="text-sm font-semibold">Head-to-head scorecard</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Leader per metric across visible groups. Higher total wins = stronger overall performance.</p>
                </div>
                <Badge variant="secondary" className="text-[10px]">Based on {aggLabel.toLowerCase()}</Badge>
              </div>
              <div className={cn("grid gap-3", selectedPharms.length === 2 ? "grid-cols-2" : selectedPharms.length === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4")}>
                {selectedPharms.map(ph => {
                  const total = Object.keys(winners).length;
                  const wins = winsCount[ph.id] ?? 0;
                  const groupWins = (g: Group) =>
                    visibleMetrics.filter(m => m.group === g && winners[m.key] === ph.id).length;
                  const sharePct = total > 0 ? (wins / total) * 100 : 0;
                  return (
                    <div key={ph.id} className="rounded-lg border border-border bg-secondary/30 p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: colorFor(ph.id) }} />
                        <p className="text-xs font-semibold truncate">{pharmacyDisplayName(ph.name, ph.trading_name, ph.ods_code)}</p>
                      </div>
                      <p className="text-3xl font-bold tabular-nums">
                        {wins}<span className="text-sm text-muted-foreground font-normal">/{total}</span>
                      </p>
                      {/* Progress bar */}
                      <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${sharePct}%`, background: colorFor(ph.id) }} />
                      </div>
                      <div className="mt-2 text-[10px] text-muted-foreground space-y-0.5">
                        {visibleGroups.has("volume") && <p>Volumes: <span className="font-semibold text-foreground">{groupWins("volume")}</span></p>}
                        {visibleGroups.has("services") && <p>Services: <span className="font-semibold text-foreground">{groupWins("services")}</span></p>}
                        {visibleGroups.has("rate") && <p>Rates: <span className="font-semibold text-foreground">{groupWins("rate")}</span></p>}
                        {visibleGroups.has("money") && <p>Payments £: <span className="font-semibold text-foreground">{groupWins("money")}</span></p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Performance shape radar ────────────────────────────────── */}
          {selectedPharms.length >= 2 && radar.length >= 3 && (
            <div className="rounded-xl bg-card border border-border shadow-sm overflow-hidden">
              <button type="button" onClick={() => setRadarOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 sm:px-6 py-4 hover:bg-secondary/20 transition-colors">
                <div>
                  <h2 className="text-sm font-semibold text-left">Performance shape</h2>
                  <p className="text-[11px] text-muted-foreground text-left mt-0.5">Each spoke is a service, scaled to the leader (100). Bigger area = broader strength.</p>
                </div>
                {radarOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
              </button>
              {radarOpen && (
                <div className="px-4 sm:px-6 pb-5 border-t border-border">
                  <div className="h-80 mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radar}>
                        <PolarGrid stroke="var(--border)" />
                        <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                        <PolarRadiusAxis tick={{ fontSize: 9 }} angle={30} domain={[0, 100]} />
                        {selectedPharms.map(ph => (
                          <Radar key={ph.id} name={pharmacyDisplayName(ph.name, ph.trading_name, ph.ods_code)} dataKey={ph.id}
                            stroke={colorFor(ph.id)} fill={colorFor(ph.id)} fillOpacity={0.18} />
                        ))}
                        <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Items share donut ─────────────────────────────────────── */}
          {selectedPharms.length >= 2 && itemsTotal > 0 && (
            <div className="rounded-xl bg-card border border-border p-4 sm:p-6 shadow-sm">
              <h2 className="text-sm font-semibold mb-1">Share of items — {windowLabel}</h2>
              <p className="text-[11px] text-muted-foreground mb-4">Who dispenses more, in proportion. Total: {fmtInt(itemsTotal)} items.</p>
              <div className="flex items-center gap-4">
                <div className="h-48 w-48 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={itemsShare} dataKey="value" nameKey="name"
                        innerRadius="52%" outerRadius="84%" paddingAngle={2} stroke="var(--card)">
                        {itemsShare.map(d => <Cell key={d.id} fill={colorFor(d.id)} />)}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                        formatter={(v: any, n: any) => [fmtInt(Number(v)), n]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="flex-1 space-y-2.5 text-sm min-w-0">
                  {itemsShare.map(d => {
                    const pct = itemsTotal > 0 ? (d.value / itemsTotal) * 100 : 0;
                    return (
                      <li key={d.id} className="flex items-center gap-2 min-w-0">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: colorFor(d.id) }} />
                        <span className="flex-1 truncate text-xs min-w-0">{d.name}</span>
                        <span className="text-xs font-bold tabular-nums shrink-0">{pct.toFixed(1)}%</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{fmtInt(d.value)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

          {/* ── GP feeder overlap ─────────────────────────────────────── */}
          {selectedPharms.length >= 2 && (
            <div className="rounded-xl bg-card border border-border shadow-sm overflow-hidden">
              <button type="button" onClick={() => setGpOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 sm:px-6 py-4 hover:bg-secondary/20 transition-colors">
                <div>
                  <h2 className="text-sm font-semibold text-left">GP prescription sources</h2>
                  <p className="text-[11px] text-muted-foreground text-left mt-0.5">Which GP surgeries feed each pharmacy — overlap reveals shared catchment.</p>
                </div>
                {gpOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
              </button>
              {gpOpen && (
                <div className="border-t border-border">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 pt-3 pb-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Window</p>
                    <div className="inline-flex rounded-md border border-border bg-secondary/40 p-0.5">
                      {([3, 6, 12, 24, 0] as const).map(w => (
                        <button key={w} type="button" onClick={() => setGpFeederWindow(w)}
                          className={cn("px-2.5 py-1 text-[11px] font-semibold rounded transition-colors",
                            gpFeederWindow === w ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                          )}>
                          {w === 0 ? "All" : `${w}M`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <GpFeederOverlap
                    pharms={selectedPharms.map(p => ({ id: p.id, name: pharmacyDisplayName(p.name, p.trading_name, p.ods_code), country: p.country }))}
                    colorFor={colorFor}
                    monthsWindow={gpFeederWindow}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Competitor geography heatmap ──────────────────────────── */}
          {selectedPharms.some(p => p.lat != null && p.lng != null) && (
            <CompetitorHeatmap
              pharms={selectedPharms.map(p => ({ id: p.id, name: pharmacyDisplayName(p.name, p.trading_name, p.ods_code), country: p.country, lat: p.lat, lng: p.lng }))}
              colorFor={colorFor}
            />
          )}
        </>
      )}

      <DataAttribution />
    </div>
  );
}

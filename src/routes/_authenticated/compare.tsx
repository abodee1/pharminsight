import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader } from "@/components/PageHeader";
import { DataAttribution } from "@/components/DataAttribution";
import { useAuth } from "@/hooks/useAuth";
import { X, ArrowUpRight, ArrowDownRight, Minus, Trophy } from "lucide-react";
import { PharmacySearch } from "@/components/PharmacySearch";
import { CountryBadge } from "@/components/CountryBadge";
import { Badge } from "@/components/ui/badge";
import { GpFeederOverlap } from "@/components/GpFeederOverlap";
import { CompetitorHeatmap } from "@/components/CompetitorHeatmap";
import { getViewedPharmacy } from "@/lib/viewedPharmacy";

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  PieChart, Pie, Cell,
} from "recharts";

export const Route = createFileRoute("/_authenticated/compare")({
  component: Compare,
  validateSearch: (s: Record<string, unknown>) => ({
    add: typeof s.add === "string" ? s.add : undefined,
  }),
});

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const isScot = (c: string | null | undefined) => (c || "").toLowerCase() === "scotland";

type Applies = "all" | "england" | "scotland";

type MetricDef = {
  key: string;
  label: string;
  short: string;
  group: "volume" | "rate" | "money";
  applies: Applies;
  compute: (r: Row | undefined) => number;
  format: (v: number) => string;
};

const fmtInt = (v: number) => Math.round(v).toLocaleString();
const fmtRate = (v: number) => v.toFixed(1);
const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const fmtGbp = (v: number) => "£" + Math.round(v).toLocaleString();

const METRICS: MetricDef[] = [
  // ---------- Volume (universal) ----------
  { key: "items_dispensed", label: "Items dispensed", short: "Items", group: "volume", applies: "all",
    compute: (r) => r?.items_dispensed ?? 0, format: fmtInt },
  { key: "pharmacy_first_count", label: "Pharmacy First", short: "PF", group: "volume", applies: "all",
    compute: (r) => r?.pharmacy_first_count ?? 0, format: fmtInt },

  // ---------- Volume (England only) ----------
  { key: "nms_count", label: "NMS consultations", short: "NMS", group: "volume", applies: "england",
    compute: (r) => r?.nms_count ?? 0, format: fmtInt },
  { key: "eps_items", label: "EPS items", short: "EPS", group: "volume", applies: "england",
    compute: (r) => r?.eps_items ?? 0, format: fmtInt },
  { key: "flu_vaccinations", label: "Flu vaccinations", short: "Flu", group: "volume", applies: "england",
    compute: (r) => r?.flu_vaccinations ?? 0, format: fmtInt },

  // ---------- Volume (Scotland only) ----------
  { key: "mcr_items", label: "MCR items", short: "MCR items", group: "volume", applies: "scotland",
    compute: (r) => r?.mcr_items ?? 0, format: fmtInt },
  { key: "mcr_registrations", label: "MCR registrations", short: "MCR reg.", group: "volume", applies: "scotland",
    compute: (r) => r?.mcr_registrations ?? 0, format: fmtInt },
  { key: "methadone_items", label: "Methadone items", short: "Methadone", group: "volume", applies: "scotland",
    compute: (r) => r?.methadone_items ?? 0, format: fmtInt },
  { key: "supervised_methadone_doses", label: "Supervised doses", short: "Supervised", group: "volume", applies: "scotland",
    compute: (r) => r?.supervised_methadone_doses ?? 0, format: fmtInt },
  { key: "ehc_items", label: "EHC items", short: "EHC", group: "volume", applies: "scotland",
    compute: (r) => r?.ehc_items ?? 0, format: fmtInt },
  { key: "smoking_cessation", label: "Smoking cessation", short: "Smoking", group: "volume", applies: "scotland",
    compute: (r) => r?.smoking_cessation ?? 0, format: fmtInt },

  // ---------- Rate (size-adjusted) ----------
  { key: "pf_per_1k", label: "PF per 1k items", short: "PF/1k", group: "rate", applies: "all",
    compute: (r) => {
      const items = r?.items_dispensed ?? 0;
      return items > 0 ? ((r?.pharmacy_first_count ?? 0) * 1000) / items : 0;
    }, format: fmtRate },
  { key: "nms_per_1k", label: "NMS per 1k items", short: "NMS/1k", group: "rate", applies: "england",
    compute: (r) => {
      const items = r?.items_dispensed ?? 0;
      return items > 0 ? ((r?.nms_count ?? 0) * 1000) / items : 0;
    }, format: fmtRate },
  { key: "eps_share", label: "EPS share", short: "EPS %", group: "rate", applies: "england",
    compute: (r) => {
      const items = r?.items_dispensed ?? 0;
      return items > 0 ? ((r?.eps_items ?? 0) / items) * 100 : 0;
    }, format: fmtPct },
  { key: "mcr_share", label: "MCR share of items", short: "MCR %", group: "rate", applies: "scotland",
    compute: (r) => {
      const items = r?.items_dispensed ?? 0;
      return items > 0 ? ((r?.mcr_items ?? 0) / items) * 100 : 0;
    }, format: fmtPct },

  // ---------- Money (universal where reported) ----------
  { key: "gross_cost", label: "Gross cost (£)", short: "Gross £", group: "money", applies: "all",
    compute: (r) => Number(r?.gross_cost) || 0, format: fmtGbp },
  { key: "pharmacy_first_payment", label: "Pharmacy First (£)", short: "PF £", group: "money", applies: "all",
    compute: (r) => Number(r?.pharmacy_first_payment) || 0, format: fmtGbp },
  { key: "mcr_payment", label: "MCR payment (£)", short: "MCR £", group: "money", applies: "scotland",
    compute: (r) => Number(r?.mcr_payment) || 0, format: fmtGbp },
  { key: "final_payment", label: "Final NHS payment (£)", short: "NHS £", group: "money", applies: "all",
    compute: (r) => Number(r?.final_payment) || 0, format: fmtGbp },
];

const METRIC_DESC: Record<string, string> = {
  "Items": "Total prescription items dispensed this month. The primary driver of NHS pharmacy income.",
  "NMS": "New Medicine Service consultations — the NHS pays ~£28 per completed intervention (England).",
  "PF": "Pharmacy First consultations delivered this month.",
  "EPS": "Items dispensed via the Electronic Prescription Service (England).",
  "Flu": "Seasonal NHS flu vaccinations delivered this month (England).",
  "MCR items": "Items dispensed under Scotland's Medicines Care & Review serial-prescription service.",
  "MCR reg.": "Patients registered for MCR — a proxy for chronic-care caseload.",
  "Methadone": "Methadone (and other OST) items dispensed this month.",
  "Supervised": "Doses of methadone/buprenorphine consumed under direct pharmacist supervision.",
  "EHC": "Emergency hormonal contraception supplies issued this month.",
  "Smoking": "Smoking-cessation interventions delivered under the NHS Scotland service.",
  "PF/1k": "Pharmacy First consultations per 1,000 items — a size-adjusted clinical-services intensity score.",
  "NMS/1k": "NMS interventions per 1,000 items — measures conversion of new prescriptions into paid NMS.",
  "EPS %": "Share of items routed through EPS rather than paper. Above 95% is excellent.",
  "MCR %": "Share of total items dispensed under the MCR serial-prescription pathway.",
  "Gross £": "Gross ingredient cost of drugs dispensed before any clawback or deductions.",
  "PF £": "Direct NHS payments received for Pharmacy First consultations.",
  "MCR £": "NHS Scotland payment for MCR service delivery.",
  "NHS £": "Final NHS payment for the month after all fees, allowances and clawbacks.",
};

function appliesToCountry(applies: Applies, country: string | null | undefined) {
  if (applies === "all") return true;
  if (applies === "scotland") return isScot(country);
  return !isScot(country);
}

function MetricTile({ mt, value, diff, pct, na }: { mt: MetricDef; value: number; diff: number; pct: number; na?: boolean }) {
  const [flipped, setFlipped] = useState(false);
  const up = diff > 0, flat = diff === 0;
  return (
    <button
      type="button"
      onClick={() => setFlipped((f) => !f)}
      className="group relative w-full text-left [perspective:800px] focus:outline-none"
      aria-label={`${mt.label}: tap for explanation`}
    >
      <div className={`relative h-full min-h-[4.75rem] transition-transform duration-500 [transform-style:preserve-3d] ${flipped ? "[transform:rotateY(180deg)]" : ""}`}>
        <div className="absolute inset-0 rounded-md bg-secondary/40 px-2 py-1.5 [backface-visibility:hidden]">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate flex items-center justify-between gap-1">
            <span className="truncate">{mt.short}</span><span className="text-[8px] opacity-30 group-hover:opacity-100">ⓘ</span>
          </p>
          {na ? (
            <p className="text-sm font-medium text-muted-foreground/70 italic leading-tight mt-0.5">n/a</p>
          ) : (
            <>
              <p className="text-base font-semibold tabular-nums leading-tight">{value > 0 ? mt.format(value) : "—"}</p>
              <div className="mt-0.5 flex items-center gap-0.5 text-[10px]">
                {flat ? <Minus className="h-3 w-3 text-muted-foreground" /> : up ? <ArrowUpRight className="h-3 w-3 text-emerald-600" /> : <ArrowDownRight className="h-3 w-3 text-rose-600" />}
                <span className={flat ? "text-muted-foreground" : up ? "text-emerald-700" : "text-rose-700"}>
                  {flat ? "—" : `${up ? "+" : ""}${pct}%`}
                </span>
              </div>
            </>
          )}
        </div>
        <div className="absolute inset-0 rounded-md border border-gold/50 bg-gold/5 px-2 py-1.5 [backface-visibility:hidden] [transform:rotateY(180deg)] overflow-auto">
          <p className="text-[9px] uppercase tracking-wider text-gold font-semibold">{mt.short}</p>
          <p className="text-[10px] leading-snug mt-0.5 text-foreground/90">{METRIC_DESC[mt.short] || mt.label}</p>
        </div>
      </div>
    </button>
  );
}

const SERIES_COLORS = [
  "var(--cmp-1)",
  "var(--cmp-2)",
  "var(--cmp-3)",
  "var(--cmp-4)",
];

type Pharm = { id: string; name: string; region: string | null; country: string | null; postcode: string | null; lat?: number | null; lng?: number | null };
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

const MAX_SELECT = 4;

function Compare() {
  const { user } = useAuth();
  const { add: addOds } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [pharms, setPharms] = useState<Pharm[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  // 0 = all time
  const [trendWindow, setTrendWindow] = useState<0 | 3 | 6 | 12 | 24>(12);
  const [gpFeederWindow, setGpFeederWindow] = useState<0 | 3 | 6 | 12 | 24>(12);
  const [, setLoading] = useState(false);

  // Preload the SUBJECT pharmacy as the first selection. The subject is the
  // pharmacy the user is currently "browsing" (set when they open a pharmacy
  // profile via the search bar). When no override is active, fall back to the
  // user's saved home pharmacy.
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
        .from("pharmacies").select("id,name,region,country,postcode,lat,lng")
        .eq("id", subjectId).maybeSingle();
      if (ph) {
        setPharms((cur) => (cur.some((x) => x.id === ph.id) ? cur : [...cur, ph as Pharm]));
        // Subject always sits in the FIRST slot — comparators are benchmarked against it.
        setSelected((cur) => (cur.includes(ph.id) ? cur : [ph.id, ...cur]));
      }
    })();
  }, [user]);

  // Quick-add from Local Landscape: ?add=<ods_code>
  useEffect(() => {
    if (!addOds) return;
    (async () => {
      const { data: ph } = await supabase
        .from("pharmacies")
        .select("id,name,region,country,postcode,lat,lng")
        .eq("ods_code", addOds)
        .maybeSingle();
      if (ph) {
        setPharms((cur) => (cur.some((x) => x.id === ph.id) ? cur : [...cur, ph as Pharm]));
        setSelected((cur) => {
          if (cur.includes(ph.id)) return cur;
          if (cur.length >= MAX_SELECT) return cur;
          return [...cur, ph.id];
        });
      }
      // Clear the param so a refresh doesn't re-add.
      navigate({ search: { add: undefined }, replace: true });
    })();
  }, [addOds, navigate]);


  // Fetch dispensing data only for the selected pharmacies (last 24 months).
  useEffect(() => {
    if (selected.length === 0) { setRows([]); return; }
    setLoading(true);
    (async () => {
      const now = new Date();
      const cutoff = new Date(now.getFullYear(), now.getMonth() - 60, 1);
      const cutoffYear = cutoff.getFullYear();
      const data = await fetchAll<Row>((from, to) =>
        supabase
          .from("dispensing_data")
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
    () => selected.map((id) => pharms.find((p) => p.id === id)).filter(Boolean) as Pharm[],
    [selected, pharms]
  );

  // Metrics relevant to AT LEAST one selected pharmacy. Drives compare visuals.
  const activeMetrics = useMemo(
    () => METRICS.filter((mt) => selectedPharms.some((ph) => appliesToCountry(mt.applies, ph.country))),
    [selectedPharms]
  );

  const periods = useMemo(
    () => Array.from(new Set(rows.map((r) => `${r.year}-${String(r.month).padStart(2, "0")}`))).sort(),
    [rows]
  );
  const latest = periods[periods.length - 1];

  // For each pharmacy + metric, find the most recent period where the
  // metric is non-zero (skip provisional / trailing-empty months).
  const latestNonZero = useMemo(() => {
    const out = new Map<string, { value: number; prior: number; period: string | null }>();
    selectedPharms.forEach((ph) => {
      const phRows = rows
        .filter((r) => r.pharmacy_id === ph.id)
        .sort((a, b) => (a.year - b.year) || (a.month - b.month));
      METRICS.forEach((mt) => {
        if (!appliesToCountry(mt.applies, ph.country)) {
          out.set(`${ph.id}::${mt.key}`, { value: 0, prior: 0, period: null });
          return;
        }
        let idx = -1;
        for (let i = phRows.length - 1; i >= 0; i--) {
          if (mt.compute(phRows[i]) > 0) { idx = i; break; }
        }
        if (idx === -1) {
          out.set(`${ph.id}::${mt.key}`, { value: 0, prior: 0, period: null });
          return;
        }
        const cur = phRows[idx];
        const prv = idx > 0 ? phRows[idx - 1] : undefined;
        out.set(`${ph.id}::${mt.key}`, {
          value: mt.compute(cur),
          prior: prv ? mt.compute(prv) : 0,
          period: `${MONTHS[cur.month - 1]} ${String(cur.year).slice(2)}`,
        });
      });
    });
    return out;
  }, [selectedPharms, rows]);

  // 12-month rolling totals per pharmacy per metric (for the totals bar)
  const totals12m = useMemo(() => {
    const out = new Map<string, number>();
    selectedPharms.forEach((ph) => {
      const phRows = rows
        .filter((r) => r.pharmacy_id === ph.id)
        .slice(-12);
      METRICS.forEach((mt) => {
        if (!appliesToCountry(mt.applies, ph.country)) {
          out.set(`${ph.id}::${mt.key}`, 0);
          return;
        }
        out.set(`${ph.id}::${mt.key}`, phRows.reduce((s, r) => s + mt.compute(r), 0));
      });
    });
    return out;
  }, [selectedPharms, rows]);
  // Trend data — one chart per active metric, windowed to last N months
  const trendPeriods = useMemo(
    () => (trendWindow === 0 ? periods : periods.slice(-trendWindow)),
    [periods, trendWindow],
  );
  const trendByMetric = useMemo(() => {
    return activeMetrics.map((mt) => {
      // Build raw values per pharmacy across the window
      const raw = trendPeriods.map((p) => {
        const [y, m] = p.split("-").map(Number);
        const row: Record<string, { y: number; m: number; vals: Record<string, number | null> }> = {};
        const vals: Record<string, number | null> = {};
        selectedPharms.forEach((ph) => {
          if (!appliesToCountry(mt.applies, ph.country)) { vals[ph.id] = null; return; }
          const r = rows.find((rr) => rr.pharmacy_id === ph.id && rr.year === y && rr.month === m);
          vals[ph.id] = r ? mt.compute(r) : 0;
        });
        return { y, m, vals, label: `${MONTHS[m - 1]} ${String(y).slice(2)}` };
      });
      // Per-pharmacy trim: turn trailing zeros into null so lagging metrics
      // (Pharmacy First, NMS, etc.) don't get dragged to the x-axis.
      selectedPharms.forEach((ph) => {
        let lastIdx = -1;
        for (let i = raw.length - 1; i >= 0; i--) {
          const v = raw[i].vals[ph.id];
          if (typeof v === "number" && v > 0) { lastIdx = i; break; }
        }
        for (let i = 0; i < raw.length; i++) {
          if (i > lastIdx) raw[i].vals[ph.id] = null;
        }
      });
      const data = raw.map((r) => {
        const point: Record<string, any> = { label: r.label };
        selectedPharms.forEach((ph) => { point[ph.id] = r.vals[ph.id]; });
        return point;
      });
      return { metric: mt, data };
    });
  }, [trendPeriods, selectedPharms, rows, activeMetrics]);


  // Radar: normalise per metric across active pharmacies
  const radar = useMemo(() => {
    return activeMetrics.filter((mt) => mt.group !== "money").map((mt) => {
      const point: Record<string, any> = { metric: mt.short };
      const vals = selectedPharms.map((ph) =>
        appliesToCountry(mt.applies, ph.country) ? (latestNonZero.get(`${ph.id}::${mt.key}`)?.value ?? 0) : 0
      );
      const max = Math.max(1, ...vals);
      selectedPharms.forEach((ph, i) => {
        point[ph.id] = Math.round((vals[i] / max) * 100);
      });
      return point;
    });
  }, [selectedPharms, latestNonZero, activeMetrics]);

  // Headline per pharmacy — country-specific metrics only
  const headline = useMemo(() => {
    return selectedPharms.map((ph) => {
      const metrics = METRICS
        .filter((mt) => appliesToCountry(mt.applies, ph.country))
        .map((mt) => {
          const entry = latestNonZero.get(`${ph.id}::${mt.key}`);
          const v = entry?.value ?? 0;
          const p = entry?.prior ?? 0;
          const diff = v - p;
          const pct = p ? Math.round((diff / p) * 100) : 0;
          return { mt, value: v, diff, pct, period: entry?.period ?? null };
        });
      return { ph, metrics };
    });
  }, [selectedPharms, latestNonZero]);

  // Winner per metric — highest latest-non-zero among pharmacies that support it
  const winners = useMemo(() => {
    const out: Record<string, string> = {};
    activeMetrics.forEach((mt) => {
      let best = -1;
      let id = "";
      selectedPharms.forEach((ph) => {
        if (!appliesToCountry(mt.applies, ph.country)) return;
        const v = latestNonZero.get(`${ph.id}::${mt.key}`)?.value ?? 0;
        if (v > best) { best = v; id = ph.id; }
      });
      if (id) out[mt.key] = id;
    });
    return out;
  }, [selectedPharms, latestNonZero, activeMetrics]);

  // Wins count per pharmacy across active metrics
  const winsCount = useMemo(() => {
    const out: Record<string, number> = {};
    selectedPharms.forEach((ph) => { out[ph.id] = 0; });
    Object.values(winners).forEach((id) => { out[id] = (out[id] ?? 0) + 1; });
    return out;
  }, [winners, selectedPharms]);

  // Items market-share donut data (12m totals)
  const itemsShare = useMemo(
    () =>
      selectedPharms.map((ph) => ({
        id: ph.id,
        name: ph.name,
        value: totals12m.get(`${ph.id}::items_dispensed`) ?? 0,
      })),
    [selectedPharms, totals12m]
  );
  const itemsTotal = itemsShare.reduce((s, x) => s + x.value, 0);

  function remove(id: string) {
    setSelected((cur) => cur.filter((x) => x !== id));
  }

  const colorFor = (id: string) => SERIES_COLORS[selected.indexOf(id) % SERIES_COLORS.length];

  return (
    <div className="p-3 sm:p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Compare pharmacies"
        subtitle="Pick up to 4 pharmacies to see them side by side across every NHS service."
      />

      {/* Selector */}
      <div className="rounded-xl bg-card border border-border p-5 shadow-sm mb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="md:w-[420px] shrink-0">
            {selected.length < MAX_SELECT ? (
              <PharmacySearch
                placeholder="Search by name, postcode (e.g. KY11), or ODS code…"
                excludeIds={selected}
                clearOnSelect
                onSelect={async (p) => {
                  if (selected.includes(p.id)) return;
                  if (selected.length >= MAX_SELECT) return;
                  // Fetch lat/lng for heatmap (not surfaced by PharmacySearch)
                  const { data: geo } = await supabase
                    .from("pharmacies").select("lat,lng").eq("id", p.id).maybeSingle();
                  setPharms((cur) =>
                    cur.some((x) => x.id === p.id)
                      ? cur
                      : [
                          ...cur,
                          {
                            id: p.id,
                            name: p.name,
                            region: p.region ?? null,
                            country: p.country ?? null,
                            postcode: p.postcode ?? null,
                            lat: geo?.lat ?? null,
                            lng: geo?.lng ?? null,
                          },
                        ],
                  );
                  setSelected((cur) => [...cur, p.id]);
                }}

              />
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Maximum {MAX_SELECT} pharmacies selected — remove one to add another.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Up to {MAX_SELECT} pharmacies • {selected.length}/{MAX_SELECT} selected
            </p>
          </div>

          <div className="flex-1 flex flex-wrap items-start gap-2 min-h-[36px]">
            {selectedPharms.length === 0 && (
              <span className="text-sm text-muted-foreground self-center">
                Search above and add at least 2 pharmacies to compare.
              </span>
            )}
            {selectedPharms.map((ph) => (
              <span
                key={ph.id}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary pl-3 pr-1 py-1 text-sm max-w-full"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: colorFor(ph.id) }}
                />
                <span className="font-medium truncate max-w-[180px]">{ph.name}</span>
                <CountryBadge country={ph.country} />
                {ph.region && (
                  <span className="text-xs text-muted-foreground truncate max-w-[120px]">{ph.region}</span>
                )}
                <button
                  onClick={() => remove(ph.id)}
                  className="ml-1 rounded-full p-1 hover:bg-background"
                  aria-label="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>

      </div>

      {selectedPharms.length >= 2 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
          {selectedPharms.map((ph) => {
            const items12 = totals12m.get(`${ph.id}::items_dispensed`) ?? 0;
            const pf12 = totals12m.get(`${ph.id}::pharmacy_first_count`) ?? 0;
            const nhs12 = totals12m.get(`${ph.id}::final_payment`) ?? 0;
            const wins = winsCount[ph.id] ?? 0;
            return (
              <div
                key={ph.id}
                className="rounded-xl bg-card border border-border p-4 shadow-sm relative overflow-hidden"
                style={{ borderTop: `3px solid ${colorFor(ph.id)}` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{ph.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{ph.region}</p>
                  </div>
                  {wins > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 border border-gold/40 px-2 py-0.5 text-[11px] font-semibold text-gold shrink-0">
                      <Trophy className="h-3 w-3" /> {wins}
                    </span>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Items 12m</p>
                    <p className="text-sm font-bold tabular-nums">{items12 ? fmtInt(items12) : "—"}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground">PF 12m</p>
                    <p className="text-sm font-bold tabular-nums">{pf12 ? fmtInt(pf12) : "—"}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground">NHS £ 12m</p>
                    <p className="text-sm font-bold tabular-nums">{nhs12 ? fmtGbp(nhs12) : "—"}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedPharms.length >= 1 && (
        <>
          {/* Headline cards — country-aware metrics per pharmacy */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {headline.map(({ ph, metrics }) => (
              <div
                key={ph.id}
                className="rounded-xl bg-card border border-border p-5 shadow-sm relative overflow-hidden"
                style={{ borderTop: `3px solid ${colorFor(ph.id)}` }}
              >
                <div className="flex items-start gap-2 mb-3">
                  <span
                    className="mt-1 h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ background: colorFor(ph.id) }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{ph.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{ph.region}</p>
                  </div>
                  <CountryBadge country={ph.country} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {metrics.map(({ mt, value, diff, pct }) => (
                    <MetricTile key={mt.key} mt={mt} value={value} diff={diff} pct={pct} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Head-to-head edge scorecard */}
          {selectedPharms.length >= 2 && (
            <div className="rounded-xl bg-card border border-border p-5 md:p-6 shadow-sm mb-6">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                <div>
                  <h2 className="text-sm font-semibold">Head-to-head edge scorecard</h2>
                  <p className="text-xs text-muted-foreground mt-1">Wins per dimension across volumes, service intensity and payments.</p>
                </div>
                <Badge variant="secondary" className="text-[10px]">Higher score = stronger overall</Badge>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {selectedPharms.map((ph) => {
                  const wins = winsCount[ph.id] ?? 0;
                  const total = activeMetrics.length;
                  const groupWins = (g: "volume" | "rate" | "money") =>
                    activeMetrics.filter((m) => m.group === g && winners[m.key] === ph.id).length;
                  return (
                    <div key={ph.id} className="rounded-lg border border-border bg-secondary/30 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: colorFor(ph.id) }} />
                        <p className="text-xs font-semibold truncate">{ph.name}</p>
                      </div>
                      <p className="text-2xl font-bold tabular-nums">{wins}<span className="text-xs text-muted-foreground font-normal">/{total}</span></p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Volumes {groupWins("volume")} · Rates {groupWins("rate")} · £ {groupWins("money")}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* GP feeder overlap & catchment analysis (≥2 selected) */}
          {selectedPharms.length >= 2 && (
            <div className="space-y-2 mb-2">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">GP feeder window</p>
                <div className="inline-flex rounded-md border border-border bg-secondary/40 p-0.5 flex-wrap">
                  {([3, 6, 12, 24, 0] as const).map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setGpFeederWindow(w)}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                        gpFeederWindow === w
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      aria-pressed={gpFeederWindow === w}
                    >
                      {w === 0 ? "All" : `${w}M`}
                    </button>
                  ))}
                </div>
              </div>
              <GpFeederOverlap
                pharms={selectedPharms.map((p) => ({ id: p.id, name: p.name, country: p.country }))}
                colorFor={colorFor}
                monthsWindow={gpFeederWindow}
              />
            </div>
          )}

          {/* Competitor geography heatmap (≥1 selected, needs lat/lng) */}
          {selectedPharms.length >= 1 && selectedPharms.some((p) => p.lat != null && p.lng != null) && (
            <CompetitorHeatmap
              pharms={selectedPharms.map((p) => ({ id: p.id, name: p.name, country: p.country, lat: p.lat, lng: p.lng }))}
              colorFor={colorFor}
            />
          )}



          {selectedPharms.length >= 2 && (
            <>
              {/* Market share donut + 12-month items totals */}
              {itemsTotal > 0 && (
                <div className="grid lg:grid-cols-2 gap-6 mb-6">
                  <div className="rounded-xl bg-card border border-border p-6 shadow-sm">
                    <h2 className="text-sm font-semibold mb-1">Share of items — last 12 months</h2>
                    <p className="text-xs text-muted-foreground mb-3">Who dispenses more, in proportion.</p>
                    <div className="h-64 flex items-center">
                      <div className="w-1/2 h-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={itemsShare}
                              dataKey="value"
                              nameKey="name"
                              innerRadius="55%"
                              outerRadius="85%"
                              paddingAngle={2}
                              stroke="var(--card)"
                            >
                              {itemsShare.map((d) => (
                                <Cell key={d.id} fill={colorFor(d.id)} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                              formatter={(v: any, n: any) => [fmtInt(Number(v)), n]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <ul className="w-1/2 space-y-2 text-sm pl-2">
                        {itemsShare.map((d) => {
                          const pct = itemsTotal > 0 ? (d.value / itemsTotal) * 100 : 0;
                          return (
                            <li key={d.id} className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: colorFor(d.id) }} />
                              <span className="flex-1 truncate text-xs">{d.name}</span>
                              <span className="text-xs font-semibold tabular-nums">{pct.toFixed(1)}%</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>

                  <div className="rounded-xl bg-card border border-border p-6 shadow-sm">
                    <h2 className="text-sm font-semibold mb-1">12-month service totals</h2>
                    <p className="text-xs text-muted-foreground mb-3">Cumulative volumes across every reporting month.</p>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          layout="vertical"
                          data={activeMetrics
                            .filter((mt) => mt.group === "volume")
                            .slice(0, 6)
                            .map((mt) => {
                              const point: Record<string, any> = { metric: mt.short };
                              selectedPharms.forEach((ph) => {
                                point[ph.id] = appliesToCountry(mt.applies, ph.country)
                                  ? (totals12m.get(`${ph.id}::${mt.key}`) ?? 0)
                                  : 0;
                              });
                              return point;
                            })}
                          margin={{ top: 5, right: 12, bottom: 0, left: 0 }}
                        >
                          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                          <XAxis type="number" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                          <YAxis dataKey="metric" type="category" width={70} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                          <Tooltip
                            contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                            formatter={(v: any, n: any) => [fmtInt(Number(v)), pharms.find((p) => p.id === n)?.name ?? n]}
                          />
                          {selectedPharms.map((ph) => (
                            <Bar key={ph.id} dataKey={ph.id} fill={colorFor(ph.id)} radius={[0, 4, 4, 0]} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}

              {/* Trend small multiples — one chart per active metric */}
              <div className="rounded-xl bg-card border border-border p-4 sm:p-6 shadow-sm mb-6">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <h2 className="text-sm font-semibold">
                    {trendWindow === 0 ? "All-time trend" : `${trendWindow}-month trend`} by service
                  </h2>
                  <div className="inline-flex rounded-md border border-border bg-secondary/40 p-0.5 flex-wrap">
                    {([3, 6, 12, 24, 0] as const).map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setTrendWindow(w)}
                        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                          trendWindow === w
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        aria-pressed={trendWindow === w}
                      >
                        {w === 0 ? "All" : `${w}M`}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs w-full md:w-auto">
                    {selectedPharms.map((ph) => (
                      <span key={ph.id} className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-3 rounded-sm" style={{ background: colorFor(ph.id) }} />
                        <span className="text-muted-foreground truncate max-w-[120px]">{ph.name}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {trendByMetric.map(({ metric: mt, data }) => (
                    <div key={mt.key}>
                      <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center justify-between">
                        <span>{mt.label}</span>
                        {mt.applies !== "all" && (
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
                            {mt.applies === "england" ? "England only" : "Scotland only"}
                          </span>
                        )}
                      </p>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={data} margin={{ top: 5, right: 8, bottom: 0, left: -15 }}>
                            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                            <Tooltip
                              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                              formatter={(v: any, _n: any, ctx: any) => {
                                const ph = pharms.find((p) => p.id === ctx.dataKey);
                                return [mt.format(Number(v)), ph?.name ?? ctx.dataKey];
                              }}
                            />
                            {selectedPharms
                              .filter((ph) => appliesToCountry(mt.applies, ph.country))
                              .map((ph) => (
                                <Line
                                  key={ph.id}
                                  type="monotone"
                                  dataKey={ph.id}
                                  stroke={colorFor(ph.id)}
                                  strokeWidth={2}
                                  dot={false}
                                  activeDot={{ r: 4 }}
                                  connectNulls={false}
                                />

                              ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Radar */}
              {radar.length >= 3 && (
                <div className="rounded-xl bg-card border border-border p-6 shadow-sm mb-6">
                  <h2 className="text-sm font-semibold mb-1">Performance shape</h2>
                  <p className="text-xs text-muted-foreground mb-4">Each spoke is a service, scaled to the leader's value (100). Bigger area = broader strength.</p>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radar}>
                        <PolarGrid stroke="var(--border)" />
                        <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                        <PolarRadiusAxis tick={{ fontSize: 10 }} angle={30} domain={[0, 100]} />
                        {selectedPharms.map((ph) => (
                          <Radar
                            key={ph.id}
                            name={ph.name}
                            dataKey={ph.id}
                            stroke={colorFor(ph.id)}
                            fill={colorFor(ph.id)}
                            fillOpacity={0.18}
                          />
                        ))}
                        <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {latest && (
                <div className="rounded-xl bg-card border border-border shadow-sm p-4 sm:p-6 mb-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                    <h2 className="text-sm font-semibold tracking-tight">Metric leadership · latest reported</h2>
                    <p className="text-xs text-muted-foreground italic">Who leads, and by how wide a margin.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {activeMetrics.map((mt) => {
                      const vals = selectedPharms
                        .filter((ph) => appliesToCountry(mt.applies, ph.country))
                        .map((ph) => ({ ph, v: latestNonZero.get(`${ph.id}::${mt.key}`)?.value ?? 0 }))
                        .sort((a, b) => b.v - a.v);
                      if (!vals.length || vals[0].v <= 0) return null;
                      const leader = vals[0];
                      const runner = vals[1];
                      const margin = runner && runner.v ? ((leader.v - runner.v) / runner.v) * 100 : null;
                      const leaderPct = 100;
                      const runnerPct = runner && leader.v > 0 ? (runner.v / leader.v) * 100 : 0;
                      return (
                        <div key={mt.key} className="rounded-lg border border-border bg-secondary/30 p-3">
                          <div className="flex items-baseline justify-between gap-2 mb-2">
                            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold truncate">{mt.label}</p>
                            {mt.applies !== "all" && (
                              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 shrink-0">{mt.applies === "england" ? "Eng" : "Sco"}</span>
                            )}
                          </div>
                          <div className="space-y-2">
                            <div>
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-xs font-semibold truncate flex items-center gap-1.5 min-w-0" title={leader.ph.name}>
                                  <Trophy className="h-3 w-3 text-amber-500 shrink-0" />
                                  <span className="truncate">{leader.ph.name}</span>
                                </span>
                                <span className="text-sm font-bold tabular-nums shrink-0">{mt.format(leader.v)}</span>
                              </div>
                              <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${leaderPct}%`, background: colorFor(leader.ph.id) }} />
                              </div>
                            </div>
                            {runner && (
                              <div>
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="text-xs truncate min-w-0 text-muted-foreground" title={runner.ph.name}>{runner.ph.name}</span>
                                  <span className="text-xs font-medium tabular-nums shrink-0 text-muted-foreground">
                                    {runner.v > 0 ? mt.format(runner.v) : "—"}
                                  </span>
                                </div>
                                <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                                  <div className="h-full rounded-full opacity-70" style={{ width: `${runnerPct}%`, background: colorFor(runner.ph.id) }} />
                                </div>
                              </div>
                            )}
                          </div>
                          {margin !== null && (
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              Leader is <span className="font-semibold text-foreground">{margin > 0 ? `+${Math.round(margin)}%` : "level"}</span> {margin > 0 ? "ahead" : ""}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}


              {/* Comparison table */}
              <div className="rounded-xl bg-card border border-border shadow-sm overflow-hidden mb-6">
                <div className="px-4 sm:px-6 py-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
                  <h2 className="text-sm font-semibold">Side-by-side numbers · latest reported</h2>
                  <span className="text-xs text-muted-foreground">Best per row highlighted · n/a = service not offered in that country</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 sm:px-6 py-3 font-medium">Metric</th>
                        {selectedPharms.map((ph) => (
                          <th key={ph.id} className="text-right px-3 sm:px-6 py-3 font-medium">
                            <div className="flex items-center justify-end gap-2">
                              <span className="h-2 w-2 rounded-full" style={{ background: colorFor(ph.id) }} />
                              <span className="truncate max-w-[140px]">{ph.name}</span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(["volume", "rate", "money"] as const).map((group) => {
                        const groupMetrics = activeMetrics.filter((mt) => mt.group === group);
                        if (!groupMetrics.length) return null;
                        return (
                          <Fragment key={group}>
                            <tr className="bg-secondary/40 border-t border-border">
                              <td colSpan={selectedPharms.length + 1} className="px-3 sm:px-6 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                {group === "volume" ? "Monthly volumes" : group === "rate" ? "Service intensity (size-adjusted)" : "Payments (£)"}
                              </td>
                            </tr>
                            {groupMetrics.map((mt) => {
                              const winnerId = winners[mt.key];
                              return (
                                <tr key={mt.key} className="border-t border-border">
                                  <td className="px-3 sm:px-6 py-3 font-medium">
                                    <div className="flex items-center gap-2">
                                      <span>{mt.label}</span>
                                      {mt.applies !== "all" && (
                                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                                          {mt.applies === "england" ? "Eng" : "Sco"}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  {selectedPharms.map((ph) => {
                                    const supported = appliesToCountry(mt.applies, ph.country);
                                    if (!supported) {
                                      return (
                                        <td key={ph.id} className="px-3 sm:px-6 py-3 text-right text-muted-foreground/60 italic">
                                          n/a
                                        </td>
                                      );
                                    }
                                    const v = latestNonZero.get(`${ph.id}::${mt.key}`)?.value ?? 0;
                                    const isWin = ph.id === winnerId && winners[mt.key] && v > 0;
                                    return (
                                      <td
                                        key={ph.id}
                                        className={[
                                          "px-3 sm:px-6 py-3 text-right tabular-nums",
                                          isWin ? "font-semibold text-foreground" : "text-muted-foreground",
                                        ].join(" ")}
                                      >
                                        <div className="inline-flex items-center gap-2 justify-end">
                                          {v > 0 ? mt.format(v) : "—"}
                                          {isWin && <Badge variant="secondary" className="text-[10px] py-0">Best</Badge>}
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
            </>
          )}
        </>
      )}

      <DataAttribution />
    </div>
  );
}

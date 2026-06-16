import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { generateInsight, getInsightsSnapshot, askInsightsQuestion } from "@/lib/insights.functions";
import { Button } from "@/components/ui/button";
import {
  Sparkles, Loader2, RefreshCw, Clock, TrendingUp, TrendingDown, Minus,
  ArrowLeft, MessageSquare, Send, BarChart3, Target, ListChecks, Coins, PieChart,
  Download, Trash2, Lightbulb,
} from "lucide-react";
import { toast } from "sonner";

type PharmacyRow = { id: string; ods_code: string; name: string; country: string | null; region: string | null; address: string | null };
type CachedInsight = { id: string; insight_type: string; insight_text: string; generated_at: string };
type ChatMsg = { role: "user" | "assistant"; content: string };
type Snapshot = Awaited<ReturnType<typeof getInsightsSnapshot>>;

type InsightKey = "swot" | "benchmark" | "opportunities" | "action_plan" | "income_quality" | "service_mix";

const INSIGHT_META: Record<InsightKey, { title: string; blurb: string; icon: any; accent: string }> = {
  swot: { title: "SWOT Analysis", blurb: "Board-grade strengths, weaknesses, opportunities, threats anchored to your numbers.", icon: Sparkles, accent: "gold" },
  benchmark: { title: "Performance Commentary", blurb: "Expert narrative on dispensing trend, service mix and income quality vs peers.", icon: TrendingUp, accent: "sky" },
  opportunities: { title: "Opportunity Radar", blurb: "Top 5 highest-£ opportunities ranked by indicative annual uplift.", icon: Target, accent: "emerald" },
  action_plan: { title: "90-day Action Plan", blurb: "Executable week-by-week plan an owner can hand to a manager Monday morning.", icon: ListChecks, accent: "violet" },
  income_quality: { title: "Income Quality Scorecard", blurb: "A–D grade with concentration risk, resilience and three upgrade moves.", icon: Coins, accent: "amber" },
  service_mix: { title: "Service Mix Deep Dive", blurb: "Service-by-service read with peer gaps and the lever to move each.", icon: PieChart, accent: "rose" },
};

const ACCENT_BG: Record<string, string> = {
  gold: "bg-gold/10 text-gold border-gold/25",
  sky: "bg-sky-500/10 text-sky-600 border-sky-500/25",
  emerald: "bg-emerald-500/10 text-emerald-600 border-emerald-500/25",
  violet: "bg-violet-500/10 text-violet-600 border-violet-500/25",
  amber: "bg-amber-500/10 text-amber-600 border-amber-500/25",
  rose: "bg-rose-500/10 text-rose-600 border-rose-500/25",
};

function timeAgo(ts: string) {
  const h = Math.round((Date.now() - new Date(ts).getTime()) / 3600000);
  if (h < 1) return "Just now";
  if (h < 48) return `${h}h ago`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function bold(text: string): React.ReactNode {
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  if (parts.length === 1) return text;
  return <>{parts.map((p, i) => i % 2 === 1 ? <strong key={i}>{p}</strong> : p)}</>;
}

function renderMd(text: string): React.ReactNode[] {
  // Handle simple markdown tables (| col | col |)
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("|") && lines[i + 1]?.trim().match(/^\|[\s\-:|]+\|$/)) {
      const headers = line.split("|").slice(1, -1).map((c) => c.trim());
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      out.push(
        <div key={`t-${i}`} className="my-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-secondary/40">
              <tr>{headers.map((h, k) => <th key={k} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-t border-border">
                  {r.map((c, ci) => <td key={ci} className="px-3 py-1.5 tabular-nums">{bold(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    if (line.startsWith("## ")) out.push(<h2 key={i} className="text-sm font-semibold mt-5 mb-1.5 text-foreground">{line.slice(3)}</h2>);
    else if (line.startsWith("# ")) out.push(<h1 key={i} className="text-base font-bold mt-6 mb-2 text-foreground">{line.slice(2)}</h1>);
    else if (/^[-•*]\s/.test(line)) out.push(<li key={i} className="ml-4 text-sm leading-relaxed mb-1 text-foreground/90">{bold(line.replace(/^[-•*]\s/, ""))}</li>);
    else if (/^\d+\.\s/.test(line)) out.push(<li key={i} className="ml-4 list-decimal text-sm leading-relaxed mb-1 text-foreground/90">{bold(line.replace(/^\d+\.\s/, ""))}</li>);
    else if (!line.trim()) out.push(<div key={i} className="h-2" />);
    else out.push(<p key={i} className="text-sm leading-relaxed mb-1.5 text-foreground/90">{bold(line)}</p>);
    i++;
  }
  return out;
}

const fmtNum = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB").format(Math.round(n));
const fmtGbp = (n: number | null | undefined) =>
  n == null ? "—" : "£" + new Intl.NumberFormat("en-GB").format(Math.round(n));
const monthLabel = (y: number, m: number) =>
  new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });

export function InsightsContent({ isDrawer = false }: { isDrawer?: boolean }) {
  const { user } = useAuth();
  const [pharmacy, setPharmacy] = useState<PharmacyRow | null>(null);
  const [loadingPharm, setLoadingPharm] = useState(true);
  const [insights, setInsights] = useState<CachedInsight[]>([]);
  const [activeInsight, setActiveInsight] = useState<CachedInsight | null>(null);
  const [generating, setGenerating] = useState<InsightKey | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);

  const gen = useServerFn(generateInsight);
  const snap = useServerFn(getInsightsSnapshot);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoadingPharm(true);
      const { data } = await supabase
        .from("user_pharmacy")
        .select("pharmacy:pharmacies(id,ods_code,name,country,region,address)")
        .eq("user_id", user.id)
        .maybeSingle();
      const ph = (data as any)?.pharmacy ?? null;
      setPharmacy(ph);
      setLoadingPharm(false);
      if (ph) {
        const { data: ins } = await supabase
          .from("ai_insights")
          .select("id,insight_type,insight_text,generated_at")
          .eq("pharmacy_id", ph.id)
          .in("insight_type", Object.keys(INSIGHT_META))
          .order("generated_at", { ascending: false })
          .limit(20);
        const arr = (ins as CachedInsight[]) ?? [];
        setInsights(arr);

        setSnapLoading(true);
        try {
          const s = await snap({ data: { pharmacy_id: ph.id } });
          setSnapshot(s);
        } catch { /* non-critical */ }
        finally { setSnapLoading(false); }
      }
    })();
  }, [user]);

  const handleGenerate = async (type: InsightKey) => {
    if (!pharmacy) return;
    setGenerating(type);
    try {
      const r = await gen({ data: { pharmacy_id: pharmacy.id, insight_type: type } });
      const ins = r.insight as CachedInsight;
      setInsights((prev) => [ins, ...prev.filter((i) => i.insight_type !== type)]);
      setActiveInsight(ins);
      toast.success(`${INSIGHT_META[type].title} ready`);
      // smooth scroll to display
      setTimeout(() => document.getElementById("insight-display")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate insight");
    } finally {
      setGenerating(null);
    }
  };

  if (loadingPharm) {
    return <div className="p-8 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;
  }

  if (!pharmacy) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center space-y-4 pt-20">
        <div className="h-14 w-14 rounded-2xl bg-gold/10 border border-gold/20 flex items-center justify-center mx-auto">
          <Sparkles className="h-6 w-6 text-gold" />
        </div>
        <h1 className="text-xl font-semibold">Smart Insights</h1>
        <p className="text-sm text-muted-foreground">Set your pharmacy in My Pharmacy to unlock personalised AI-powered analysis.</p>
        <Button asChild><Link to="/dashboard">Go to My Pharmacy</Link></Button>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-secondary/30 via-background to-background">
      <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
        {!isDrawer && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link to="/dashboard" className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" /> My Pharmacy
            </Link>
            <span>/</span>
            <span className="text-foreground font-medium">Smart Insights</span>
          </div>
        )}

        <Hero pharmacy={pharmacy} snapshot={snapshot} />

        <MetricRow snapshot={snapshot} loading={snapLoading} />

        <div className="grid lg:grid-cols-2 gap-4">
          <ServiceMixCard snapshot={snapshot} />
          <IncomeMixCard snapshot={snapshot} />
        </div>

        <PercentileRails snapshot={snapshot} />

        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">AI analysis suite</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Six expert lenses on your pharmacy. Generate on demand.</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(Object.keys(INSIGHT_META) as InsightKey[]).map((k) => (
              <InsightToolCard
                key={k}
                kind={k}
                cached={insights.find((i) => i.insight_type === k)}
                generating={generating === k}
                anyGenerating={generating !== null}
                onGenerate={() => handleGenerate(k)}
                onShow={() => {
                  const c = insights.find((i) => i.insight_type === k);
                  if (c) {
                    setActiveInsight(c);
                    setTimeout(() => document.getElementById("insight-display")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                  }
                }}
                active={activeInsight?.insight_type === k}
              />
            ))}
          </div>
        </section>

        {generating && (
          <div className="rounded-xl border border-border bg-card p-8 text-center space-y-3">
            <div className="h-12 w-12 rounded-full bg-gold/10 flex items-center justify-center mx-auto">
              <Loader2 className="h-5 w-5 animate-spin text-gold" />
            </div>
            <p className="text-sm font-medium">Generating {INSIGHT_META[generating].title}…</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Processing 24 months of NHS dispensing data, peer benchmarks and local landscape. Takes 15–30 seconds.
            </p>
          </div>
        )}

        {activeInsight && !generating && (
          <div id="insight-display">
            <InsightDisplay insight={activeInsight} pharmacy={pharmacy} onRegenerate={handleGenerate} />
          </div>
        )}

        <AskAnything pharmacy={pharmacy} />
      </div>
    </div>
  );
}

// ============================================================
// Hero
// ============================================================

function Hero({ pharmacy, snapshot }: { pharmacy: PharmacyRow; snapshot: Snapshot | null }) {
  const period = snapshot?.reporting_period;
  return (
    <div className="rounded-2xl border border-border bg-card/80 backdrop-blur p-5 md:p-6 flex items-start gap-4 flex-wrap shadow-sm">
      <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-gold/30 to-gold/5 border border-gold/30 flex items-center justify-center shrink-0 shadow-inner">
        <Sparkles className="h-6 w-6 text-gold" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-[0.18em] text-gold font-semibold">Smart Insights</div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight mt-0.5">{pharmacy.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {pharmacy.region ? `${pharmacy.region} · ` : ""}{pharmacy.country ?? ""}{pharmacy.address ? ` · ${pharmacy.address}` : ""}
        </p>
        {period && (
          <p className="text-[11px] text-muted-foreground/80 mt-1.5">
            Reporting through {monthLabel(period.latest_year, period.latest_month)} · {period.months_of_history} months of history
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Metric row with sparklines
// ============================================================

function MetricRow({ snapshot, loading }: { snapshot: Snapshot | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading metrics…
      </div>
    );
  }
  if (!snapshot?.twelve_month) return null;
  const tm = snapshot.twelve_month;
  const peer = snapshot.peer_benchmark;
  const m: any = (snapshot as any).monthly ?? {};

  const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);

  const cards = [
    {
      label: "Items dispensed", value: fmtNum(tm.items_dispensed.current), yoy: tm.items_dispensed.yoy_pct,
      vsPeer: peer ? pct(tm.items_dispensed.current, peer.avg_items_12m) : null,
      peerVal: peer ? fmtNum(peer.avg_items_12m) : undefined,
      series: (m.items ?? []).map((p: any) => p.v),
      labels: (m.items ?? []).map((p: any) => monthLabel(p.y, p.m)),
    },
    {
      label: "Pharmacy First", value: fmtNum(tm.pharmacy_first.current), yoy: tm.pharmacy_first.yoy_pct,
      vsPeer: peer ? pct(tm.pharmacy_first.current, peer.avg_pf_12m) : null,
      peerVal: peer ? fmtNum(peer.avg_pf_12m) : undefined,
      series: (m.pharmacy_first ?? []).map((p: any) => p.v),
      labels: (m.pharmacy_first ?? []).map((p: any) => monthLabel(p.y, p.m)),
    },
    {
      label: "NMS", value: fmtNum(tm.nms.current), yoy: tm.nms.yoy_pct,
      vsPeer: peer ? pct(tm.nms.current, peer.avg_nms_12m) : null,
      peerVal: peer ? fmtNum(peer.avg_nms_12m) : undefined,
      series: (m.nms ?? []).map((p: any) => p.v),
      labels: (m.nms ?? []).map((p: any) => monthLabel(p.y, p.m)),
    },
    {
      label: "NHS payment", value: fmtGbp(tm.final_nhs_payment_gbp.current), yoy: tm.final_nhs_payment_gbp.yoy_pct,
      vsPeer: null, peerVal: undefined,
      series: (m.final_payment ?? []).map((p: any) => p.v),
      labels: (m.final_payment ?? []).map((p: any) => monthLabel(p.y, p.m)),
      gbp: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c) => <MetricCard key={c.label} {...c} />)}
    </div>
  );
}

function MetricCard({ label, value, yoy, vsPeer, peerVal, series, labels, gbp }: {
  label: string; value: string; yoy: number | null;
  vsPeer: number | null; peerVal?: string;
  series: number[]; labels: string[]; gbp?: boolean;
}) {
  const yoyColor = yoy == null ? "text-muted-foreground" : yoy > 0 ? "text-emerald-600" : yoy < 0 ? "text-rose-600" : "text-muted-foreground";
  const YoyIcon = yoy == null ? Minus : yoy > 0 ? TrendingUp : yoy < 0 ? TrendingDown : Minus;
  const peerColor = vsPeer == null ? "text-muted-foreground" : vsPeer > 0 ? "text-emerald-600" : vsPeer < 0 ? "text-rose-600" : "text-muted-foreground";

  return (
    <div className="rounded-xl border border-border bg-card p-4 hover:shadow-md transition-shadow">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
      <p className="text-xl md:text-2xl font-bold mt-1 tabular-nums">{value}</p>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs">
        <span className={`inline-flex items-center gap-0.5 font-medium ${yoyColor}`}>
          <YoyIcon className="h-3 w-3" />{yoy == null ? "—" : `${yoy > 0 ? "+" : ""}${yoy}%`}
        </span>
        <span className="text-muted-foreground">YoY</span>
      </div>
      <Sparkline values={series} labels={labels} gbp={gbp} />
      {peerVal && (
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Peer avg {peerVal}
          {vsPeer != null && <span className={`ml-1 font-medium ${peerColor}`}>({vsPeer > 0 ? "+" : ""}{vsPeer}%)</span>}
        </p>
      )}
    </div>
  );
}

function Sparkline({ values, labels, gbp }: { values: number[]; labels?: string[]; gbp?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  if (!values?.length) return <div className="h-10 mt-2" />;

  const w = 200, h = 40, pad = 2;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const dx = (w - pad * 2) / Math.max(1, values.length - 1);
  const points = values.map((v, i) => [pad + i * dx, h - pad - ((v - min) / range) * (h - pad * 2)]);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${path} L${points[points.length - 1][0].toFixed(1)},${h - pad} L${points[0][0].toFixed(1)},${h - pad} Z`;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * w;
    const idx = Math.max(0, Math.min(values.length - 1, Math.round((x - pad) / dx)));
    setHover(idx);
  };

  const hv = hover != null ? values[hover] : null;
  const hl = hover != null && labels ? labels[hover] : "";

  return (
    <div className="mt-2 relative">
      <svg
        ref={ref} viewBox={`0 0 ${w} ${h}`} className="w-full h-10 cursor-crosshair"
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="spk-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#spk-grad)" className="text-foreground" />
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground" />
        {hover != null && (
          <>
            <line x1={points[hover][0]} y1={pad} x2={points[hover][0]} y2={h - pad}
              stroke="currentColor" strokeWidth="0.5" opacity="0.3" className="text-foreground" />
            <circle cx={points[hover][0]} cy={points[hover][1]} r="2.5" fill="currentColor" className="text-foreground" />
          </>
        )}
      </svg>
      {hover != null && (
        <div className="absolute -top-7 left-0 text-[10px] bg-foreground text-background px-1.5 py-0.5 rounded tabular-nums whitespace-nowrap"
          style={{ left: `${(points[hover][0] / w) * 100}%`, transform: "translateX(-50%)" }}>
          {hl} · {gbp ? "£" + new Intl.NumberFormat("en-GB").format(Math.round(hv!)) : new Intl.NumberFormat("en-GB").format(Math.round(hv!))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Service mix donut
// ============================================================

function ServiceMixCard({ snapshot }: { snapshot: Snapshot | null }) {
  const mix = ((snapshot as any)?.service_mix_12m ?? []) as { label: string; value: number }[];
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-secondary/20 flex items-center gap-2">
        <PieChart className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Service mix · last 12 months</h2>
      </div>
      <div className="p-5">
        {mix.length === 0 ? (
          <p className="text-xs text-muted-foreground">No service activity recorded.</p>
        ) : (
          <Donut data={mix} />
        )}
      </div>
    </div>
  );
}

function IncomeMixCard({ snapshot }: { snapshot: Snapshot | null }) {
  const mix = ((snapshot as any)?.income_mix_12m ?? []) as { label: string; value: number }[];
  const total = mix.reduce((a, x) => a + x.value, 0);
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-secondary/20 flex items-center gap-2">
        <Coins className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Income mix · last 12 months</h2>
        <span className="text-xs text-muted-foreground ml-auto">{fmtGbp(total)}</span>
      </div>
      <div className="p-5 space-y-3">
        {mix.length === 0 ? (
          <p className="text-xs text-muted-foreground">No income breakdown available.</p>
        ) : mix.map((m) => {
          const pct = total > 0 ? (m.value / total) * 100 : 0;
          return (
            <div key={m.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium">{m.label}</span>
                <span className="tabular-nums text-muted-foreground">{fmtGbp(m.value)} · {pct.toFixed(0)}%</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-foreground/80 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Donut({ data }: { data: { label: string; value: number }[] }) {
  const total = data.reduce((a, x) => a + x.value, 0);
  const palette = [
    "hsl(45 80% 55%)", "hsl(200 70% 55%)", "hsl(150 55% 50%)", "hsl(280 50% 60%)",
    "hsl(15 75% 60%)", "hsl(335 60% 60%)", "hsl(90 50% 50%)", "hsl(220 60% 55%)",
  ];
  const r = 60, R = 90;
  const cx = 100, cy = 100;
  let acc = 0;
  const slices = data.map((d, i) => {
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += d.value;
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const large = end - start > Math.PI ? 1 : 0;
    const x1 = cx + R * Math.cos(start), y1 = cy + R * Math.sin(start);
    const x2 = cx + R * Math.cos(end), y2 = cy + R * Math.sin(end);
    const x3 = cx + r * Math.cos(end), y3 = cy + r * Math.sin(end);
    const x4 = cx + r * Math.cos(start), y4 = cy + r * Math.sin(start);
    return {
      ...d,
      color: palette[i % palette.length],
      pct: (d.value / total) * 100,
      path: `M${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 ${large} 0 ${x4},${y4} Z`,
    };
  });

  const [hover, setHover] = useState<number | null>(null);
  const active = hover != null ? slices[hover] : null;

  return (
    <div className="grid grid-cols-[160px_1fr] gap-4 items-center">
      <svg viewBox="0 0 200 200" className="w-40 h-40">
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color}
            opacity={hover == null || hover === i ? 1 : 0.35}
            onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}
            className="transition-opacity cursor-pointer" />
        ))}
        <text x="100" y="96" textAnchor="middle" className="fill-foreground text-[14px] font-bold">
          {active ? `${active.pct.toFixed(0)}%` : fmtNum(total)}
        </text>
        <text x="100" y="112" textAnchor="middle" className="fill-muted-foreground text-[9px] uppercase tracking-wider">
          {active ? active.label : "total items"}
        </text>
      </svg>
      <ul className="space-y-1 text-xs">
        {slices.map((s, i) => (
          <li key={i}
            onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}
            className={`flex items-center gap-2 px-1 py-0.5 rounded cursor-pointer ${hover === i ? "bg-secondary/50" : ""}`}>
            <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="flex-1 truncate">{s.label}</span>
            <span className="tabular-nums text-muted-foreground">{fmtNum(s.value)} · {s.pct.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================
// Percentile rails (your value placed on peer distribution)
// ============================================================

function PercentileRails({ snapshot }: { snapshot: Snapshot | null }) {
  const dist: any = (snapshot as any)?.peer_distribution;
  if (!dist || !snapshot?.twelve_month) return null;
  const tm = snapshot.twelve_month;
  const rows: { label: string; you: number; arr: number[]; gbp?: boolean }[] = [
    { label: "Items dispensed", you: tm.items_dispensed.current, arr: dist.items },
    { label: "Pharmacy First", you: tm.pharmacy_first.current, arr: dist.pf },
    { label: "NMS", you: tm.nms.current, arr: dist.nms },
    { label: "NHS payment", you: tm.final_nhs_payment_gbp.current, arr: dist.final_payment, gbp: true },
  ].filter((r) => r.arr?.length);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-secondary/20 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Your position vs peers</h2>
        <span className="text-xs text-muted-foreground ml-auto">12-month totals · n={dist.items.length} peers</span>
      </div>
      <div className="p-5 space-y-4">
        {rows.map((r) => <Rail key={r.label} {...r} />)}
      </div>
    </div>
  );
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function Rail({ label, you, arr, gbp }: { label: string; you: number; arr: number[]; gbp?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const sorted = useMemo(() => [...arr].sort((a, b) => a - b), [arr]);
  const rank = sorted.filter((v) => v <= you).length;
  const yourPct = Math.round((rank / sorted.length) * 100);
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];

  const fmt = gbp ? fmtGbp : fmtNum;

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const p = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    setHover(p);
  };
  const hoverVal = hover != null ? sorted[Math.min(sorted.length - 1, Math.floor((hover / 100) * sorted.length))] : null;
  const hoverPct = hover != null ? Math.round(hover) : null;

  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">You: <span className="text-foreground font-semibold">{fmt(you)}</span> · {ordinal(yourPct)} percentile</span>
      </div>
      <div ref={ref} className="relative h-7 rounded-md bg-gradient-to-r from-rose-500/15 via-amber-400/15 to-emerald-500/20 cursor-crosshair"
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {/* p25 / p50 / p75 ticks */}
        {[25, 50, 75].map((p) => (
          <div key={p} className="absolute top-0 bottom-0 w-px bg-border/80" style={{ left: `${p}%` }}>
            <span className="absolute -top-4 text-[9px] text-muted-foreground -translate-x-1/2">p{p}</span>
          </div>
        ))}
        {/* your marker */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-foreground" style={{ left: `${yourPct}%` }}>
          <div className="absolute -top-1.5 -translate-x-1/2 h-2 w-2 rotate-45 bg-foreground" />
        </div>
        {hover != null && (
          <div className="absolute -top-7 text-[10px] bg-foreground text-background px-1.5 py-0.5 rounded tabular-nums whitespace-nowrap"
            style={{ left: `${hover}%`, transform: "translateX(-50%)" }}>
            {ordinal(hoverPct!)} · {fmt(hoverVal!)}
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
        <span>min {fmt(sorted[0])}</span>
        <span>p50 {fmt(p50)}</span>
        <span>max {fmt(sorted[sorted.length - 1])}</span>
      </div>
    </div>
  );
}

// ============================================================
// AI Tool cards (on-demand)
// ============================================================

function InsightToolCard({ kind, cached, generating, anyGenerating, onGenerate, onShow, active }: {
  kind: InsightKey;
  cached: CachedInsight | undefined;
  generating: boolean;
  anyGenerating: boolean;
  onGenerate: () => void;
  onShow: () => void;
  active: boolean;
}) {
  const meta = INSIGHT_META[kind];
  const Icon = meta.icon;
  const accent = ACCENT_BG[meta.accent];

  return (
    <div className={[
      "group rounded-xl border bg-card p-4 transition-all flex flex-col gap-3",
      active ? "border-foreground/30 ring-1 ring-foreground/10 shadow-sm" : "border-border hover:border-foreground/20 hover:shadow-sm",
    ].join(" ")}>
      <div className="flex items-start gap-3">
        <div className={`h-9 w-9 rounded-lg border flex items-center justify-center shrink-0 ${accent}`}>
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">{meta.title}</h3>
          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{meta.blurb}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap mt-auto">
        {cached ? (
          <>
            <Button size="sm" variant={active ? "default" : "outline"} className="h-7 text-xs px-3" onClick={onShow}>
              {active ? "Viewing" : "View"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2 gap-1.5" disabled={anyGenerating} onClick={onGenerate}>
              <RefreshCw className="h-3 w-3" /> Refresh
            </Button>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1 ml-auto">
              <Clock className="h-3 w-3" />{timeAgo(cached.generated_at)}
            </span>
          </>
        ) : (
          <Button size="sm" className="h-7 text-xs px-3 gap-1.5" disabled={anyGenerating} onClick={onGenerate}>
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {generating ? "Generating…" : "Generate"}
          </Button>
        )}
      </div>
    </div>
  );
}

function InsightDisplay({ insight, pharmacy, onRegenerate }: {
  insight: CachedInsight; pharmacy: PharmacyRow;
  onRegenerate: (t: InsightKey) => void;
}) {
  const meta = INSIGHT_META[insight.insight_type as InsightKey] ?? INSIGHT_META.swot;
  const Icon = meta.icon;

  const exportMd = () => {
    const blob = new Blob([`# ${meta.title} — ${pharmacy.name}\n\n${insight.insight_text}`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${meta.title}-${pharmacy.ods_code}.md`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border flex-wrap bg-secondary/20">
        <div className="flex items-center gap-3">
          <div className={`h-9 w-9 rounded-lg border flex items-center justify-center ${ACCENT_BG[meta.accent]}`}>
            <Icon className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">{meta.title}</h2>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <Clock className="h-3 w-3" />{timeAgo(insight.generated_at)} · {pharmacy.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] bg-gold/10 text-amber-700 border border-gold/25 rounded-full px-2.5 py-0.5 font-semibold uppercase tracking-wider">AI</span>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 px-2.5" onClick={exportMd}>
            <Download className="h-3 w-3" /> Export
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 px-2.5"
            onClick={() => onRegenerate(insight.insight_type as InsightKey)}>
            <RefreshCw className="h-3 w-3" /> Regenerate
          </Button>
        </div>
      </div>
      <div className="px-5 py-6 space-y-0.5 max-h-[75vh] overflow-y-auto">
        {renderMd(insight.insight_text)}
      </div>
      <div className="px-5 py-3 border-t border-border bg-secondary/30">
        <p className="text-[11px] text-muted-foreground">
          AI analysis using NHS open dispensing data only. Not financial advice. Verify all figures with management accounts before acting.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// AI Q&A chat — with history, follow-ups, export, clear
// ============================================================

const DEFAULT_SUGGESTIONS = [
  "What's my biggest 90-day opportunity to grow income?",
  "How am I performing on Pharmacy First vs peers?",
  "What service is most underused relative to peers?",
  "Where am I leaking value right now?",
];

function AskAnything({ pharmacy }: { pharmacy: PharmacyRow }) {
  const storageKey = `insights.chat.${pharmacy.id}`;
  const [messages, setMessages] = useState<ChatMsg[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { return []; }
  });
  const [followups, setFollowups] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const ask = useServerFn(askInsightsQuestion);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(messages.slice(-30))); } catch { /* ignore */ }
  }, [messages, storageKey]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setInput("");
    setFollowups([]);
    const next: ChatMsg[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setBusy(true);
    try {
      const r = await ask({
        data: { pharmacy_id: pharmacy.id, question, history: messages.slice(-10) },
      });
      setMessages([...next, { role: "assistant", content: r.answer }]);
      setFollowups((r as any).followups ?? []);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to get answer");
      setMessages(next);
    } finally {
      setBusy(false);
    }
  };

  const clearChat = () => { setMessages([]); setFollowups([]); };

  const exportChat = () => {
    const md = `# Q&A — ${pharmacy.name}\n\n` + messages.map((m) =>
      m.role === "user" ? `**You:** ${m.content}` : `**AI:**\n\n${m.content}`
    ).join("\n\n---\n\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `chat-${pharmacy.ods_code}.md`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      <div className="px-5 py-3 border-b border-border bg-secondary/20 flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Ask anything about {pharmacy.name}</h2>
        <span className="text-[10px] bg-gold/10 text-amber-700 border border-gold/25 rounded-full px-2 py-0.5 font-semibold uppercase tracking-wider ml-auto">AI</span>
        {messages.length > 0 && (
          <>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 px-2" onClick={exportChat}>
              <Download className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 px-2" onClick={clearChat}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </>
        )}
      </div>

      <div className="px-5 py-4 max-h-[55vh] overflow-y-auto space-y-4">
        {messages.length === 0 && !busy && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Free-form questions about your NHS data, service mix, peer comparison or local landscape. Try one:
            </p>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}
                  className="text-xs text-left rounded-full border border-border bg-secondary/40 hover:bg-secondary px-3 py-1.5 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-3.5 py-2 text-sm">
                {m.content}
              </div>
            ) : (
              <div className="space-y-0.5">{renderMd(m.content)}</div>
            )}
          </div>
        ))}

        {!busy && followups.length > 0 && (
          <div className="border-t border-border pt-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1">
              <Lightbulb className="h-3 w-3" /> Follow-ups
            </p>
            <div className="flex flex-wrap gap-2">
              {followups.map((s, i) => (
                <button key={i} onClick={() => send(s)}
                  className="text-xs text-left rounded-full border border-border bg-secondary/40 hover:bg-secondary px-3 py-1.5 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="border-t border-border p-3 flex items-center gap-2 bg-background">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your performance, services, or peers…"
          className="flex-1 bg-secondary/40 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold/40 placeholder:text-muted-foreground"
          disabled={busy} />
        <Button type="submit" size="sm" disabled={busy || !input.trim()} className="h-9 px-3 gap-1.5">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Send
        </Button>
      </form>
    </div>
  );
}

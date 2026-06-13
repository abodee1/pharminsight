import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { generateInsight } from "@/lib/insights.functions";
import { Button } from "@/components/ui/button";
import {
  Sparkles, Loader2, RefreshCw, Clock, TrendingUp,
  Building2, ArrowLeft, ChevronRight, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

type PharmacyRow = { id: string; ods_code: string; name: string; country: string | null; region: string | null; address: string | null };
type CachedInsight = { id: string; insight_type: string; insight_text: string; generated_at: string };
type MarketMover = { ods_code: string; name: string; country: string | null; region: string | null };

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
  return text.split("\n").map((line, i) => {
    if (line.startsWith("## ")) return <h2 key={i} className="text-sm font-semibold mt-5 mb-1.5 text-foreground">{line.slice(3)}</h2>;
    if (line.startsWith("# ")) return <h1 key={i} className="text-base font-bold mt-6 mb-2 text-foreground">{line.slice(2)}</h1>;
    if (/^[-•*]\s/.test(line)) return <li key={i} className="ml-4 text-sm leading-relaxed mb-1 text-foreground/90">{bold(line.replace(/^[-•*]\s/, ""))}</li>;
    if (/^\d+\.\s/.test(line)) return <li key={i} className="ml-4 list-decimal text-sm leading-relaxed mb-1 text-foreground/90">{bold(line.replace(/^\d+\.\s/, ""))}</li>;
    if (!line.trim()) return <div key={i} className="h-2" />;
    return <p key={i} className="text-sm leading-relaxed mb-1.5 text-foreground/90">{bold(line)}</p>;
  });
}

export function InsightsContent({ isDrawer = false }: { isDrawer?: boolean }) {
  const { user } = useAuth();
  const [pharmacy, setPharmacy] = useState<PharmacyRow | null>(null);
  const [loadingPharm, setLoadingPharm] = useState(true);
  const [insights, setInsights] = useState<CachedInsight[]>([]);
  const [activeInsight, setActiveInsight] = useState<CachedInsight | null>(null);
  const [generating, setGenerating] = useState<"swot" | "benchmark" | null>(null);
  const [movers, setMovers] = useState<MarketMover[]>([]);
  const [moverContext, setMoverContext] = useState<string>("");

  const gen = useServerFn(generateInsight);

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
          .in("insight_type", ["swot", "benchmark"])
          .order("generated_at", { ascending: false })
          .limit(4);
        const arr = (ins as CachedInsight[]) ?? [];
        setInsights(arr);
        setActiveInsight(arr[0] ?? null);
      }
    })();
  }, [user]);

  useEffect(() => {
    (async () => {
      try {
        const now = new Date();
        const ly = now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
        const lm = now.getUTCMonth() >= 2 ? now.getUTCMonth() - 1 : now.getUTCMonth() + 11;
        const [{ data: cur }, { data: prev }] = await Promise.all([
          supabase.from("dispensing_data").select("pharmacy_id").eq("year", ly).eq("month", lm).gt("items_dispensed", 0).limit(3000),
          supabase.from("dispensing_data").select("pharmacy_id").eq("year", ly - 1).eq("month", lm).gt("items_dispensed", 0).limit(3000),
        ]);
        const prevSet = new Set((prev ?? []).map((r: any) => r.pharmacy_id));
        const newIds = (cur ?? []).filter((r: any) => !prevSet.has(r.pharmacy_id)).map((r: any) => r.pharmacy_id).slice(0, 12);
        if (newIds.length > 0) {
          const { data: ph } = await supabase
            .from("pharmacies")
            .select("ods_code,name,country,region")
            .in("id", newIds)
            .not("country", "eq", "England");
          setMovers((ph as MarketMover[]) ?? []);
          setMoverContext(`${MONTHS[lm - 1]} ${ly} vs ${MONTHS[lm - 1]} ${ly - 1}`);
        }
      } catch { /* non-critical */ }
    })();
  }, []);

  const handleGenerate = async (type: "swot" | "benchmark") => {
    if (!pharmacy) return;
    setGenerating(type);
    try {
      const r = await gen({ data: { pharmacy_id: pharmacy.id, insight_type: type } });
      const ins = r.insight as CachedInsight;
      setInsights(prev => [ins, ...prev.filter(i => i.insight_type !== type)]);
      setActiveInsight(ins);
      toast.success("Analysis complete");
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
        <p className="text-sm text-muted-foreground">Set your pharmacy in the dashboard to unlock personalised AI-powered analysis.</p>
        <Button asChild><Link to="/dashboard">Go to dashboard</Link></Button>
      </div>
    );
  }

  const swotCached = insights.find(i => i.insight_type === "swot");
  const benchCached = insights.find(i => i.insight_type === "benchmark");

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      {!isDrawer && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link to="/dashboard" className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
          </Link>
          <span>/</span>
          <span className="text-foreground font-medium">Smart Insights</span>
        </div>
      )}

      <div className="flex items-start gap-4 flex-wrap">
        <div className="h-12 w-12 rounded-2xl bg-gold/10 border border-gold/20 flex items-center justify-center shrink-0">
          <Sparkles className="h-5 w-5 text-gold" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Smart Insights</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI-powered analysis for <span className="font-medium text-foreground">{pharmacy.name}</span>
            {pharmacy.region && <span className="text-muted-foreground"> · {pharmacy.region}</span>}
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <InsightTypeCard
          title="SWOT Analysis"
          description="Board-grade strengths, weaknesses, opportunities and threats — anchored to your actual NHS numbers and local competitive landscape."
          icon={<Sparkles className="h-5 w-5 text-gold" />}
          accent="gold"
          cached={swotCached}
          generating={generating === "swot"}
          onGenerate={() => handleGenerate("swot")}
          onShow={() => setActiveInsight(swotCached!)}
          active={activeInsight?.insight_type === "swot"}
        />
        <InsightTypeCard
          title="Performance Commentary"
          description="Expert narrative on your dispensing trend, NHS service mix, income quality, wins and leakage gaps versus national peers."
          icon={<TrendingUp className="h-5 w-5 text-sky-500" />}
          accent="sky"
          cached={benchCached}
          generating={generating === "benchmark"}
          onGenerate={() => handleGenerate("benchmark")}
          onShow={() => setActiveInsight(benchCached!)}
          active={activeInsight?.insight_type === "benchmark"}
        />
      </div>

      {generating && (
        <div className="rounded-xl border border-border bg-card p-8 text-center space-y-3">
          <div className="h-12 w-12 rounded-full bg-gold/10 flex items-center justify-center mx-auto">
            <Loader2 className="h-5 w-5 animate-spin text-gold" />
          </div>
          <p className="text-sm font-medium">Analysing {pharmacy.name}…</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Processing 24 months of NHS dispensing data, peer benchmarks, and local landscape intelligence. Takes 15–30 seconds.
          </p>
        </div>
      )}

      {activeInsight && !generating && (
        <InsightDisplay
          insight={activeInsight}
          pharmacy={pharmacy}
          onRegenerate={handleGenerate}
        />
      )}

      {movers.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Market movers — recently active</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Pharmacies with dispensing activity in {moverContext} that were not seen in the same month one year prior.
            May include newly registered contractors or pharmacies returning from inactivity.
          </p>
          <div className="space-y-2">
            {movers.map((p) => (
              <Link
                key={p.ods_code}
                to="/pharmacy/$odsCode"
                params={{ odsCode: p.ods_code }}
                className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-3 py-2.5 hover:bg-secondary transition-colors"
              >
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{[p.country, p.region].filter(Boolean).join(" · ")} · {p.ods_code}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </Link>
            ))}
          </div>
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 p-2.5 text-xs flex gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>England excluded — detecting new pharmacies across 16,000+ contractors requires a dedicated pipeline (on roadmap). Scotland and Northern Ireland shown here.</span>
          </div>
        </div>
      )}
    </div>
  );
}

function InsightTypeCard({ title, description, icon, accent, cached, generating, onGenerate, onShow, active }: {
  title: string; description: string; icon: React.ReactNode; accent: "gold" | "sky";
  cached: CachedInsight | undefined; generating: boolean;
  onGenerate: () => void; onShow: () => void; active: boolean;
}) {
  const borderCls = active
    ? accent === "gold" ? "border-gold/50 ring-1 ring-gold/20" : "border-sky-400/50 ring-1 ring-sky-400/20"
    : "border-border";

  return (
    <div className={["rounded-xl border bg-card p-5 transition-all", borderCls].join(" ")}>
      <div className="flex items-start gap-3 mb-4">
        <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center shrink-0">{icon}</div>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {cached ? (
          <>
            <Button size="sm" variant={active ? "default" : "outline"} className="h-7 text-xs px-3" onClick={onShow}>
              {active ? "Viewing" : "View"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2.5 gap-1.5" disabled={generating} onClick={onGenerate}>
              <RefreshCw className="h-3 w-3" /> Refresh
            </Button>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />{timeAgo(cached.generated_at)}
            </span>
          </>
        ) : (
          <Button size="sm" className="h-7 text-xs px-3 gap-1.5" disabled={generating} onClick={onGenerate}>
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Generate
          </Button>
        )}
      </div>
    </div>
  );
}

function InsightDisplay({ insight, pharmacy, onRegenerate }: {
  insight: CachedInsight; pharmacy: PharmacyRow;
  onRegenerate: (t: "swot" | "benchmark") => void;
}) {
  const typeLabel = insight.insight_type === "swot" ? "SWOT Analysis" : "Performance Commentary";

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border flex-wrap bg-secondary/20">
        <div>
          <h2 className="text-sm font-semibold">{typeLabel}</h2>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Clock className="h-3 w-3" />{timeAgo(insight.generated_at)} · {pharmacy.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] bg-gold/10 text-amber-700 border border-gold/25 rounded-full px-2.5 py-0.5 font-semibold uppercase tracking-wider">AI</span>
          <Button
            size="sm" variant="ghost"
            className="h-7 text-xs gap-1.5 px-2.5"
            onClick={() => onRegenerate(insight.insight_type as "swot" | "benchmark")}
          >
            <RefreshCw className="h-3 w-3" /> Regenerate
          </Button>
        </div>
      </div>
      <div className="px-5 py-6 space-y-0.5 max-h-[70vh] overflow-y-auto">
        {renderMd(insight.insight_text)}
      </div>
      <div className="px-5 py-3 border-t border-border bg-secondary/30">
        <p className="text-[11px] text-muted-foreground">
          AI analysis using NHS open dispensing data only. Not financial advice. Verify all figures with management accounts before making investment or operational decisions.
        </p>
      </div>
    </div>
  );
}

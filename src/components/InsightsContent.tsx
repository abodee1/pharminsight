import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { generateInsight, getInsightsSnapshot, askInsightsQuestion } from "@/lib/insights.functions";
import { Button } from "@/components/ui/button";
import {
  Sparkles, Loader2, RefreshCw, Clock, TrendingUp, TrendingDown, Minus,
  ArrowLeft, MessageSquare, Send, BarChart3,
} from "lucide-react";
import { toast } from "sonner";

type PharmacyRow = { id: string; ods_code: string; name: string; country: string | null; region: string | null; address: string | null };
type CachedInsight = { id: string; insight_type: string; insight_text: string; generated_at: string };
type ChatMsg = { role: "user" | "assistant"; content: string };
type Snapshot = Awaited<ReturnType<ReturnType<typeof useServerFn<typeof getInsightsSnapshot>>>>;

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

const fmtNum = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB").format(Math.round(n));
const fmtGbp = (n: number | null | undefined) =>
  n == null ? "—" : "£" + new Intl.NumberFormat("en-GB").format(Math.round(n));

export function InsightsContent({ isDrawer = false }: { isDrawer?: boolean }) {
  const { user } = useAuth();
  const [pharmacy, setPharmacy] = useState<PharmacyRow | null>(null);
  const [loadingPharm, setLoadingPharm] = useState(true);
  const [insights, setInsights] = useState<CachedInsight[]>([]);
  const [activeInsight, setActiveInsight] = useState<CachedInsight | null>(null);
  const [generating, setGenerating] = useState<"swot" | "benchmark" | null>(null);
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
          .in("insight_type", ["swot", "benchmark"])
          .order("generated_at", { ascending: false })
          .limit(4);
        const arr = (ins as CachedInsight[]) ?? [];
        setInsights(arr);
        setActiveInsight(arr[0] ?? null);

        setSnapLoading(true);
        try {
          const s = await snap({ data: { pharmacy_id: ph.id } });
          setSnapshot(s);
        } catch { /* non-critical */ }
        finally { setSnapLoading(false); }
      }
    })();
  }, [user]);

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
        <p className="text-sm text-muted-foreground">Set your pharmacy in My Pharmacy to unlock personalised AI-powered analysis.</p>
        <Button asChild><Link to="/dashboard">Go to My Pharmacy</Link></Button>
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
            <ArrowLeft className="h-3.5 w-3.5" /> My Pharmacy
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

      <PeerSnapshot snapshot={snapshot} loading={snapLoading} />

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

      <AskAnything pharmacy={pharmacy} />
    </div>
  );
}

// ============================================================
// Peer Snapshot — quick stat cards
// ============================================================

function PeerSnapshot({ snapshot, loading }: { snapshot: Snapshot | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading peer snapshot…
      </div>
    );
  }
  if (!snapshot?.twelve_month) return null;

  const tm = snapshot.twelve_month;
  const peer = snapshot.peer_benchmark;
  const items = tm.items_dispensed;
  const pf = tm.pharmacy_first;
  const nms = tm.nms;

  const pct = (a: number, b: number) => b > 0 ? Math.round(((a - b) / b) * 100) : null;
  const itemsVsPeer = peer ? pct(items.current, peer.avg_items_12m) : null;
  const pfVsPeer = peer ? pct(pf.current, peer.avg_pf_12m) : null;
  const nmsVsPeer = peer ? pct(nms.current, peer.avg_nms_12m) : null;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-secondary/20 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Peer benchmark snapshot</h2>
        <span className="text-xs text-muted-foreground ml-auto">
          Last 12 months{peer ? ` · vs ${peer.n} ${peer.country ?? ""} peers` : ""}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border">
        <SnapStat label="Items dispensed" value={fmtNum(items.current)} yoy={items.yoy_pct} vsPeer={itemsVsPeer} peerVal={peer ? fmtNum(peer.avg_items_12m) : undefined} />
        <SnapStat label="Pharmacy First" value={fmtNum(pf.current)} yoy={pf.yoy_pct} vsPeer={pfVsPeer} peerVal={peer ? fmtNum(peer.avg_pf_12m) : undefined} />
        <SnapStat label="NMS" value={fmtNum(nms.current)} yoy={nms.yoy_pct} vsPeer={nmsVsPeer} peerVal={peer ? fmtNum(peer.avg_nms_12m) : undefined} />
        <SnapStat label="NHS payment" value={fmtGbp(tm.final_nhs_payment_gbp.current)} yoy={tm.final_nhs_payment_gbp.yoy_pct} />
      </div>
    </div>
  );
}

function SnapStat({ label, value, yoy, vsPeer, peerVal }: {
  label: string; value: string; yoy: number | null;
  vsPeer?: number | null; peerVal?: string;
}) {
  const yoyColor = yoy == null ? "text-muted-foreground" : yoy > 0 ? "text-emerald-600" : yoy < 0 ? "text-rose-600" : "text-muted-foreground";
  const YoyIcon = yoy == null ? Minus : yoy > 0 ? TrendingUp : yoy < 0 ? TrendingDown : Minus;
  const peerColor = vsPeer == null ? "text-muted-foreground" : vsPeer > 0 ? "text-emerald-600" : vsPeer < 0 ? "text-rose-600" : "text-muted-foreground";

  return (
    <div className="bg-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
      <p className="text-xl font-bold mt-1 tabular-nums">{value}</p>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs">
        <span className={`inline-flex items-center gap-0.5 font-medium ${yoyColor}`}>
          <YoyIcon className="h-3 w-3" />{yoy == null ? "—" : `${yoy > 0 ? "+" : ""}${yoy}%`}
        </span>
        <span className="text-muted-foreground">YoY</span>
      </div>
      {peerVal && (
        <p className="text-[11px] text-muted-foreground mt-1">
          Peer avg {peerVal}
          {vsPeer != null && <span className={`ml-1 font-medium ${peerColor}`}>({vsPeer > 0 ? "+" : ""}{vsPeer}%)</span>}
        </p>
      )}
    </div>
  );
}

// ============================================================
// AI Q&A chat
// ============================================================

const SUGGESTIONS = [
  "What's my biggest opportunity to grow income in 90 days?",
  "How am I performing on Pharmacy First vs peers?",
  "Why might my dispensing volume be trending the way it is?",
  "What service is most underused relative to peers?",
];

function AskAnything({ pharmacy }: { pharmacy: PharmacyRow }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const ask = useServerFn(askInsightsQuestion);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setInput("");
    const next: ChatMsg[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setBusy(true);
    try {
      const r = await ask({
        data: {
          pharmacy_id: pharmacy.id,
          question,
          history: messages.slice(-10),
        },
      });
      setMessages([...next, { role: "assistant", content: r.answer }]);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to get answer");
      setMessages(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-secondary/20 flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Ask anything about {pharmacy.name}</h2>
        <span className="text-[10px] bg-gold/10 text-amber-700 border border-gold/25 rounded-full px-2 py-0.5 font-semibold uppercase tracking-wider ml-auto">AI</span>
      </div>

      <div className="px-5 py-4 max-h-[50vh] overflow-y-auto space-y-4">
        {messages.length === 0 && !busy && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Ask free-form questions about your NHS dispensing data, service mix, peer comparison or local landscape. Try one:
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-xs text-left rounded-full border border-border bg-secondary/40 hover:bg-secondary px-3 py-1.5 transition-colors"
                >
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

        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="border-t border-border p-3 flex items-center gap-2 bg-background"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your performance, services, or peers…"
          className="flex-1 bg-secondary/40 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold/40 placeholder:text-muted-foreground"
          disabled={busy}
        />
        <Button type="submit" size="sm" disabled={busy || !input.trim()} className="h-9 px-3 gap-1.5">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Send
        </Button>
      </form>
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

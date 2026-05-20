import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { generateInsight } from "@/lib/insights.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/insights")({ component: Insights });

const TYPES = [
  { key: "swot", title: "SWOT Analysis", desc: "Board-grade strengths, weaknesses, opportunities and threats — grounded in your real NHS dispensing data, peer benchmarks and local landscape." },
  { key: "benchmark", title: "Performance Commentary", desc: "An investor-ready narrative of how your pharmacy is performing vs its own history and country peers, with quantified wins, leaks and a 90-day action list." },
] as const;

const LABELS: Record<string, string> = {
  swot: "SWOT analysis",
  benchmark: "Performance commentary",
  acquisition_report: "Acquisition report",
  trend: "Trend analysis",
  acquisition: "Acquisition note",
};

function Insights() {
  const { user } = useAuth();
  const generate = useServerFn(generateInsight);
  const [loading, setLoading] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadHistory = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("ai_insights").select("*").eq("user_id", user.id)
      .order("generated_at", { ascending: false });
    setHistory(data || []);
  };
  useEffect(() => { loadHistory(); }, [user]);

  const run = async (type: typeof TYPES[number]["key"]) => {
    if (!user) return;
    setLoading(type);
    try {
      const { data: up } = await supabase.from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle();
      const pharmacy_id = up?.pharmacy_id ?? null;
      if (!pharmacy_id) {
        toast.error("Set a primary pharmacy first to generate insights.");
        return;
      }
      await generate({ data: { insight_type: type, pharmacy_id, context: {} } });
      toast.success("Insight generated");
      await loadHistory();
    } catch (e: any) {
      toast.error(e.message || "Failed to generate insight");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Smart Pharmacy Insights"
        subtitle="Generate a SWOT analysis, benchmark commentary, or acquisition assessment using your pharmacy's NHS data."
      />

      <div className="grid md:grid-cols-3 gap-4">
        {TYPES.map((t) => (
          <div key={t.key} className="rounded-lg bg-card border border-border p-6 shadow-sm flex flex-col">
            <div className="h-10 w-10 rounded-md bg-gold/15 text-gold flex items-center justify-center">
              <Sparkles className="h-5 w-5" />
            </div>
            <h3 className="mt-4 font-semibold">{t.title}</h3>
            <p className="text-sm text-muted-foreground mt-1 flex-1">{t.desc}</p>
            <button
              disabled={loading !== null}
              onClick={() => run(t.key)}
              className="mt-4 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading === t.key ? <><Loader2 className="h-4 w-4 animate-spin" /> Analysing your data…</> : "Generate"}
            </button>
          </div>
        ))}
        <div className="rounded-lg border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-card p-6 shadow-sm flex flex-col">
          <div className="h-10 w-10 rounded-md bg-primary/15 text-primary flex items-center justify-center">
            <Sparkles className="h-5 w-5" />
          </div>
          <h3 className="mt-4 font-semibold">Acquisition Intelligence Report</h3>
          <p className="text-sm text-muted-foreground mt-1 flex-1">
            Full M&amp;A-grade due diligence brief: location, GP catchment, competitor map, NHS performance vs peers,
            untapped service revenue, indicative valuation and a buy/hold/pass recommendation. Exportable as PDF.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">Open any pharmacy profile and click <span className="font-semibold text-foreground">Acquisition report</span>.</p>
        </div>
      </div>

      <h2 className="mt-10 text-lg font-semibold">Recent insights</h2>
      <div className="mt-3 space-y-3">
        {history.length === 0 && (
          <p className="text-sm text-muted-foreground">No insights yet. Generate your first one above.</p>
        )}
        {history.map((h) => {
          const isReport = h.insight_type === "acquisition_report";
          return (
            <div key={h.id} className="rounded-lg bg-card border border-border p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded bg-gold/15 text-gold whitespace-nowrap">
                    {LABELS[h.insight_type] ?? h.insight_type}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(h.generated_at).toLocaleString("en-GB")}
                  </span>
                </div>
                <button
                  onClick={() => setExpanded(expanded === h.id ? null : h.id)}
                  className="text-sm text-primary font-medium hover:underline whitespace-nowrap"
                >
                  {expanded === h.id ? "Collapse" : "Expand"}
                </button>
              </div>
              {expanded === h.id && (
                isReport ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Open this pharmacy's profile and click <span className="font-semibold text-foreground">Acquisition report</span> to view the full brief.
                  </p>
                ) : (
                  <article className="mt-5 prose prose-sm md:prose-base max-w-none
                    prose-headings:font-semibold prose-headings:tracking-tight
                    prose-h2:mt-8 prose-h2:mb-3 prose-h2:text-xl prose-h2:border-b prose-h2:border-border prose-h2:pb-2
                    prose-h3:mt-6 prose-h3:mb-2 prose-h3:text-base
                    prose-p:leading-relaxed prose-p:text-foreground/90
                    prose-strong:text-foreground
                    prose-li:my-1 prose-ul:my-3 prose-ol:my-3
                    prose-a:text-primary">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{h.insight_text}</ReactMarkdown>
                  </article>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

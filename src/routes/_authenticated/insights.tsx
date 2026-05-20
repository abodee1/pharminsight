import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { generateInsight } from "@/lib/insights.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/insights")({ component: Insights });

const TYPES = [
  { key: "swot", title: "SWOT Analysis", desc: "Strengths, weaknesses, opportunities and threats from your dispensing trends and service uptake." },
  { key: "benchmark", title: "Performance Commentary", desc: "Plain-English summary of the last three months versus benchmarks." },
] as const;

function Insights() {
  const { user, profile } = useAuth();
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
      let ctx: any = { note: "No pharmacy set." };
      if (pharmacy_id) {
        const [{ data: ph }, { data: rows }] = await Promise.all([
          supabase.from("pharmacies").select("*").eq("id", pharmacy_id).single(),
          supabase.from("dispensing_data").select("*").eq("pharmacy_id", pharmacy_id),
        ]);
        ctx = { pharmacy: ph, monthly: rows };
      }
      await generate({ data: { insight_type: type, pharmacy_id, context: ctx } });
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
        {history.map((h) => (
          <div key={h.id} className="rounded-lg bg-card border border-border p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded bg-gold/15 text-gold">
                  {h.insight_type}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(h.generated_at).toLocaleString("en-GB")}
                </span>
              </div>
              <button
                onClick={() => setExpanded(expanded === h.id ? null : h.id)}
                className="text-sm text-primary font-medium hover:underline"
              >
                {expanded === h.id ? "Collapse" : "Expand"}
              </button>
            </div>
            {expanded === h.id && (
              <div className="mt-4 text-sm whitespace-pre-wrap leading-relaxed text-foreground">
                {h.insight_text}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

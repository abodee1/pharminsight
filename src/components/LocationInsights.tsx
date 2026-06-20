import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import { Loader2, MapPin, Sparkles, RefreshCw, Building2, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { generateInsight } from "@/lib/insights.functions";
import { gpDisplayName, gpDisplayAddress } from "@/lib/gpName";

type Props = {
  pharmacyId: string;
  pharmacyName: string;
  postcode: string | null;
  address: string | null;
};

type Catchment = {
  admin_district?: string;
  admin_ward?: string;
  parliamentary_constituency?: string;
  region?: string;
  country?: string;
  lsoa?: string;
  msoa?: string;
  ccg?: string;
};

type NearbyPharm = { name: string; distance_m: number };
type NearbyGP = { name: string; address: string; distance_m: number };

function fmtDist(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function LocationInsights({ pharmacyId, pharmacyName, postcode, address }: Props) {
  const [catchment, setCatchment] = useState<Catchment | null>(null);
  const [catchmentLoading, setCatchmentLoading] = useState(true);
  const [nearby, setNearby] = useState<{ pharmacies: NearbyPharm[]; gps: NearbyGP[] } | null>(null);
  const [nearbyLoading, setNearbyLoading] = useState(true);
  const [commentary, setCommentary] = useState<{ text: string; generatedAt: string } | null>(null);
  const [commentaryLoading, setCommentaryLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const runInsight = useServerFn(generateInsight);

  // Load postcode catchment data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCatchmentLoading(true);
      if (!postcode) { setCatchmentLoading(false); return; }
      try {
        const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`);
        const j = await res.json();
        if (!cancelled && j?.result) {
          const r = j.result;
          setCatchment({
            admin_district: r.admin_district,
            admin_ward: r.admin_ward,
            parliamentary_constituency: r.parliamentary_constituency,
            region: r.region,
            country: r.country,
            lsoa: r.lsoa,
            msoa: r.msoa,
            ccg: r.ccg,
          });
        }
      } catch { /* ignore */ }
      if (!cancelled) setCatchmentLoading(false);
    })();
    return () => { cancelled = true; };
  }, [postcode]);

  // Load nearby pharmacies + GPs
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setNearbyLoading(true);
      setNearby(null);
      if (!postcode) { setNearbyLoading(false); return; }
      try {
        const geo = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`);
        const gj = await geo.json();
        if (!gj?.result) { setNearbyLoading(false); return; }
        const lat = gj.result.latitude, lng = gj.result.longitude;

        const [pRes, gpRes] = await Promise.all([
          supabase.rpc("pharmacies_near", { p_lat: lat, p_lng: lng, p_radius_m: 1600, p_limit: 25 }),
          supabase.rpc("gp_practices_near", { p_lat: lat, p_lng: lng, p_radius_m: 1600, p_limit: 20 }),
        ]);
        if (cancelled) return;

        const selfName = pharmacyName.toLowerCase().trim();
        const pcCompact = postcode.toUpperCase().replace(/\s+/g, "");

        const pharmacies: NearbyPharm[] = ((pRes.data ?? []) as any[])
          .filter((p: any) => {
            const samePc = (p.postcode || "").toUpperCase().replace(/\s+/g, "") === pcCompact;
            const sameName = (p.name || "").toLowerCase().trim() === selfName;
            return !(samePc && sameName);
          })
          .slice(0, 10)
          .map((p: any) => ({ name: p.name, distance_m: Math.round(p.distance_m) }));

        const gps: NearbyGP[] = ((gpRes.data ?? []) as any[])
          .slice(0, 10)
          .map((p: any) => ({ name: gpDisplayName(p), address: gpDisplayAddress(p), distance_m: Math.round(p.distance_m) }));

        if (!cancelled) setNearby({ pharmacies, gps });
      } catch { /* ignore */ }
      if (!cancelled) setNearbyLoading(false);
    })();
    return () => { cancelled = true; };
  }, [postcode, pharmacyName]);

  // Auto-load cached AI commentary
  useEffect(() => {
    (async () => {
      setCommentaryLoading(true);
      const { data } = await supabase
        .from("ai_insights")
        .select("insight_text,generated_at")
        .eq("pharmacy_id", pharmacyId)
        .eq("insight_type", "benchmark")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setCommentary({ text: data.insight_text, generatedAt: data.generated_at });
      setCommentaryLoading(false);
    })();
  }, [pharmacyId]);

  const generate = async (force = false) => {
    setGenerating(true);
    if (force) setCommentary(null);
    try {
      const { insight } = await runInsight({
        data: { insight_type: "benchmark", pharmacy_id: pharmacyId },
      });
      if (insight) setCommentary({ text: insight.insight_text, generatedAt: insight.generated_at });
    } catch (e: any) {
      toast.error(e?.message || "Could not generate commentary");
    } finally {
      setGenerating(false);
    }
  };

  // Auto-generate if no cached commentary and we're done loading
  useEffect(() => {
    if (!commentaryLoading && !commentary && !generating) {
      generate();
    }
  }, [commentaryLoading]);

  const facts: Array<[string, string]> = catchment
    ? ([
        ["Local authority", catchment.admin_district],
        ["Ward", catchment.admin_ward],
        ["Constituency", catchment.parliamentary_constituency],
        ["Region", catchment.region],
        ["NHS area (CCG/ICB)", catchment.ccg],
        ["LSOA", catchment.lsoa],
      ].filter(([, v]) => !!v) as Array<[string, string]>)
    : [];

  function timeAgo(ts: string) {
    const h = Math.round((Date.now() - new Date(ts).getTime()) / 3_600_000);
    if (h < 1) return "just now";
    if (h < 48) return `${h}h ago`;
    return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  return (
    <section className="space-y-4">
      {/* Catchment area */}
      {!catchmentLoading && facts.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
            <h3 className="text-sm font-semibold">Catchment area</h3>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</dt>
                <dd className="text-sm font-medium mt-0.5 leading-snug">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Local landscape — competitors + GPs */}
      {!nearbyLoading && nearby && (
        <div className="rounded-xl border border-border bg-card p-4 md:p-5">
          <h3 className="text-sm font-semibold mb-4">Local landscape <span className="text-muted-foreground font-normal">(within ~1 mile)</span></h3>
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Competitor pharmacies */}
            <div>
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                <Building2 className="h-3.5 w-3.5" /> {nearby.pharmacies.length} competitor {nearby.pharmacies.length === 1 ? "pharmacy" : "pharmacies"}
              </p>
              {nearby.pharmacies.length === 0 ? (
                <p className="text-xs text-muted-foreground">No competitors within 1 mile — isolated location.</p>
              ) : (
                <ul className="space-y-1.5">
                  {nearby.pharmacies.map((p, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 text-xs rounded-lg bg-secondary/40 px-3 py-2">
                      <span className="font-medium truncate">{p.name}</span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">{fmtDist(p.distance_m)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* GP surgeries */}
            <div>
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                <Stethoscope className="h-3.5 w-3.5" /> {nearby.gps.length} GP {nearby.gps.length === 1 ? "surgery" : "surgeries"}
              </p>
              {nearby.gps.length === 0 ? (
                <p className="text-xs text-muted-foreground">No GP surgeries within 1 mile.</p>
              ) : (
                <ul className="space-y-1.5">
                  {nearby.gps.map((g, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 text-xs rounded-lg bg-secondary/40 px-3 py-2">
                      <span className="font-medium truncate">{g.name}</span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">{fmtDist(g.distance_m)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Performance Commentary */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-4 md:px-5 py-4 border-b border-border flex-wrap bg-secondary/30">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold">Performance commentary</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                AI analysis grounded in 24 months of dispensing data, peer benchmarks, and local landscape.
              </p>
            </div>
          </div>
          {commentary && !generating && (
            <button
              onClick={() => generate(true)}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <RefreshCw className="h-3 w-3" /> Regenerate
            </button>
          )}
        </div>

        <div className="px-4 md:px-5 py-4">
          {(commentaryLoading || generating) && (
            <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              <span>{generating ? "Generating analysis… this takes 15–30 seconds." : "Loading commentary…"}</span>
            </div>
          )}

          {commentary && !generating && (
            <>
              <div className="prose prose-sm max-w-none dark:prose-invert text-sm leading-relaxed">
                <ReactMarkdown>{commentary.text}</ReactMarkdown>
              </div>
              <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Generated {timeAgo(commentary.generatedAt)} · AI analysis · NHS open dispensing data</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => generate(true)}
                  disabled={generating}
                >
                  Refresh
                </Button>
              </div>
            </>
          )}

          {!commentaryLoading && !generating && !commentary && (
            <div className="text-center py-8 space-y-3">
              <Sparkles className="h-6 w-6 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">No commentary generated yet.</p>
              <Button size="sm" onClick={() => generate()} className="gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> Generate
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

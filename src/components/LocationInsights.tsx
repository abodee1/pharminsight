import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import { Loader2, MapPin, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { LocalLandscape } from "@/components/LocalLandscape";
import { generateInsight } from "@/lib/insights.functions";

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
  parish?: string | null;
  ccg?: string;
  nuts?: string;
};

export function LocationInsights({ pharmacyId, pharmacyName, postcode, address }: Props) {
  const [catchment, setCatchment] = useState<Catchment | null>(null);
  const [catchmentLoading, setCatchmentLoading] = useState(true);
  const [aiMd, setAiMd] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const runInsight = useServerFn(generateInsight);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCatchment(null);
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
            parish: r.parish,
            ccg: r.ccg,
            nuts: r.nuts,
          });
        }
      } catch { /* ignore */ }
      if (!cancelled) setCatchmentLoading(false);
    })();
    return () => { cancelled = true; };
  }, [postcode]);

  const generate = async () => {
    setAiLoading(true);
    setAiMd(null);
    try {
      const { insight } = await runInsight({
        data: { insight_type: "benchmark", pharmacy_id: pharmacyId },
      });
      setAiMd(insight?.insight_text ?? "");
    } catch (e: any) {
      toast.error(e?.message || "Could not generate AI summary");
    } finally {
      setAiLoading(false);
    }
  };

  const facts: Array<[string, string | undefined | null]> = catchment
    ? [
        ["Local authority", catchment.admin_district],
        ["Ward", catchment.admin_ward],
        ["Constituency", catchment.parliamentary_constituency],
        ["Region", catchment.region],
        ["Country", catchment.country],
        ["NHS area (CCG/ICB)", catchment.ccg],
        ["LSOA", catchment.lsoa],
        ["MSOA", catchment.msoa],
      ].filter(([, v]) => !!v)
    : [];

  return (
    <section className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <MapPin className="h-4 w-4 text-gold" />
          <h3 className="text-sm font-semibold">Catchment & administrative area</h3>
        </div>
        {catchmentLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Resolving postcode…
          </p>
        ) : !postcode ? (
          <p className="text-sm text-muted-foreground">No postcode on record for this pharmacy.</p>
        ) : facts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Couldn't resolve catchment for {postcode}.</p>
        ) : (
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-sm">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <LocalLandscape pharmacyName={pharmacyName} postcode={postcode} address={address} />

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-gold" /> Location-aware performance commentary
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              AI commentary grounded in this pharmacy's metrics, country peers, and the actual GP cluster and competitors around the branch.
            </p>
          </div>
          <Button size="sm" onClick={generate} disabled={aiLoading} className="gap-1.5">
            {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {aiMd ? "Regenerate" : "Generate"}
          </Button>
        </div>
        {aiLoading && !aiMd && (
          <p className="text-sm text-muted-foreground">Analysing local landscape and dispensing trends…</p>
        )}
        {aiMd && (
          <div className="prose prose-sm max-w-none dark:prose-invert mt-2">
            <ReactMarkdown>{aiMd}</ReactMarkdown>
          </div>
        )}
      </div>
    </section>
  );
}

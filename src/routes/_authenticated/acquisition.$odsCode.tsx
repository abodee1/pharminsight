import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { generateAcquisitionReport } from "@/lib/insights.functions";
import { AcquisitionReport, PrintButton, type AcquisitionReportData } from "@/components/AcquisitionReport";
import { ArrowLeft, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/acquisition/$odsCode")({
  component: AcquisitionPage,
});

type Pharmacy = { id: string; ods_code: string; name: string; trading_name: string | null; address: string | null; postcode: string | null; country: string | null; region: string | null };

function AcquisitionPage() {
  const { odsCode } = Route.useParams();
  const gen = useServerFn(generateAcquisitionReport);
  const [pharmacy, setPharmacy] = useState<Pharmacy | null>(null);
  const [report, setReport] = useState<AcquisitionReportData | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    (async () => {
      setBootstrapping(true);
      const { data: p } = await supabase
        .from("pharmacies").select("id,ods_code,name,trading_name,address,postcode,country,region")
        .eq("ods_code", odsCode.toUpperCase()).maybeSingle();
      setPharmacy(p as Pharmacy | null);
      setBootstrapping(false);
    })();
  }, [odsCode]);

  const run = async (force = false) => {
    if (!pharmacy) return;
    setLoading(true);
    try {
      const res = await gen({ data: { pharmacy_id: pharmacy.id, force } });
      setReport(res.report as AcquisitionReportData);
      setGeneratedAt(res.generated_at);
      if (res.cached && !force) toast.info("Showing your most recent report");
      else toast.success("Acquisition report ready");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate report");
    } finally {
      setLoading(false);
    }
  };

  // Auto-load on mount if pharmacy ready
  useEffect(() => { if (pharmacy && !report && !loading) run(false); /* eslint-disable-next-line */ }, [pharmacy]);

  if (bootstrapping) {
    return (
      <div className="p-10 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!pharmacy) {
    return (
      <div className="p-10">
        <p className="text-sm">Pharmacy not found.</p>
        <Link to="/dashboard" className="text-primary text-sm underline">Back to My Pharmacy</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="acq-no-print sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 md:px-10 py-3 flex items-center gap-3">
          <Link to="/pharmacy/$odsCode" params={{ odsCode: pharmacy.ods_code }}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to pharmacy
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {report && (
              <button onClick={() => run(true)} disabled={loading}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Regenerate
              </button>
            )}
            {report && <PrintButton />}
          </div>
        </div>
      </div>

      <div className="p-6 md:p-10 max-w-6xl mx-auto">
        {loading && !report && (
          <div className="rounded-xl border border-border bg-card p-10 text-center">
            <Sparkles className="h-8 w-8 mx-auto text-primary animate-pulse" />
            <p className="mt-4 font-semibold">Building acquisition intelligence…</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Crunching NHS history, peer benchmarks, GP catchment and competitor data. This takes ~30 seconds.
            </p>
          </div>
        )}
        {report && (
          <AcquisitionReport report={report} pharmacy={pharmacy} generatedAt={generatedAt} />
        )}
      </div>
    </div>
  );
}

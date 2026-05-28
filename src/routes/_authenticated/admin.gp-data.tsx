import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { backfillGpGeocodes, refreshScotlandGpContacts, refreshEnglandGpContacts } from "@/lib/gpMatch.functions";

export const Route = createFileRoute("/_authenticated/admin/gp-data")({
  component: GpDataAdmin,
});


type Row = { source: string; dataset: string; year: number | null; month: number | null; status: string };

const SERIES: Array<{
  key: string; label: string; source: string; hook: string;
  cadence: "monthly" | "quarterly";
}> = [
  { key: "scot-rx", label: "Scotland GP prescribing", source: "NHS_SCOT_GP", hook: "ingest-scotland-gp", cadence: "monthly" },
  { key: "scot-link", label: "Scotland GP–pharmacy linkage", source: "NHS_SCOT_LINKAGE", hook: "ingest-scotland-gp-linkage", cadence: "quarterly" },
  { key: "scot-list", label: "Scotland GP list sizes", source: "NHS_SCOT_LISTSIZE", hook: "ingest-scotland-gp-listsize", cadence: "quarterly" },
  { key: "eng-rx", label: "England GP prescribing", source: "NHSBSA_GP", hook: "ingest-england-gp", cadence: "monthly" },
  { key: "eng-list", label: "England GP list sizes", source: "NHSBSA_LISTSIZE", hook: "ingest-england-gp-listsize", cadence: "quarterly" },
];

function monthsBetween(startY: number, startM: number, endY: number, endM: number) {
  const out: Array<{ y: number; m: number }> = [];
  let y = startY, m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    out.push({ y, m });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

function GpDataAdmin() {
  const [logs, setLogs] = useState<Row[]>([]);
  const [queue, setQueue] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [geocoding, setGeocoding] = useState(false);
  const [refreshingScot, setRefreshingScot] = useState(false);
  const [refreshingEng, setRefreshingEng] = useState(false);
  const runBackfill = useServerFn(backfillGpGeocodes);
  const runScot = useServerFn(refreshScotlandGpContacts);
  const runEng = useServerFn(refreshEnglandGpContacts);

  const triggerBackfill = async () => {
    setGeocoding(true);
    toast.info("Geocoding GP practices via postcodes.io…");
    try {
      const r = await runBackfill({ data: { limit: 5000 } });
      toast.success(`Geocoded ${r.updated} (missed ${r.missed}). Remaining: ${r.remaining ?? "?"}`);
    } catch (e: any) {
      toast.error(`Geocode failed: ${e?.message || e}`);
    } finally {
      setGeocoding(false);
    }
  };

  const triggerScotRefresh = async () => {
    setRefreshingScot(true);
    toast.info("Refreshing Scotland GP contact details…");
    try {
      const r = await runScot();
      toast.success(`Scotland: upserted ${r.upserted} practices from ${r.source}`);
    } catch (e: any) {
      toast.error(`Scotland refresh failed: ${e?.message || e}`);
    } finally {
      setRefreshingScot(false);
    }
  };

  const triggerEngRefresh = async () => {
    setRefreshingEng(true);
    toast.info("Refreshing England GP contact details (ORD)…");
    try {
      const r = await runEng();
      toast.success(`England: upserted ${r.upserted} practices across ${r.pages} pages`);
    } catch (e: any) {
      toast.error(`England refresh failed: ${e?.message || e}`);
    } finally {
      setRefreshingEng(false);
    }
  };



  const refresh = async () => {
    setLoading(true);
    const [l, q] = await Promise.all([
      supabase.from("ingestion_log").select("source,dataset,year,month,status").in("source", SERIES.map((s) => s.source)).order("created_at", { ascending: false }).limit(2000),
      supabase.from("ingestion_queue").select("source,dataset,year,month,status").in("source", SERIES.map((s) => s.source)).limit(2000),
    ]);
    setLogs((l.data as Row[]) ?? []);
    setQueue((q.data as Row[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const statusFor = (source: string, y: number, m: number): "success" | "failed" | "pending" | "absent" => {
    // Quarterly series only meaningful at quarter months 1,4,7,10
    const ok = logs.find((r) => r.source === source && r.year === y && r.month === m && r.status === "success");
    if (ok) return "success";
    const fail = logs.find((r) => r.source === source && r.year === y && r.month === m && r.status === "failed");
    if (fail) return "failed";
    const q = queue.find((r) => r.source === source && r.year === y && r.month === m && (r.status === "pending" || r.status === "processing"));
    if (q) return "pending";
    return "absent";
  };

  const triggerHook = async (hook: string) => {
    toast.info(`Triggering ${hook}…`);
    const res = await fetch(`/api/public/hooks/${hook}`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    if (res.ok) toast.success(`Done: queued ${j.queued ?? 0}, processed ${j.processed ?? 0}`);
    else toast.error(`Failed: ${j.error ?? res.status}`);
    refresh();
  };

  const today = new Date();
  const months = monthsBetween(2020, 1, today.getUTCFullYear(), today.getUTCMonth() + 1);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-semibold">GP Data Coverage</h1>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={triggerScotRefresh} disabled={refreshingScot}>
            {refreshingScot ? "Scotland…" : "Refresh Scotland names/postcodes"}
          </Button>
          <Button variant="outline" size="sm" onClick={triggerEngRefresh} disabled={refreshingEng}>
            {refreshingEng ? "England…" : "Refresh England names/postcodes"}
          </Button>
          <Button variant="outline" size="sm" onClick={triggerBackfill} disabled={geocoding}>
            {geocoding ? "Geocoding…" : "Geocode practices"}
          </Button>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>

      </div>

      <p className="text-sm text-muted-foreground">
        Green = ingested · Red = failed · Amber = pending · Grey = not yet ingested. Click a grey cell to trigger that series.
      </p>

      <div className="space-y-6">
        {SERIES.map((s) => (
          <div key={s.key} className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-medium">{s.label}</div>
                <div className="text-xs text-muted-foreground">{s.cadence} · source: {s.source}</div>
              </div>
              <Button size="sm" onClick={() => triggerHook(s.hook)}>Run now</Button>
            </div>
            <div className="grid grid-cols-12 gap-1">
              {months.map(({ y, m }) => {
                const relevant = s.cadence === "monthly" || [1, 4, 7, 10].includes(m);
                if (!relevant) {
                  return <div key={`${y}-${m}`} className="h-7 rounded bg-transparent" title={`${y}-${String(m).padStart(2, "0")} (n/a)`} />;
                }
                const st = statusFor(s.source, y, m);
                const cls =
                  st === "success" ? "bg-emerald-500" :
                  st === "failed" ? "bg-rose-500" :
                  st === "pending" ? "bg-amber-400" :
                  "bg-muted hover:bg-muted-foreground/30 cursor-pointer";
                return (
                  <button
                    key={`${y}-${m}`}
                    type="button"
                    className={`h-7 rounded text-[10px] leading-7 text-center text-white/90 ${cls}`}
                    title={`${y}-${String(m).padStart(2, "0")} · ${st}`}
                    onClick={st === "absent" ? () => triggerHook(s.hook) : undefined}
                  >
                    {m === 1 ? y : ""}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

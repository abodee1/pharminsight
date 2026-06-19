import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, ShieldAlert } from "lucide-react";
import { backfillGpGeocodes, refreshScotlandGpContacts, refreshEnglandGpContacts, getGpCoverage } from "@/lib/gpMatch.functions";

export const Route = createFileRoute("/_authenticated/admin/gp-data")({
  component: GpDataAdminGate,
});

function GpDataAdminGate() {
  const { user, loading } = useAuth();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (loading) return;
    if (!user) { setIsAdmin(false); setChecking(false); return; }
    (async () => {
      const { data } = await supabase
        .from("user_roles").select("role")
        .eq("user_id", user.id).eq("role", "admin").maybeSingle();
      setIsAdmin(!!data);
      setChecking(false);
    })();
  }, [user, loading]);
  if (loading || checking) {
    return <div className="p-8 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Verifying access…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="p-8 max-w-md mx-auto text-center space-y-2">
        <ShieldAlert className="h-10 w-10 text-rose-500 mx-auto" />
        <h1 className="text-xl font-semibold">Admin only</h1>
        <p className="text-sm text-muted-foreground">You don't have access to GP data administration.</p>
      </div>
    );
  }
  return <GpDataAdmin />;
}

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

function CoverageStat({ label, pct, sub }: { label: string; pct: number; sub: string }) {
  return (
    <div className="border rounded-md p-2">
      <div className="text-muted-foreground uppercase tracking-wide text-[10px]">{label}</div>
      <div className="text-base font-semibold tabular-nums">{pct}%</div>
      <div className="text-muted-foreground">{sub}</div>
    </div>
  );
}

function GpDataAdmin() {
  const [logs, setLogs] = useState<Row[]>([]);
  const [queue, setQueue] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [geocoding, setGeocoding] = useState(false);
  const [refreshingScot, setRefreshingScot] = useState(false);
  const [refreshingEng, setRefreshingEng] = useState(false);
  const [coverage, setCoverage] = useState<Awaited<ReturnType<typeof getGpCoverage>> | null>(null);
  const runBackfill = useServerFn(backfillGpGeocodes);
  const runScot = useServerFn(refreshScotlandGpContacts);
  const runEng = useServerFn(refreshEnglandGpContacts);
  const runCoverage = useServerFn(getGpCoverage);

  const loadCoverage = async () => {
    try { setCoverage(await runCoverage()); } catch { /* ignore */ }
  };

  const triggerBackfill = async () => {
    setGeocoding(true);
    toast.info("Geocoding GP practices via postcodes.io…");
    try {
      const r = await runBackfill({ data: { limit: 5000 } });
      toast.success(`Geocoded ${r.updated} (missed ${r.missed}). Remaining: ${r.remaining ?? "?"}`);
      loadCoverage();
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
  useEffect(() => { refresh(); loadCoverage(); }, []);

  const statusFor = (source: string, y: number, m: number): "success" | "failed" | "pending" | "absent" => {
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

      {coverage && (
        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <h2 className="font-medium">Coverage health</h2>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums">{coverage.healthScore}</span>
              <span className="text-xs text-muted-foreground">/ 100</span>
            </div>
          </div>
          <div className="h-2 rounded bg-muted overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${coverage.healthScore}%` }}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <CoverageStat label="Has name" pct={coverage.pctName} sub={`${coverage.withName.toLocaleString()} / ${coverage.total.toLocaleString()}`} />
            <CoverageStat label="Has postcode" pct={coverage.pctPostcode} sub={`${coverage.withPostcode.toLocaleString()} / ${coverage.total.toLocaleString()}`} />
            <CoverageStat label="Geocoded" pct={coverage.pctLat} sub={`${coverage.withLat.toLocaleString()} / ${coverage.total.toLocaleString()}`} />
          </div>

          <p className="text-xs text-muted-foreground">
            Scotland: {coverage.scotland.toLocaleString()} practices · England: {coverage.england.toLocaleString()} practices
          </p>
        </div>
      )}

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

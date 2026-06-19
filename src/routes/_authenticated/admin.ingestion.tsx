import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Database, RefreshCw, ExternalLink, CheckCircle2, AlertTriangle, Clock, Activity,
  Pill, Stethoscope, Users2, Building2, MapPinned, Loader2, ShieldAlert, Radar,
} from "lucide-react";

// ---- Friendly error helpers ---------------------------------------------
function humanizeHookError(body: any, status: number): string {
  const raw = typeof body === "string"
    ? body
    : (body?.error || body?.message || body?.detail || "");
  const msg = String(raw || "").trim();

  if (status === 401 || status === 403) return "Not authorised. Sign back in as an admin and retry.";
  if (status === 408 || /timeout|timed out/i.test(msg)) return "The upstream source took too long to respond. Try again in a minute.";
  if (status === 429 || /rate.?limit/i.test(msg)) return "Upstream rate limit hit. Wait a couple of minutes before retrying.";
  if (status === 502 || status === 503 || status === 504) return "Upstream NHS / Open Data service is unavailable right now. Retry shortly.";
  if (/ENOTFOUND|ECONN|fetch failed|network/i.test(msg)) return "Couldn't reach the upstream source. Check connectivity and retry.";
  if (/no new|already up to date|nothing to do/i.test(msg)) return "No new data is available from the upstream source.";
  if (msg) return msg.length > 400 ? msg.slice(0, 400) + "…" : msg;
  return `Request failed (HTTP ${status}).`;
}

function friendlyMessage(e: unknown): string {
  if (!e) return "Unknown error.";
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}


export const Route = createFileRoute("/_authenticated/admin/ingestion")({
  component: AdminIngestionGate,
});

function AdminIngestionGate() {
  const { user, loading } = useAuth();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) { setIsAdmin(false); setChecking(false); return; }
    (async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
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
        <p className="text-sm text-muted-foreground">You don't have access to the ingestion control panel.</p>
      </div>
    );
  }
  return <DataIngestionAdmin />;
}

type Cadence = "monthly" | "quarterly";
type Group = "Pharmacy dispensing" | "GP prescribing" | "GP linkage" | "GP list sizes";

type Dataset = {
  key: string;
  label: string;
  group: Group;
  country: "Scotland" | "England" | "Northern Ireland" | "Wales" | "UK-wide";
  source: string;          // ingestion_log.source value
  hook: string;            // /api/public/hooks/<hook>
  cadence: Cadence;
  publisher: string;
  publisherUrl: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

const DATASETS: Dataset[] = [
  {
    key: "scot-pharmacy",
    label: "Scotland — community pharmacy dispensing",
    group: "Pharmacy dispensing",
    country: "Scotland",
    source: "PHS_SCOTLAND",
    hook: "ingest-scotland",
    cadence: "monthly",
    publisher: "Public Health Scotland (opendata.nhs.scot)",
    publisherUrl: "https://www.opendata.nhs.scot/dataset/prescriptions-in-the-community",
    description: "Monthly dispenser-level activity, Pharmacy First, MCR, smoking cessation, EHC, methadone supervision and contractor payment files.",
    icon: Pill,
  },
  {
    key: "england-pharmacy",
    label: "England — pharmacy & appliance dispensing",
    group: "Pharmacy dispensing",
    country: "England",
    source: "NHSBSA",
    hook: "ingest-england",
    cadence: "monthly",
    publisher: "NHS Business Services Authority (opendata.nhsbsa.net)",
    publisherUrl: "https://opendata.nhsbsa.net/dataset/pharmacy-and-appliance-contractor-dispensing-data",
    description: "Monthly contractor-level items dispensed, EPS counts, NMS interventions, Pharmacy First consultations and flu vaccinations.",
    icon: Pill,
  },
  {
    key: "ni-pharmacy",
    label: "Northern Ireland — dispensing by contractor",
    group: "Pharmacy dispensing",
    country: "Northern Ireland",
    source: "HSCNI_BSO",
    hook: "ingest-ni",
    cadence: "monthly",
    publisher: "HSC Business Services Organisation (data.gov.uk)",
    publisherUrl: "https://www.opendatani.gov.uk/@business-services-organisation",
    description: "Monthly community pharmacy dispensing volumes for Northern Ireland contractors.",
    icon: Pill,
  },
  {
    key: "wales-pharmacy",
    label: "Wales — community pharmacy dispensing",
    group: "Pharmacy dispensing",
    country: "Wales",
    source: "NWSSP_WALES",
    hook: "ingest-wales",
    cadence: "monthly",
    publisher: "NWSSP / NHS Wales (data.gov.uk + opendata.nwssp.wales.nhs.uk)",
    publisherUrl: "https://ckan.publishing.service.gov.uk/dataset/dispensing-by-pharmacy-contractor-wales",
    description: "Monthly community pharmacy dispensing volumes for Welsh contractors, via NWSSP open data.",
    icon: Pill,
  },
  {
    key: "scot-gp",
    label: "Scotland — GP prescribing",
    group: "GP prescribing",
    country: "Scotland",
    source: "NHS_SCOT_GP",
    hook: "ingest-scotland-gp",
    cadence: "monthly",
    publisher: "Public Health Scotland (opendata.nhs.scot)",
    publisherUrl: "https://www.opendata.nhs.scot/dataset/prescriptions-in-the-community",
    description: "Monthly prescriber-location and dispenser-location files — items issued by each GP practice.",
    icon: Stethoscope,
  },
  {
    key: "england-gp",
    label: "England — GP prescribing (EPD)",
    group: "GP prescribing",
    country: "England",
    source: "NHSBSA_GP",
    hook: "ingest-england-gp",
    cadence: "monthly",
    publisher: "NHS Business Services Authority (EPD / EPD-SNOMED)",
    publisherUrl: "https://opendata.nhsbsa.net/dataset/english-prescribing-data-epd-snomed",
    description: "Monthly English Prescribing Dataset — ~1 GB per file, streamed and aggregated per practice.",
    icon: Stethoscope,
  },
  {
    key: "scot-link",
    label: "Scotland — GP ↔ pharmacy linkage",
    group: "GP linkage",
    country: "Scotland",
    source: "NHS_SCOT_LINKAGE",
    hook: "ingest-scotland-gp-linkage",
    cadence: "quarterly",
    publisher: "Public Health Scotland (opendata.nhs.scot)",
    publisherUrl: "https://www.opendata.nhs.scot/dataset/prescribed-dispensed",
    description: "Quarterly prescriber → dispenser linkage, identifying which pharmacies serve each GP practice.",
    icon: MapPinned,
  },
  {
    key: "scot-list",
    label: "Scotland — GP practice list sizes",
    group: "GP list sizes",
    country: "Scotland",
    source: "NHS_SCOT_LISTSIZE",
    hook: "ingest-scotland-gp-listsize",
    cadence: "quarterly",
    publisher: "Public Health Scotland (opendata.nhs.scot)",
    publisherUrl: "https://www.opendata.nhs.scot/dataset/gp-practice-populations",
    description: "Quarterly registered patient counts by GP practice (Scotland).",
    icon: Users2,
  },
  {
    key: "england-list",
    label: "England — GP practice list sizes",
    group: "GP list sizes",
    country: "England",
    source: "NHSBSA_LISTSIZE",
    hook: "ingest-england-gp-listsize",
    cadence: "monthly",
    publisher: "NHS Digital — Patients Registered at a GP Practice",
    publisherUrl: "https://digital.nhs.uk/data-and-information/publications/statistical/patients-registered-at-a-gp-practice",
    description: "Monthly registered patient counts by GP practice (England), published via NHS Digital Spine ORD + Patients Registered extract.",
    icon: Building2,
  },
];

type LogRow = {
  source: string;
  status: string;
  year: number | null;
  month: number | null;
  rows_ingested: number | null;
  error: string | null;
  created_at: string;
};
type QueueRow = {
  source: string;
  status: string;
  year: number | null;
  month: number | null;
};
type Stats = {
  latestSuccess: LogRow | null;
  latestFailure: LogRow | null;
  successes30d: number;
  failures30d: number;
  totalRecords30d: number;
  pendingQueue: number;
  coveragePct: number; // 0–100 over last 36 months for monthly / 12 quarters for quarterly
};

function pad(n: number) { return String(n).padStart(2, "0"); }
function periodLabel(y: number | null, m: number | null) {
  if (!y || !m) return "—";
  return `${y}-${pad(m)}`;
}
function timeAgo(ts: string | null | undefined) {
  if (!ts) return "—";
  const d = new Date(ts).getTime();
  const mins = Math.floor((Date.now() - d) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">—</span>;
  const map: Record<string, { cls: string; label: string; Icon: any }> = {
    success: { cls: "bg-emerald-50 text-emerald-800 border-emerald-200", label: "Healthy", Icon: CheckCircle2 },
    failed: { cls: "bg-rose-50 text-rose-800 border-rose-200", label: "Failing", Icon: AlertTriangle },
    pending: { cls: "bg-amber-50 text-amber-800 border-amber-200", label: "Pending", Icon: Clock },
    processing: { cls: "bg-sky-50 text-sky-800 border-sky-200", label: "Processing", Icon: Activity },
    skipped: { cls: "bg-secondary text-muted-foreground border-border", label: "Skipped", Icon: Clock },
  };
  const m = map[status] ?? { cls: "bg-secondary text-muted-foreground border-border", label: status, Icon: Clock };
  const I = m.Icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium border rounded-full px-2 py-0.5 ${m.cls}`}>
      <I className="h-3 w-3" /> {m.label}
    </span>
  );
}

function DatasetCard({ ds, stats, onRun, onBackfill, running, backfilling, backfillProgress }: {
  ds: Dataset;
  stats: Stats;
  onRun: () => void;
  onBackfill: () => void;
  running: boolean;
  backfilling: boolean;
  backfillProgress?: { done: number; remaining: number } | null;
}) {
  const Icon = ds.icon;
  const lastSuccess = stats.latestSuccess;
  const lastFailure = stats.latestFailure;
  const overallStatus = lastFailure && (!lastSuccess || new Date(lastFailure.created_at) > new Date(lastSuccess.created_at))
    ? "failed"
    : lastSuccess ? "success" : "pending";

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="rounded-md bg-secondary p-2 shrink-0">
              <Icon className="h-5 w-5 text-foreground" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base leading-tight truncate">{ds.label}</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {ds.country} · {ds.cadence} · {ds.publisher}
              </CardDescription>
            </div>
          </div>
          <StatusBadge status={overallStatus} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground text-xs leading-relaxed">{ds.description}</p>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Latest ingested period</p>
            <p className="font-medium tabular-nums">{periodLabel(lastSuccess?.year ?? null, lastSuccess?.month ?? null)}</p>
            <p className="text-[10px] text-muted-foreground">{timeAgo(lastSuccess?.created_at)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Coverage (recent window)</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-emerald-500" style={{ width: `${stats.coveragePct}%` }} />
              </div>
              <span className="text-xs tabular-nums">{stats.coveragePct}%</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-1 text-xs">
          <Stat label="30d runs OK" value={stats.successes30d} tone={stats.successes30d > 0 ? "good" : "neutral"} />
          <Stat label="30d failures" value={stats.failures30d} tone={stats.failures30d > 0 ? "bad" : "good"} />
          <Stat label="Records (30d)" value={stats.totalRecords30d.toLocaleString()} />
        </div>

        {stats.pendingQueue > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 text-amber-900 text-xs px-3 py-2">
            <Clock className="inline h-3.5 w-3.5 mr-1" /> {stats.pendingQueue} item{stats.pendingQueue === 1 ? "" : "s"} queued and waiting to be processed.
          </div>
        )}

        {lastFailure && (!lastSuccess || new Date(lastFailure.created_at) > new Date(lastSuccess.created_at)) && (
          <div className="rounded-md border border-rose-200 bg-rose-50 text-rose-900 text-xs px-3 py-2">
            <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
            Last attempt failed{lastFailure.error ? `: ${lastFailure.error.slice(0, 140)}` : ""}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2 flex-wrap">
          <Button size="sm" onClick={onRun} disabled={running || backfilling}>
            {running ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running…</> : <><RefreshCw className="h-3.5 w-3.5" /> Run now</>}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onBackfill}
            disabled={running || backfilling || ds.source === "NWSSP_WALES"}
            title={ds.source === "NWSSP_WALES"
              ? "No machine-readable upstream available for Wales — can't backfill"
              : "Loop the ingest hook until every missing period in the recent window is queued and processed"}
          >
            {backfilling
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Backfilling{backfillProgress ? ` (${backfillProgress.done} done, ${backfillProgress.remaining} left)` : "…"}</>
              : <><Database className="h-3.5 w-3.5" /> Backfill gaps</>}
          </Button>
          <a
            href={ds.publisherUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            Source <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string | number; tone?: "good" | "bad" | "neutral" }) {
  const cls = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-rose-700" : "text-foreground";
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${cls}`}>{value}</p>
    </div>
  );
}

// Map any month to its quarter-end month (1-3→3, 4-6→6, 7-9→9, 10-12→12).
function quarterEndMonth(month: number): number {
  return (Math.floor((month - 1) / 3) + 1) * 3;
}

function expectedPeriods(cadence: Cadence): Array<{ y: number; m: number }> {
  // monthly: last 36 calendar months ending last month.
  // quarterly: last 12 quarters keyed by quarter-end month (3/6/9/12). We
  // match ingested rows by quarter rather than exact month, since publishers
  // report on different cadences within a quarter (Scotland 1/4/7/10,
  // England's Patients-Registered extract on the 2nd month of a quarter).
  const out: Array<{ y: number; m: number }> = [];
  const now = new Date();
  if (cadence === "monthly") {
    for (let i = 1; i <= 36; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      out.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 });
    }
  } else {
    const curQ = Math.floor(now.getUTCMonth() / 3); // 0..3
    for (let i = 1; i <= 12; i++) {
      const qIdx = curQ - i;
      const yearShift = Math.floor(qIdx / 4);
      const qNorm = ((qIdx % 4) + 4) % 4;
      out.push({ y: now.getUTCFullYear() + yearShift, m: (qNorm + 1) * 3 });
    }
  }
  return out;
}

type SchemaAlertRow = {
  id: string;
  source: string;
  dataset: string | null;
  missing_field: string;
  tried_variants: string[];
  available_headers: string[];
  resource_url: string | null;
  created_at: string;
};

type FreshnessRow = {
  source: string;
  checked_at: string;
  upstream_latest_year: number | null;
  upstream_latest_month: number | null;
  ingested_latest_year: number | null;
  ingested_latest_month: number | null;
  new_data_found: boolean;
  items_queued: number;
  status: string;
  error: string | null;
};

function DataIngestionAdmin() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [backfilling, setBackfilling] = useState<Record<string, boolean>>({});
  const [backfillProgress, setBackfillProgress] = useState<Record<string, { done: number; remaining: number } | null>>({});
  const [loading, setLoading] = useState(true);
  const [recentEvents, setRecentEvents] = useState<LogRow[]>([]);
  const [freshness, setFreshness] = useState<FreshnessRow[]>([]);
  const [schemaAlerts, setSchemaAlerts] = useState<SchemaAlertRow[]>([]);
  const [checkingFreshness, setCheckingFreshness] = useState(false);
  const [backfillingOds, setBackfillingOds] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const sources = DATASETS.map((d) => d.source);
    const [{ data: lg }, { data: q }, { data: recent }, { data: fr }, { data: sa }] = await Promise.all([
      supabase
        .from("ingestion_log")
        .select("source,status,year,month,rows_ingested,error,created_at")
        .in("source", sources)
        .gte("created_at", new Date(Date.now() - 90 * 86400000).toISOString())
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase
        .from("ingestion_queue")
        .select("source,status,year,month")
        .in("source", sources)
        .limit(2000),
      supabase
        .from("ingestion_log")
        .select("source,status,year,month,rows_ingested,error,created_at")
        .in("source", sources)
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("ingestion_freshness_check")
        .select("source,checked_at,upstream_latest_year,upstream_latest_month,ingested_latest_year,ingested_latest_month,new_data_found,items_queued,status,error")
        .order("checked_at", { ascending: false })
        .limit(200),
      supabase
        .from("schema_alerts")
        .select("id,source,dataset,missing_field,tried_variants,available_headers,resource_url,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    setLogs((lg as LogRow[]) ?? []);
    setQueue((q as QueueRow[]) ?? []);
    setRecentEvents((recent as LogRow[]) ?? []);
    setFreshness((fr as FreshnessRow[]) ?? []);
    setSchemaAlerts((sa as SchemaAlertRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const triggerFreshness = async () => {
    setCheckingFreshness(true);
    toast.info("Running change-detection sweep…");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch(`/api/public/hooks/check-data-freshness`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(humanizeHookError(j, res.status));
      const newOnes = (j.results ?? []).filter((r: any) => r.new_data_found).length;
      toast.success(`Checked ${j.checked} sources · ${newOnes} with new data`);
      await refresh();
    } catch (e: any) {
      toast.error("Change-detection failed", {
        description: friendlyMessage(e),
        duration: 12000,
      });
    } finally {
      setCheckingFreshness(false);
    }
  };



  const statsBySource = useMemo(() => {
    const out: Record<string, Stats> = {};
    const cutoff30 = Date.now() - 30 * 86400000;
    for (const ds of DATASETS) {
      const mine = logs.filter((l) => l.source === ds.source);
      const successes = mine.filter((l) => l.status === "success");
      const failures = mine.filter((l) => l.status === "failed");
      // "Latest ingested period" must reflect the latest (year, month) actually
      // covered — not the most recently inserted row, which can be an older
      // backfill ingested last (e.g. Scotland list sizes inserted 2014-04 last).
      const latestByPeriod = [...successes]
        .filter((s) => s.year != null && s.month != null)
        .sort((a, b) => (b.year! * 12 + b.month!) - (a.year! * 12 + a.month!))[0]
        ?? successes[0]
        ?? null;
      const last30 = mine.filter((l) => new Date(l.created_at).getTime() >= cutoff30);
      const pending = queue.filter((qq) => qq.source === ds.source && (qq.status === "pending" || qq.status === "processing")).length;

      const exp = expectedPeriods(ds.cadence);
      const ingestedKey = new Set(
        successes
          .filter((s) => s.year != null && s.month != null)
          .map((s) => ds.cadence === "quarterly"
            ? `${s.year}-${quarterEndMonth(s.month!)}`
            : `${s.year}-${s.month}`),
      );
      const covered = exp.filter((p) => ingestedKey.has(`${p.y}-${p.m}`)).length;
      const coveragePct = Math.round((covered / exp.length) * 100);

      out[ds.source] = {
        latestSuccess: latestByPeriod,
        latestFailure: failures[0] ?? null,
        successes30d: last30.filter((l) => l.status === "success").length,
        failures30d: last30.filter((l) => l.status === "failed").length,
        totalRecords30d: last30.reduce((s, l) => s + (l.rows_ingested ?? 0), 0),
        pendingQueue: pending,
        coveragePct,
      };
    }
    return out;
  }, [logs, queue]);

  const portfolio = useMemo(() => {
    const totals = Object.values(statsBySource);
    const healthy = totals.filter((s) => s.latestSuccess && (!s.latestFailure || new Date(s.latestSuccess.created_at) >= new Date(s.latestFailure.created_at))).length;
    const failing = totals.length - healthy;
    const queued = totals.reduce((s, x) => s + x.pendingQueue, 0);
    const records30 = totals.reduce((s, x) => s + x.totalRecords30d, 0);
    return { total: totals.length, healthy, failing, queued, records30 };
  }, [statsBySource]);

  const runOdsBackfill = async () => {
    setBackfillingOds(true);
    toast.info("Running ODS name backfill — this may take a minute…");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch(`/api/public/hooks/ingest-ods-names`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(humanizeHookError(j, res.status));
      toast.success(`ODS backfill done: ${j.updated ?? 0} updated, ${j.found ?? 0} found with code-as-name`);
    } catch (e: any) {
      toast.error("ODS backfill failed", { description: friendlyMessage(e), duration: 12000 });
    } finally {
      setBackfillingOds(false);
    }
  };

  const backfillHook = async (ds: Dataset) => {
    if (ds.source === "NWSSP_WALES") {
      toast.error("Wales has no machine-readable upstream source available — backfill not possible until a scraper is built.");
      return;
    }
    setBackfilling((s) => ({ ...s, [ds.source]: true }));
    setBackfillProgress((s) => ({ ...s, [ds.source]: { done: 0, remaining: 0 } }));
    toast.info(`Backfilling ${ds.label} — this may take a few minutes…`);
    let done = 0;
    let consecutiveNoOps = 0;
    const MAX_CALLS = 60; // safety cap per click
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      for (let i = 0; i < MAX_CALLS; i++) {
        const res = await fetch(`/api/public/hooks/${ds.hook}`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const j: any = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(humanizeHookError(j, res.status));
        const processed = Number(j.processed ?? 0);
        const queued = Number(j.queued ?? 0);
        const pending = Number(j.pending ?? NaN);
        done += processed;
        const remaining = Number.isFinite(pending) ? pending : Math.max(0, queued - processed);
        setBackfillProgress((s) => ({ ...s, [ds.source]: { done, remaining } }));
        if (processed === 0 && queued === 0) {
          consecutiveNoOps++;
          if (consecutiveNoOps >= 2) break; // nothing left to do
        } else {
          consecutiveNoOps = 0;
        }
        if (Number.isFinite(pending) && pending === 0 && processed === 0) break;
      }
      toast.success(`${ds.label}: backfilled ${done} period${done === 1 ? "" : "s"}`);
      await refresh();
    } catch (e: any) {
      toast.error(`${ds.label} backfill failed`, { description: friendlyMessage(e), duration: 12000 });
    } finally {
      setBackfilling((s) => ({ ...s, [ds.source]: false }));
      setBackfillProgress((s) => ({ ...s, [ds.source]: null }));
    }
  };

  const triggerHook = async (ds: Dataset) => {
    setRunning((s) => ({ ...s, [ds.source]: true }));
    toast.info(`Triggering ${ds.label}…`);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch(`/api/public/hooks/${ds.hook}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(humanizeHookError(j, res.status));
      toast.success(`${ds.label}: queued ${j.queued ?? 0}, processed ${j.processed ?? 0}`);
      await refresh();
    } catch (e: any) {
      toast.error(`${ds.label} failed`, {
        description: friendlyMessage(e),
        duration: 12000,
      });
    } finally {
      setRunning((s) => ({ ...s, [ds.source]: false }));
    }
  };


  const groups: Group[] = ["Pharmacy dispensing", "GP prescribing", "GP linkage", "GP list sizes"];

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="h-6 w-6 text-gold" /> Data Ingestion
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            All NHS open datasets we ingest and keep up to date. Internal use — not visible to public users.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="default" size="sm" onClick={triggerFreshness} disabled={checkingFreshness}>
            {checkingFreshness ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />} Run change-detection
          </Button>
          <Button variant="outline" size="sm" onClick={runOdsBackfill} disabled={backfillingOds} title="Fix pharmacies whose name was stored as their ODS code">
            {backfillingOds ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />} Fix ODS names
          </Button>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </Button>
          <Link to="/admin/gp-data" className="text-xs underline text-muted-foreground hover:text-foreground">
            GP-data coverage grid
          </Link>
          <Link to="/admin/payments-import" className="text-xs underline text-muted-foreground hover:text-foreground">
            Manual payments import
          </Link>
        </div>
      </div>

      {/* Per-region coverage breakdown */}
      <RegionBreakdown statsBySource={statsBySource} />

      {/* Change-detection panel */}
      <FreshnessPanel freshness={freshness} />

      {/* Portfolio summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <PortStat label="Datasets" value={portfolio.total} />
        <PortStat label="Healthy" value={portfolio.healthy} tone="good" />
        <PortStat label="Failing / stale" value={portfolio.failing} tone={portfolio.failing > 0 ? "bad" : "neutral"} />
        <PortStat label="Queued items" value={portfolio.queued} />
        <PortStat label="Records (30d)" value={portfolio.records30.toLocaleString()} />
      </div>

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="all">All ({DATASETS.length})</TabsTrigger>
          {groups.map((g) => (
            <TabsTrigger key={g} value={g}>{g} ({DATASETS.filter((d) => d.group === g).length})</TabsTrigger>
          ))}
          <TabsTrigger value="activity">Recent activity</TabsTrigger>
          <TabsTrigger value="schema-alerts" className={schemaAlerts.length > 0 ? "text-rose-700" : ""}>
            Schema alerts{schemaAlerts.length > 0 ? ` (${schemaAlerts.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {DATASETS.map((ds) => (
              <DatasetCard
                key={ds.key}
                ds={ds}
                stats={statsBySource[ds.source] ?? emptyStats()}
                onRun={() => triggerHook(ds)}
                onBackfill={() => backfillHook(ds)}
                running={!!running[ds.source]}
                backfilling={!!backfilling[ds.source]}
                backfillProgress={backfillProgress[ds.source] ?? null}
              />
            ))}
          </div>
        </TabsContent>

        {groups.map((g) => (
          <TabsContent key={g} value={g} className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {DATASETS.filter((d) => d.group === g).map((ds) => (
                <DatasetCard
                  key={ds.key}
                  ds={ds}
                  stats={statsBySource[ds.source] ?? emptyStats()}
                  onRun={() => triggerHook(ds)}
                  onBackfill={() => backfillHook(ds)}
                  running={!!running[ds.source]}
                  backfilling={!!backfilling[ds.source]}
                  backfillProgress={backfillProgress[ds.source] ?? null}
                />
              ))}
            </div>
          </TabsContent>
        ))}

        <TabsContent value="schema-alerts" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">CSV field-mapping alerts</CardTitle>
              <CardDescription>
                Fields the ingest pipelines could not find in the source CSV — indicates the publisher changed their column layout.
                {schemaAlerts.length === 0 && " No alerts — all CSV fields mapping correctly."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Dataset</TableHead>
                    <TableHead>Missing field</TableHead>
                    <TableHead>Tried variants</TableHead>
                    <TableHead>URL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schemaAlerts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{a.source}</TableCell>
                      <TableCell className="text-xs">{a.dataset ?? "—"}</TableCell>
                      <TableCell className="text-xs font-mono text-rose-700">{a.missing_field}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[18rem] truncate">{a.tried_variants?.join(", ") ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {a.resource_url
                          ? <a href={a.resource_url} target="_blank" rel="noreferrer" className="underline text-muted-foreground hover:text-foreground truncate inline-block max-w-[14rem]">{a.resource_url.replace(/^https?:\/\//, "")}</a>
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {schemaAlerts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                        <CheckCircle2 className="inline h-4 w-4 mr-2 text-emerald-600" />
                        No schema alerts — all CSV fields mapping correctly.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent ingestion events</CardTitle>
              <CardDescription>Most recent 40 attempts across all datasets.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Dataset</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Records</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentEvents.map((e, i) => {
                    const ds = DATASETS.find((d) => d.source === e.source);
                    return (
                      <TableRow key={i}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(e.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs">{ds?.label ?? e.source}</TableCell>
                        <TableCell className="text-xs tabular-nums">{periodLabel(e.year, e.month)}</TableCell>
                        <TableCell><StatusBadge status={e.status} /></TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{e.rows_ingested?.toLocaleString() ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[24rem] truncate">{e.error ?? ""}</TableCell>
                      </TableRow>
                    );
                  })}
                  {recentEvents.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-6">No events recorded.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PortStat({ label, value, tone = "neutral" }: { label: string; value: string | number; tone?: "good" | "bad" | "neutral" }) {
  const cls = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-rose-700" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${cls}`}>{value}</p>
    </div>
  );
}

function emptyStats(): Stats {
  return {
    latestSuccess: null, latestFailure: null,
    successes30d: 0, failures30d: 0, totalRecords30d: 0,
    pendingQueue: 0, coveragePct: 0,
  };
}

function RegionBreakdown({ statsBySource }: { statsBySource: Record<string, Stats> }) {
  const regions: Array<Dataset["country"]> = ["England", "Scotland", "Northern Ireland", "Wales"];
  const byRegion = regions.map((region) => {
    const items = DATASETS.filter((d) => d.country === region);
    const stats = items.map((d) => statsBySource[d.source]).filter(Boolean) as Stats[];
    const healthy = stats.filter((s) => s.latestSuccess && (!s.latestFailure || new Date(s.latestSuccess.created_at) >= new Date(s.latestFailure.created_at))).length;
    const failing = stats.length - healthy;
    const queued = stats.reduce((s, x) => s + x.pendingQueue, 0);
    const coverageAvg = stats.length
      ? Math.round(stats.reduce((s, x) => s + x.coveragePct, 0) / stats.length)
      : 0;
    return { region, total: items.length, healthy, failing, queued, coverageAvg };
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Per-region coverage</CardTitle>
        <CardDescription>Quick read of where data gaps live across the UK.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {byRegion.map((r) => {
          const tone = r.failing > 0 ? "bad" : r.coverageAvg < 80 ? "neutral" : "good";
          const dot = tone === "good" ? "bg-emerald-500" : tone === "bad" ? "bg-rose-500" : "bg-amber-500";
          return (
            <div key={r.region} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{r.region}</p>
                <span className={`h-2 w-2 rounded-full ${dot}`} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><p className="text-muted-foreground">Pipelines</p><p className="font-semibold tabular-nums">{r.total}</p></div>
                <div><p className="text-muted-foreground">Healthy</p><p className="font-semibold tabular-nums text-emerald-700">{r.healthy}</p></div>
                <div><p className="text-muted-foreground">Failing</p><p className={`font-semibold tabular-nums ${r.failing > 0 ? "text-rose-700" : ""}`}>{r.failing}</p></div>
              </div>
              <div>
                <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                  <span>Avg coverage</span><span>{r.coverageAvg}%</span>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${r.coverageAvg}%` }} />
                </div>
              </div>
              {r.queued > 0 && (
                <p className="text-[11px] text-amber-700"><Clock className="inline h-3 w-3 mr-1" />{r.queued} items queued</p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function FreshnessPanel({ freshness }: { freshness: FreshnessRow[] }) {
  const latestBySource = new Map<string, FreshnessRow>();
  for (const r of freshness) if (!latestBySource.has(r.source)) latestBySource.set(r.source, r);
  const lastRunAny = freshness[0];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Radar className="h-4 w-4 text-gold" /> Change-detection</CardTitle>
        <CardDescription>
          {lastRunAny
            ? <>Last run {new Date(lastRunAny.checked_at).toLocaleString()} · runs every Monday and on demand.</>
            : <>No change-detection runs recorded yet — click "Run change-detection" above to start.</>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dataset</TableHead>
              <TableHead>Last checked</TableHead>
              <TableHead>Upstream latest</TableHead>
              <TableHead>Ingested latest</TableHead>
              <TableHead>New data?</TableHead>
              <TableHead className="text-right">Queued</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DATASETS.map((ds) => {
              const row = latestBySource.get(ds.source);
              const upstream = row ? periodLabel(row.upstream_latest_year, row.upstream_latest_month) : "—";
              const ingested = row ? periodLabel(row.ingested_latest_year, row.ingested_latest_month) : "—";
              const upScore = row && row.upstream_latest_year && row.upstream_latest_month ? row.upstream_latest_year * 12 + row.upstream_latest_month : 0;
              const inScore = row && row.ingested_latest_year && row.ingested_latest_month ? row.ingested_latest_year * 12 + row.ingested_latest_month : 0;
              const behind = upScore > inScore;
              return (
                <TableRow key={ds.source}>
                  <TableCell className="text-xs">{ds.label}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{row ? timeAgo(row.checked_at) : "—"}</TableCell>
                  <TableCell className="text-xs tabular-nums">{upstream}</TableCell>
                  <TableCell className={`text-xs tabular-nums ${behind ? "text-rose-700 font-semibold" : ""}`}>{ingested}</TableCell>
                  <TableCell className="text-xs">
                    {row?.new_data_found
                      ? <span className="inline-flex items-center gap-1 text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"><AlertTriangle className="h-3 w-3" /> Yes</span>
                      : row ? <span className="inline-flex items-center gap-1 text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"><CheckCircle2 className="h-3 w-3" /> Up to date</span> : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{row?.items_queued ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    {row?.status === "failed" || row?.status === "trigger_failed"
                      ? <span className="text-rose-700" title={row.error ?? ""}>{row.status}</span>
                      : row ? <span className="text-emerald-700">{row.status}</span> : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

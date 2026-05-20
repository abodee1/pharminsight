import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/data")({
  component: AdminDataPage,
});

type LogRow = {
  source: string;
  dataset: string;
  year: number | null;
  month: number | null;
  status: string;
  rows_ingested: number;
  created_at: string;
};

type SourceMeta = {
  key: string;
  label: string;
  regionLabel: string;
  expectedMonths: number; // since 2018-01
};

const SOURCES: SourceMeta[] = [
  { key: "NHSBSA", label: "England (NHSBSA)", regionLabel: "ICB", expectedMonths: 90 },
  { key: "PHS_SCOTLAND", label: "Scotland (PHS)", regionLabel: "Health Board", expectedMonths: 90 },
];

function AdminDataPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("ingestion_log")
      .select("source, dataset, year, month, status, rows_ingested, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) toast.error(error.message);
    setLogs((data as LogRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const byKey: Record<string, { months: Set<string>; rows: number; latest?: string; failures: number }> = {};
    for (const s of SOURCES) byKey[s.key] = { months: new Set(), rows: 0, failures: 0 };
    for (const r of logs) {
      const k = byKey[r.source];
      if (!k) continue;
      if (r.status === "success") {
        if (r.year && r.month) k.months.add(`${r.year}-${r.month}`);
        k.rows += r.rows_ingested ?? 0;
        if (!k.latest || r.created_at > k.latest) k.latest = r.created_at;
      } else {
        k.failures += 1;
      }
    }
    return byKey;
  }, [logs]);

  const trigger = async (source: string, opts?: { reingest?: boolean }) => {
    const key = source + (opts?.reingest ? ":reingest" : "");
    setTriggering(key);
    try {
      const basePath =
        source === "PHS_SCOTLAND"
          ? "/api/public/hooks/ingest-scotland"
          : null;
      if (!basePath) {
        toast.info("Ingest endpoint not wired for this source yet.");
        return;
      }
      const path = opts?.reingest ? `${basePath}?reingest=1` : basePath;
      const res = await fetch(path, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success(
        opts?.reingest
          ? `Re-ingest started — reset ${json.reset ?? 0}, queued ${json.queued ?? 0}, processed ${json.processed ?? 0}`
          : `Queued ${json.queued ?? 0}, processed ${json.processed ?? 0}, pending ${json.pending ?? 0}`,
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTriggering(null);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <PageHeader
        title="Data Coverage"
        subtitle="Ingestion status across all data sources."
        backTo="/settings"
        backLabel="My Account"
      />

      <div className="grid gap-4 md:grid-cols-2">
        {SOURCES.map((s) => {
          const st = stats[s.key];
          const monthsCovered = st?.months.size ?? 0;
          const pct = Math.min(100, Math.round((monthsCovered / s.expectedMonths) * 100));
          return (
            <Card key={s.key}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{s.label}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Region label: <span className="font-medium">{s.regionLabel}</span>
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 items-end">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!triggering}
                    onClick={() => trigger(s.key)}
                  >
                    {triggering === s.key ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1.5">Ingest now</span>
                  </Button>
                  {s.key === "PHS_SCOTLAND" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!!triggering}
                      onClick={() => trigger(s.key, { reingest: true })}
                      title="Wipe Scotland ingest logs and re-process every CSV"
                    >
                      {triggering === "PHS_SCOTLAND:reingest" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      <span className="ml-1.5">Re-ingest Scotland</span>
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">

                    <span>{monthsCovered} of ~{s.expectedMonths} months</span>
                    <span>{pct}%</span>
                  </div>
                  <Progress value={pct} />
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">{st?.rows.toLocaleString() ?? 0} rows</Badge>
                  {st?.failures ? (
                    <Badge variant="destructive">{st.failures} failed</Badge>
                  ) : null}
                  {st?.latest ? (
                    <Badge variant="outline">
                      Last run {new Date(st.latest).toLocaleDateString()}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Never run</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent ingestion log</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ingestion runs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-2 pr-4">Source</th>
                    <th className="text-left py-2 pr-4">Dataset</th>
                    <th className="text-left py-2 pr-4">Period</th>
                    <th className="text-left py-2 pr-4">Status</th>
                    <th className="text-right py-2 pr-4">Rows</th>
                    <th className="text-left py-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-2 pr-4 font-medium">{r.source}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.dataset}</td>
                      <td className="py-2 pr-4">
                        {r.year ?? "—"}{r.month ? `-${String(r.month).padStart(2, "0")}` : ""}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={r.status === "success" ? "secondary" : "destructive"}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {r.rows_ingested?.toLocaleString() ?? 0}
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

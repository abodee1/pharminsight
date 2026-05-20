import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Upload, FileText, CheckCircle2, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/payments-import")({
  component: PaymentsImport,
});

const REQUIRED = ["ods_code", "year", "month"] as const;
const NUMERIC = [
  "pharmacy_first_payment", "mcr_payment", "ehc_items", "methadone_items",
  "smoking_cessation", "final_payment", "items_dispensed", "eps_items",
  "eps_nominations", "nms_count", "pharmacy_first_count", "flu_vaccinations",
  "gross_cost",
] as const;

type Row = Record<string, string | number>;

function parseCsv(text: string): { headers: string[]; rows: Row[] } {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const split = (line: string) => {
    const out: string[] = [];
    let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { q = !q; continue; }
      if (c === "," && !q) { out.push(cur); cur = ""; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = split(lines[0]).map((h) => h.toLowerCase());
  const rows: Row[] = lines.slice(1).map((line) => {
    const vals = split(line);
    const row: Row = {};
    headers.forEach((h, i) => {
      const raw = vals[i] ?? "";
      if (NUMERIC.includes(h as any)) {
        const cleaned = raw.replace(/[£,]/g, "").trim();
        row[h] = cleaned === "" ? 0 : Number(cleaned);
      } else {
        row[h] = raw;
      }
    });
    return row;
  });
  return { headers, rows };
}

function PaymentsImport() {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [source, setSource] = useState("manual-csv");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ inserted: number; unknown: string[] } | null>(null);

  const onFile = async (f: File) => {
    setFileName(f.name);
    setResult(null);
    const text = await f.text();
    const parsed = parseCsv(text);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
  };

  const missing = REQUIRED.filter((r) => !headers.includes(r));
  const invalidRows = rows.filter((r) =>
    !r.ods_code || !Number.isFinite(Number(r.year)) || !Number.isFinite(Number(r.month))
  );

  const submit = async () => {
    if (missing.length > 0) return toast.error(`Missing required columns: ${missing.join(", ")}`);
    setBusy(true);
    setResult(null);
    try {
      const anon = (import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const payload = {
        data_source: source,
        rows: rows
          .filter((r) => r.ods_code && Number.isFinite(Number(r.year)) && Number.isFinite(Number(r.month)))
          .map((r) => {
            const out: any = {
              ods_code: String(r.ods_code).trim().toUpperCase(),
              year: Number(r.year),
              month: Number(r.month),
            };
            for (const k of NUMERIC) if (k in r) out[k] = Number(r[k]) || 0;
            return out;
          }),
      };
      // Send in batches of 1000 to stay under endpoint limit
      let inserted = 0; const unknown = new Set<string>();
      for (let i = 0; i < payload.rows.length; i += 1000) {
        const batch = { ...payload, rows: payload.rows.slice(i, i + 1000) };
        const res = await fetch("/api/public/ingest/pharmacy-payments", {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: anon },
          body: JSON.stringify(batch),
        });
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        inserted += json.inserted || 0;
        (json.unknown || []).forEach((u: string) => unknown.add(u));
      }
      setResult({ inserted, unknown: Array.from(unknown) });
      toast.success(`Imported ${inserted} rows`);
    } catch (e: any) {
      toast.error(e.message || "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Payments CSV Import</h1>
      <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
        Upload a CSV to populate per-pharmacy monthly payment data (Pharmacy First £, MCR £, EHC items, methadone, smoking cessation, final payment, etc.).
      </p>

      <div className="mt-6 rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold mb-3">Required columns</h2>
        <div className="text-xs text-muted-foreground">
          <p><span className="font-mono text-foreground">ods_code</span>, <span className="font-mono text-foreground">year</span>, <span className="font-mono text-foreground">month</span> are required.</p>
          <p className="mt-2">Optional (any subset): {NUMERIC.map((k) => <span key={k} className="font-mono bg-secondary/60 px-1 rounded mr-1">{k}</span>)}</p>
          <p className="mt-2">Currency cells may include <code>£</code> and thousands separators — they are stripped automatically.</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 rounded-lg border-2 border-dashed border-border bg-card p-6 text-center">
          <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">Choose a CSV file</p>
          <Input
            type="file" accept=".csv,text/csv" className="mt-3"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          {fileName && (
            <p className="mt-3 text-xs text-muted-foreground inline-flex items-center gap-1">
              <FileText className="h-3 w-3" /> {fileName} · {rows.length.toLocaleString()} rows · {headers.length} columns
            </p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data source label</label>
          <Input className="mt-2" value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. NSS-2025-10" />
          <p className="text-[11px] text-muted-foreground mt-2">Stored alongside each row for audit.</p>
        </div>
      </div>

      {rows.length > 0 && (
        <>
          {missing.length > 0 && (
            <div className="mt-4 rounded-md bg-red-500/10 border border-red-500/30 p-3 text-sm flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div>Missing required columns: <span className="font-mono">{missing.join(", ")}</span></div>
            </div>
          )}
          {invalidRows.length > 0 && (
            <p className="mt-3 text-xs text-amber-600">
              {invalidRows.length.toLocaleString()} row(s) will be skipped (missing ods_code/year/month).
            </p>
          )}

          <div className="mt-6 rounded-lg bg-card border border-border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold">Preview — first 10 rows</h2>
              <span className="text-xs text-muted-foreground">{rows.length.toLocaleString()} total</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-secondary/40 uppercase text-muted-foreground">
                  <tr>{headers.map((h) => <th key={h} className="text-left px-2 py-2 font-medium whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 10).map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      {headers.map((h) => <td key={h} className="px-2 py-1.5 whitespace-nowrap tabular-nums">{String(r[h] ?? "")}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <Button onClick={submit} disabled={busy || missing.length > 0}>
              {busy ? "Importing…" : `Import ${rows.length - invalidRows.length} rows`}
            </Button>
            <p className="text-xs text-muted-foreground">
              Existing rows for the same pharmacy/year/month will be overwritten.
            </p>
          </div>
        </>
      )}

      {result && (
        <div className="mt-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
          <p className="font-semibold inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Imported {result.inserted.toLocaleString()} rows
          </p>
          {result.unknown.length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer">{result.unknown.length} unknown ODS codes skipped</summary>
              <p className="mt-1 font-mono break-all">{result.unknown.join(", ")}</p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

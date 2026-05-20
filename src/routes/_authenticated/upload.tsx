import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/upload")({ component: UploadPage });

const TYPES = [
  { key: "glp1", title: "GLP-1 / Weight Management" },
  { key: "aesthetics", title: "Medical Aesthetics" },
  { key: "general", title: "General Private Dispensing" },
] as const;

type T = typeof TYPES[number]["key"];

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((s) => s.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (cells[i] || "").trim(); });
    return row;
  });
}

function UploadPage() {
  const { user } = useAuth();
  const [type, setType] = useState<T>("glp1");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [saving, setSaving] = useState(false);

  const handleFile = async (f: File) => {
    setFileName(f.name);
    const text = await f.text();
    setRows(parseCSV(text));
  };

  const save = async () => {
    if (!user || !rows.length) return;
    setSaving(true);
    const { error } = await supabase.from("private_uploads").insert({
      user_id: user.id,
      upload_type: type,
      file_name: fileName,
      parsed_data: { rows },
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Upload saved privately to your account");
    setRows([]); setFileName("");
  };

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <PageHeader
        title="Upload Private Practice Data"
        subtitle="Upload your private dispensing, GLP-1 prescribing, or aesthetics revenue data. This data is private to your account and never shared."
      />

      <div className="grid md:grid-cols-3 gap-3 mb-6">
        {TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => setType(t.key)}
            className={[
              "rounded-lg border p-4 text-left shadow-sm transition-colors",
              type === t.key ? "border-gold bg-gold/10" : "border-border bg-card hover:border-gold/50",
            ].join(" ")}
          >
            <p className="font-semibold text-sm">{t.title}</p>
          </button>
        ))}
      </div>

      <label className="block rounded-lg border-2 border-dashed border-border bg-card p-10 text-center cursor-pointer hover:border-gold transition-colors">
        <input
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <p className="font-medium text-sm">Drop a CSV here or click to choose</p>
        <p className="text-xs text-muted-foreground mt-1">
          CSV format: header row followed by data rows.
        </p>
        {fileName && <p className="mt-3 text-xs text-foreground">{fileName} · {rows.length} rows</p>}
      </label>

      {rows.length > 0 && (
        <div className="mt-6 rounded-lg bg-card border border-border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex justify-between items-center">
            <h2 className="text-sm font-semibold">Preview (first 10 rows)</h2>
            <button
              disabled={saving}
              onClick={save}
              className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Confirm & save"}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-secondary text-muted-foreground">
                <tr>
                  {Object.keys(rows[0]).map((h) => (
                    <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    {Object.values(r).map((v, j) => <td key={j} className="px-3 py-2">{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

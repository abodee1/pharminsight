import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { toast } from "sonner";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/upload")({ component: UploadPage });

const TYPES = [
  {
    key: "glp1",
    title: "GLP-1 / Weight Management",
    desc: "Private weight-loss prescribing — Mounjaro, Wegovy, Ozempic.",
    template:
      "date,patient_reference,product,dose_mg,quantity,revenue_gbp\n2026-04-02,P0001,Mounjaro,5,1,210\n2026-04-05,P0002,Wegovy,1.7,1,199\n2026-04-12,P0003,Mounjaro,7.5,1,260\n",
    filename: "pharmiq-glp1-template.csv",
  },
  {
    key: "aesthetics",
    title: "Medical Aesthetics",
    desc: "Botulinum toxin, dermal fillers, and POM-cosmetic services.",
    template:
      "date,patient_reference,treatment,product,units_or_ml,revenue_gbp\n2026-04-03,A0001,Toxin,Azzalure,50,250\n2026-04-08,A0002,Filler,Juvederm Volift,1,320\n2026-04-15,A0003,Toxin,Bocouture,40,220\n",
    filename: "pharmiq-aesthetics-template.csv",
  },
  {
    key: "general",
    title: "General Private Dispensing",
    desc: "Private prescriptions outside NHS contract.",
    template:
      "date,patient_reference,drug,quantity,revenue_gbp\n2026-04-01,G0001,Sildenafil 50mg,8,28\n2026-04-04,G0002,Finasteride 1mg,28,18\n2026-04-09,G0003,Melatonin 3mg,30,24\n",
    filename: "pharmiq-general-template.csv",
  },
] as const;

type T = (typeof TYPES)[number]["key"];

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((s) => s.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] || "").trim();
    });
    return row;
  });
}

function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
    setRows([]);
    setFileName("");
  };

  const active = TYPES.find((t) => t.key === type)!;

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
              type === t.key
                ? "border-foreground bg-secondary"
                : "border-border bg-card hover:border-foreground/50",
            ].join(" ")}
          >
            <p className="font-semibold text-sm">{t.title}</p>
            <p className="text-xs text-muted-foreground mt-1">{t.desc}</p>
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between rounded-lg bg-secondary border border-border px-4 py-3">
        <div>
          <p className="text-sm font-medium">Need a starting template?</p>
          <p className="text-xs text-muted-foreground">
            Download the CSV template for{" "}
            <span className="font-medium text-foreground">{active.title}</span>, fill it
            in, then upload below.
          </p>
        </div>
        <button
          onClick={() => downloadCSV(active.filename, active.template)}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold hover:bg-background"
        >
          <Download className="h-4 w-4" />
          Download template
        </button>
      </div>

      <label className="block rounded-lg border-2 border-dashed border-border bg-card p-10 text-center cursor-pointer hover:border-foreground/50 transition-colors">
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
        {fileName && (
          <p className="mt-3 text-xs text-foreground">
            {fileName} · {rows.length} rows
          </p>
        )}
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
                    <th key={h} className="text-left px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    {Object.values(r).map((v, j) => (
                      <td key={j} className="px-3 py-2">
                        {v}
                      </td>
                    ))}
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

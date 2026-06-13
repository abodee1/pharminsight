// Shared streaming CSV + queue helpers for GP ingestion routes.
// Server-only.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function streamCsv(url: string, onRow: (cells: string[]) => void) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch ${res.status} ${url}`);
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const dec = new TextDecoder("utf-8");
  let row: string[] = [];
  let cell = "";
  let q = false;
  const flush = () => { row.push(cell); onRow(row); row = []; cell = ""; };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const t = dec.decode(value, { stream: true });
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) {
        if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else {
        if (ch === '"') q = true;
        else if (ch === ",") { row.push(cell); cell = ""; }
        else if (ch === "\n") flush();
        else if (ch !== "\r") cell += ch;
      }
    }
  }
  if (cell.length || row.length) flush();
}

export function buildHeaderIndex(headers: string[]) {
  const idx: Record<string, number> = {};
  headers.forEach((h, i) => { idx[h.trim().toLowerCase().replace(/[\s_]/g, "")] = i; });
  return {
    find(...variants: string[]): number {
      for (const v of variants) {
        const k = v.toLowerCase().replace(/[\s_]/g, "");
        if (idx[k] !== undefined) return idx[k];
      }
      return -1;
    },
  };
}

export const num = (v: string | undefined) =>
  v ? Number(String(v).replace(/[£,"]/g, "").trim()) || 0 : 0;

export async function alreadyHandled(source: string): Promise<Set<string>> {
  const skip = new Set<string>();
  const { data: logs } = await supabaseAdmin
    .from("ingestion_log").select("resource_url")
    .eq("source", source).eq("status", "success");
  for (const r of logs ?? []) skip.add(r.resource_url);
  const { data: queued } = await supabaseAdmin
    .from("ingestion_queue").select("resource_url, status")
    .eq("source", source);
  for (const r of queued ?? []) if (["pending", "processing", "done"].includes(r.status)) skip.add(r.resource_url);
  return skip;
}

export async function enqueue(rows: Array<{
  source: string; dataset: string; resource_url: string;
  year: number | null; month: number | null;
}>) {
  let queued = 0;
  for (let i = 0; i < rows.length; i += 200) {
    // Reset `attempts` so previously-failed items get a fresh retry budget.
    const chunk = rows.slice(i, i + 200).map((r) => ({ ...r, status: "pending", error: null, attempts: 0 }));
    const { error } = await supabaseAdmin
      .from("ingestion_queue")
      .upsert(chunk, { onConflict: "source,dataset,resource_url" });
    if (!error) queued += chunk.length;
  }
  return queued;
}

export async function takeNextPending(source: string) {
  const { data } = await supabaseAdmin
    .from("ingestion_queue")
    .select("id, dataset, resource_url, year, month")
    .eq("source", source).eq("status", "pending")
    .order("year", { ascending: false, nullsFirst: false })
    .order("month", { ascending: false, nullsFirst: false })
    .limit(1);
  return data?.[0] ?? null;
}

export async function markProcessing(id: string) {
  await supabaseAdmin.from("ingestion_queue")
    .update({ status: "processing", started_at: new Date().toISOString() }).eq("id", id);
}

export async function markSuccess(args: {
  id: string; source: string; dataset: string; resource_url: string;
  year: number | null; month: number | null; rows: number;
}) {
  await supabaseAdmin.from("ingestion_log").insert({
    source: args.source, dataset: args.dataset, resource_url: args.resource_url,
    year: args.year, month: args.month, status: "success", rows_ingested: args.rows,
  });
  await supabaseAdmin.from("ingestion_queue")
    .update({ status: "done", finished_at: new Date().toISOString() }).eq("id", args.id);
}

export async function markFailed(args: {
  id: string; source: string; dataset: string; resource_url: string;
  year: number | null; month: number | null; error: string;
}) {
  await supabaseAdmin.from("ingestion_log").insert({
    source: args.source, dataset: args.dataset, resource_url: args.resource_url,
    year: args.year, month: args.month, status: "failed", error: args.error,
  });
  await supabaseAdmin.from("ingestion_queue")
    .update({ status: "failed", error: args.error, finished_at: new Date().toISOString() }).eq("id", args.id);
}

export type CkanResource = {
  id: string; name: string; url: string; format: string;
  created?: string; last_modified?: string;
};

export async function ckanResources(base: string, packageId: string): Promise<CkanResource[]> {
  const res = await fetch(`${base}/package_show?id=${packageId}`);
  if (!res.ok) throw new Error(`CKAN ${packageId}: ${res.status}`);
  const j = (await res.json()) as { result?: { resources?: CkanResource[] } };
  return j.result?.resources ?? [];
}

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export function parseYearMonth(url: string, name: string): { year: number | null; month: number | null } {
  const m1 = (name + " " + url).match(/(?<![0-9])(20\d{2})(0[1-9]|1[0-2])(?![0-9])/);
  if (m1) {
    return { year: +m1[1], month: +m1[2] };
  }
  const m2 = name.match(/([A-Za-z]+)\s+(\d{4})/);
  if (m2) {
    const mn = m2[1].toLowerCase();
    const month = MONTH_NAMES[mn] ?? Object.entries(MONTH_NAMES).find(([k]) => k.startsWith(mn))?.[1];
    if (month) return { year: +m2[2], month };
  }
  const m3 = name.match(/(20\d{2})/);
  if (m3) return { year: +m3[1], month: null };
  return { year: null, month: null };
}

export function parseQuarter(url: string, name: string): { year: number | null; month: number | null } {
  const s = `${name} ${url}`;
  // Q1 2024 or 2024Q1
  const m = s.match(/(?:Q([1-4])[^0-9]?(\d{4}))|(?:(\d{4})[^0-9]?Q([1-4]))/i);
  if (m) {
    const q = +(m[1] ?? m[4]);
    const y = +(m[2] ?? m[3]);
    return { year: y, month: [1, 4, 7, 10][q - 1] };
  }
  return parseYearMonth(url, name);
}

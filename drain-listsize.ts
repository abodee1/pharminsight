// Retry NHS_SCOT_LISTSIZE with intra-batch dedup.
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function streamCsv(url: string, onRow: (cells: string[]) => void) {
  const res = await fetch(url, { redirect: "follow" }); if (!res.ok) throw new Error(`${res.status}`);
  const reader = res.body!.getReader(); const dec = new TextDecoder();
  let row: string[] = []; let cell = ""; let q = false;
  const flush = () => { row.push(cell); onRow(row); row = []; cell = ""; };
  while (true) { const { done, value } = await reader.read(); if (done) break;
    const t = dec.decode(value, { stream: true });
    for (let i = 0; i < t.length; i++) { const ch = t[i];
      if (q) { if (ch === '"') { if (t[i+1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else { if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; } else if (ch === "\n") flush(); else if (ch !== "\r") cell += ch; }
    }
  }
  if (cell.length || row.length) flush();
}
const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_]/g, "");
const findIdx = (headers: string[], variants: string[]) => { const m = new Map(headers.map((h,i)=>[norm(h),i])); for (const v of variants) { const i = m.get(norm(v)); if (i !== undefined) return i; } return -1; };

// Reset failed list-size items
await sb.from("ingestion_queue").update({ status: "pending", error: null, started_at: null, finished_at: null }).eq("source", "NHS_SCOT_LISTSIZE").eq("status", "failed");

while (true) {
  const { data } = await sb.from("ingestion_queue").select("id, dataset, resource_url, year, month").eq("source", "NHS_SCOT_LISTSIZE").eq("status", "pending").limit(1);
  const item = data?.[0]; if (!item) break;
  await sb.from("ingestion_queue").update({ status: "processing", started_at: new Date().toISOString() }).eq("id", item.id);
  try {
    const map = new Map<string, { practice_code: string; list_size_date: string; registered_patients: number; country: string; data_source: string }>();
    let codeIdx = -1, totIdx = -1, dateIdx = -1, qIdx = -1, yIdx = -1; let rowNo = 0;
    await streamCsv(item.resource_url, (cells) => {
      if (rowNo++ === 0) {
        codeIdx = findIdx(cells, ["PracticeCode","GPPracticeCode","GPPractice"]);
        totIdx = findIdx(cells, ["TotalNumberOfPatients","NumberOfPatients","Total","AllAges","PatientCount","TotalPatients"]);
        dateIdx = findIdx(cells, ["Date"]); qIdx = findIdx(cells, ["Quarter"]); yIdx = findIdx(cells, ["Year"]);
        return;
      }
      if (codeIdx < 0 || totIdx < 0) return;
      const code = (cells[codeIdx] ?? "").trim(); if (!code) return;
      const tot = Number((cells[totIdx] ?? "0").replace(/,/g, "")) || 0; if (!tot) return;
      let date: string | null = null;
      if (dateIdx >= 0) { const s = (cells[dateIdx] ?? "").trim(); if (/^\d{8}$/.test(s)) date = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`; else if (/^\d{4}-\d{2}-\d{2}/.test(s)) date = s.slice(0,10); }
      if (!date && yIdx >= 0 && qIdx >= 0) { const y = +cells[yIdx]; const q = +cells[qIdx]; if (y && q) { const m = [3,6,9,12][q-1]; date = `${y}-${String(m).padStart(2,"0")}-01`; } }
      if (!date && item.year && item.month) date = `${item.year}-${String(item.month).padStart(2,"0")}-01`;
      if (!date) return;
      const key = `${code}|${date}`;
      const prev = map.get(key);
      if (!prev || tot > prev.registered_patients) map.set(key, { practice_code: code, list_size_date: date, registered_patients: tot, country: "Scotland", data_source: "NHS_SCOT_LISTSIZE" });
    });
    if (codeIdx < 0 || totIdx < 0) throw new Error("Missing columns");
    const rows = Array.from(map.values());
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from("gp_list_sizes").upsert(rows.slice(i, i+500), { onConflict: "practice_code,list_size_date" });
      if (error) throw error;
    }
    await sb.from("ingestion_log").insert({ source: "NHS_SCOT_LISTSIZE", dataset: item.dataset, resource_url: item.resource_url, year: item.year, month: item.month, status: "success", rows_ingested: rows.length });
    await sb.from("ingestion_queue").update({ status: "done", finished_at: new Date().toISOString() }).eq("id", item.id);
    console.log(`OK ${item.year}/${item.month ?? "-"}: ${rows.length} rows`);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await sb.from("ingestion_queue").update({ status: "failed", error: msg, finished_at: new Date().toISOString() }).eq("id", item.id);
    console.log(`FAIL ${item.year}/${item.month ?? "-"}: ${msg}`);
  }
}
console.log("LISTSIZE DONE");

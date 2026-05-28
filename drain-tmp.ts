// Drain GP ingestion queues directly via Supabase service role.
import { createClient } from "@supabase/supabase-js";
import { unzipSync, strFromU8 } from "fflate";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------- CSV stream ----------
async function streamCsv(url: string, onRow: (cells: string[]) => void) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch ${res.status} ${url}`);
  if (!res.body) throw new Error("No body");
  const reader = res.body.getReader();
  const dec = new TextDecoder("utf-8");
  let row: string[] = []; let cell = ""; let q = false;
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
function buildHeaderIndex(headers: string[]) {
  const idx: Record<string, number> = {};
  headers.forEach((h, i) => { idx[h.trim().toLowerCase().replace(/[\s_]/g, "")] = i; });
  return { find: (...v: string[]) => { for (const x of v) { const k = x.toLowerCase().replace(/[\s_]/g, ""); if (idx[k] !== undefined) return idx[k]; } return -1; } };
}
const num = (v: string | undefined) => v ? Number(String(v).replace(/[£,"]/g, "").trim()) || 0 : 0;

// ---------- markers ----------
async function markProcessing(id: string) {
  await sb.from("ingestion_queue").update({ status: "processing", started_at: new Date().toISOString() }).eq("id", id);
}
async function markDone(item: any, rows: number) {
  await sb.from("ingestion_log").insert({ source: item.source, dataset: item.dataset, resource_url: item.resource_url, year: item.year, month: item.month, status: "success", rows_ingested: rows });
  await sb.from("ingestion_queue").update({ status: "done", finished_at: new Date().toISOString() }).eq("id", item.id);
}
async function markFailed(item: any, error: string) {
  await sb.from("ingestion_log").insert({ source: item.source, dataset: item.dataset, resource_url: item.resource_url, year: item.year, month: item.month, status: "failed", error });
  await sb.from("ingestion_queue").update({ status: "failed", error, finished_at: new Date().toISOString() }).eq("id", item.id);
}

// ---------- processors ----------
async function processScotlandPrescriber(item: any) {
  type Agg = { practice_code: string; practice_name: string; health_board: string | null; year: number; month: number; items: number; nic: number };
  const agg = new Map<string, Agg>();
  let codeIdx = -1, nameIdx = -1, hbIdx = -1, itemsIdx = -1, nicIdx = -1, pdmIdx = -1; let rowNo = 0;
  await streamCsv(item.resource_url, (cells) => {
    if (rowNo++ === 0) {
      const h = buildHeaderIndex(cells);
      codeIdx = h.find("GPPracticeCode", "PracticeCode", "GPPractice", "PrescriberLocation");
      nameIdx = h.find("GPPracticeName", "PracticeName");
      hbIdx = h.find("HBName", "HBT", "HB");
      itemsIdx = h.find("NumberOfPaidItems", "NumberOfItems", "PaidQuantity");
      nicIdx = h.find("GrossIngredientCost", "GIC");
      pdmIdx = h.find("PaidDateMonth");
      return;
    }
    if (codeIdx < 0) return;
    const code = (cells[codeIdx] ?? "").trim(); if (!code) return;
    let year = item.year ?? 0, month = item.month ?? 0;
    if (pdmIdx >= 0) { const s = (cells[pdmIdx] ?? "").trim(); if (/^\d{6}$/.test(s)) { year = +s.slice(0,4); month = +s.slice(4,6); } }
    if (!year || !month) return;
    const key = `${code}|${year}|${month}`;
    let c = agg.get(key);
    if (!c) { c = { practice_code: code, practice_name: nameIdx >= 0 ? (cells[nameIdx] ?? "").trim() : code, health_board: hbIdx >= 0 ? (cells[hbIdx] ?? "").trim() || null : null, year, month, items: 0, nic: 0 }; agg.set(key, c); }
    if (itemsIdx >= 0) c.items += num(cells[itemsIdx]);
    if (nicIdx >= 0) c.nic += num(cells[nicIdx]);
  });
  if (codeIdx < 0) throw new Error("No practice code column");
  if (rowNo <= 1) throw new Error("Empty CSV");
  const practices = Array.from(new Set(Array.from(agg.values()).map(a => a.practice_code))).map(code => {
    const a = Array.from(agg.values()).find(x => x.practice_code === code)!;
    return { practice_code: code, practice_name: a.practice_name, health_board: a.health_board, country: "Scotland" };
  });
  for (let i = 0; i < practices.length; i += 500) {
    await sb.from("gp_practices").upsert(practices.slice(i, i+500), { onConflict: "practice_code" });
  }
  const rows = Array.from(agg.values()).map(a => ({ practice_code: a.practice_code, year: a.year, month: a.month, country: "Scotland", total_items: Math.round(a.items), total_nic: a.nic, is_provisional: false, data_source: "NHS_SCOT_GP" }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.rpc("gp_prescribing_add", { rows: rows.slice(i, i+500) as any });
    if (error) throw error;
  }
  return rows.length;
}

async function processScotlandDispenser(item: any) {
  type Agg = { ods: string; name: string; hb: string | null; year: number; month: number; items: number; gross: number };
  const agg = new Map<string, Agg>();
  let odsIdx = -1, nameIdx = -1, hbIdx = -1, itemsIdx = -1, gicIdx = -1, pdmIdx = -1; let rowNo = 0;
  await streamCsv(item.resource_url, (cells) => {
    if (rowNo++ === 0) {
      const h = buildHeaderIndex(cells);
      odsIdx = h.find("DispensLocationCode", "DispenserLocationCode", "DispenserLocation", "DispLocationCode");
      nameIdx = h.find("DispensLocationName", "DispenserLocationName");
      hbIdx = h.find("HBName", "HBT", "HB");
      itemsIdx = h.find("NumberOfPaidItems", "NumberOfItems");
      gicIdx = h.find("GrossIngredientCost", "GIC");
      pdmIdx = h.find("PaidDateMonth");
      return;
    }
    if (odsIdx < 0) return;
    const ods = (cells[odsIdx] ?? "").trim(); if (!ods) return;
    let year = item.year ?? 0, month = item.month ?? 0;
    if (pdmIdx >= 0) { const s = (cells[pdmIdx] ?? "").trim(); if (/^\d{6}$/.test(s)) { year = +s.slice(0,4); month = +s.slice(4,6); } }
    if (!year || !month) return;
    const key = `${ods}|${year}|${month}`;
    let c = agg.get(key);
    if (!c) { c = { ods, name: nameIdx >= 0 ? (cells[nameIdx] ?? "").trim() : ods, hb: hbIdx >= 0 ? (cells[hbIdx] ?? "").trim() || null : null, year, month, items: 0, gross: 0 }; agg.set(key, c); }
    if (itemsIdx >= 0) c.items += num(cells[itemsIdx]);
    if (gicIdx >= 0) c.gross += num(cells[gicIdx]);
  });
  if (odsIdx < 0) throw new Error("No dispenser code column");
  if (rowNo <= 1) throw new Error("Empty CSV");
  const rows = Array.from(agg.values()).map(a => ({ pharmacy_ods_code: a.ods, pharmacy_name: a.name, health_board: a.hb, year: a.year, month: a.month, items_dispensed: Math.round(a.items), gross_cost: a.gross, data_source: "NHS_SCOT_GP" }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("gp_dispensing_by_pharmacy").upsert(rows.slice(i, i+500), { onConflict: "pharmacy_ods_code,year,month" });
    if (error) throw error;
  }
  return rows.length;
}

async function processScotlandLinkage(item: any) {
  type Agg = { practice: string; ods: string; year: number; month: number; items: number };
  const agg = new Map<string, Agg>();
  let practiceIdx = -1, pharmIdx = -1, itemsIdx = -1, pdmIdx = -1; let rowNo = 0;
  await streamCsv(item.resource_url, (cells) => {
    if (rowNo++ === 0) {
      const h = buildHeaderIndex(cells);
      practiceIdx = h.find("PracticeCode", "GPPracticeCode", "PrescriberLocation", "GPPractice");
      pharmIdx = h.find("DispensLocationCode", "DispenserLocationCode", "DispenserLocation", "DispLocationCode");
      itemsIdx = h.find("NumberOfItems", "NumberOfPaidItems");
      pdmIdx = h.find("PaidDateMonth");
      return;
    }
    if (practiceIdx < 0 || pharmIdx < 0) return;
    const practice = (cells[practiceIdx] ?? "").trim(); const ods = (cells[pharmIdx] ?? "").trim();
    if (!practice || !ods) return;
    let year = item.year ?? 0, month = item.month ?? 0;
    if (pdmIdx >= 0) { const s = (cells[pdmIdx] ?? "").trim(); if (/^\d{6}$/.test(s)) { year = +s.slice(0,4); month = +s.slice(4,6); } }
    if (!year || !month) return;
    const key = `${practice}|${ods}|${year}|${month}`;
    let c = agg.get(key);
    if (!c) { c = { practice, ods, year, month, items: 0 }; agg.set(key, c); }
    if (itemsIdx >= 0) c.items += num(cells[itemsIdx]);
  });
  if (practiceIdx < 0) throw new Error("No practice column");
  if (rowNo <= 1) throw new Error("Empty CSV");
  const rows = Array.from(agg.values()).map(a => ({ practice_code: a.practice, pharmacy_ods_code: a.ods, year: a.year, month: a.month, items_dispensed: Math.round(a.items), is_provisional: a.year > 2023 || (a.year === 2023 && a.month >= 5), data_source: "NHS_SCOT_LINKAGE" }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("gp_pharmacy_linkage").upsert(rows.slice(i, i+500), { onConflict: "practice_code,pharmacy_ods_code,year,month" });
    if (error) throw error;
  }
  return rows.length;
}

async function processScotlandListsize(item: any) {
  type Row = { practice_code: string; list_size_date: string; registered_patients: number; country: string; data_source: string };
  const rows: Row[] = [];
  let codeIdx = -1, totIdx = -1, dateIdx = -1, qIdx = -1, yIdx = -1; let rowNo = 0;
  await streamCsv(item.resource_url, (cells) => {
    if (rowNo++ === 0) {
      const h = buildHeaderIndex(cells);
      codeIdx = h.find("PracticeCode", "GPPracticeCode", "GPPractice");
      totIdx = h.find("TotalNumberOfPatients", "TotalPatients", "AllAges", "Total", "NumberOfPatients", "PatientCount");
      dateIdx = h.find("Date");
      qIdx = h.find("Quarter");
      yIdx = h.find("Year");
      return;
    }
    if (codeIdx < 0 || totIdx < 0) return;
    const code = (cells[codeIdx] ?? "").trim(); if (!code) return;
    const tot = num(cells[totIdx]); if (!tot) return;
    let date: string | null = null;
    if (dateIdx >= 0) { const s = (cells[dateIdx] ?? "").trim(); if (/^\d{8}$/.test(s)) date = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`; }
    if (!date && yIdx >= 0 && qIdx >= 0) { const y = +cells[yIdx]; const q = +cells[qIdx]; if (y && q) { const m = [3,6,9,12][q-1]; date = `${y}-${String(m).padStart(2,"0")}-01`; } }
    if (!date && item.year && item.month) date = `${item.year}-${String(item.month).padStart(2,"0")}-01`;
    if (!date) return;
    rows.push({ practice_code: code, list_size_date: date, registered_patients: tot, country: "Scotland", data_source: "NHS_SCOT_LISTSIZE" });
  });
  if (codeIdx < 0 || totIdx < 0) throw new Error("Missing code/total column");
  if (rowNo <= 1) throw new Error("Empty CSV");
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("gp_list_sizes").upsert(rows.slice(i, i+500), { onConflict: "practice_code,list_size_date" });
    if (error) throw error;
  }
  return rows.length;
}

async function processEngland(item: any) {
  if (item.dataset === "epraccur") {
    let rows: any[] = [];
    try {
      const res = await fetch("https://files.digital.nhs.uk/assets/ods/current/epraccur.zip", {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
      });
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        const files = unzipSync(buf, { filter: f => f.name.toLowerCase().endsWith(".csv") });
        const name = Object.keys(files)[0];
        if (name) {
          const text = strFromU8(files[name]);
          for (const line of text.split(/\r?\n/)) {
            if (!line) continue;
            const cells = line.split(",");
            const code = (cells[0] ?? "").trim();
            const status = (cells[12] ?? "").trim();
            if (!code || status !== "A") continue;
            rows.push({ practice_code: code, practice_name: (cells[1] ?? "").trim().replace(/^"|"$/g, ""), country: "England", postcode: (cells[9] ?? "").trim() || null, status_code: status });
          }
        }
      } else {
        console.warn(`epraccur ${res.status} — falling back to OpenPrescribing`);
      }
    } catch (e) {
      console.warn("epraccur error:", (e as Error).message);
    }
    if (!rows.length) {
      const res = await fetch("https://openprescribing.net/api/1.0/org_code/?org_type=practice&format=csv", {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
      });
      if (!res.ok) throw new Error(`openprescribing ${res.status}`);
      const text = await res.text();
      const lines = text.split(/\r?\n/);
      const header = lines[0].split(",").map(c => c.trim().toLowerCase());
      const codeIdx = header.findIndex(h => h === "code" || h === "practice_code");
      const nameIdx = header.findIndex(h => h === "name" || h === "practice_name");
      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(",");
        const code = (cells[codeIdx] ?? "").trim(); if (!code) continue;
        rows.push({ practice_code: code, practice_name: nameIdx >= 0 ? (cells[nameIdx] ?? "").trim() : code, country: "England", postcode: null, status_code: "A" });
      }
    }
    if (!rows.length) throw new Error("No practice rows");
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from("gp_practices").upsert(rows.slice(i, i+500), { onConflict: "practice_code" });
      if (error) throw error;
    }
    return rows.length;
  }
  // patients-registered CSV
  type R = { practice_code: string; list_size_date: string; registered_patients: number; country: string; data_source: string };
  const rows: R[] = [];
  let codeIdx = -1, totIdx = -1, dateIdx = -1; let rowNo = 0;
  const fallbackDate = (() => { const y = item.year ?? new Date().getUTCFullYear(); const m = item.month ?? 1; return new Date(Date.UTC(y, m, 0)).toISOString().slice(0,10); })();
  await streamCsv(item.resource_url, (cells) => {
    if (rowNo++ === 0) {
      const h = buildHeaderIndex(cells);
      codeIdx = h.find("PRACTICE_CODE", "ORG_CODE", "CODE");
      totIdx = h.find("TOTAL_ALL", "NUMBER_OF_PATIENTS", "TOTAL_PATIENTS", "PATIENTS");
      dateIdx = h.find("EXTRACT_DATE", "EXTRACT_DT", "PUBLICATION");
      return;
    }
    if (codeIdx < 0 || totIdx < 0) return;
    const code = (cells[codeIdx] ?? "").trim(); if (!code) return;
    const tot = +(cells[totIdx] ?? "0").replace(/,/g, "") || 0; if (!tot) return;
    let date = fallbackDate;
    if (dateIdx >= 0) { const s = (cells[dateIdx] ?? "").trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) date = s.slice(0,10); }
    rows.push({ practice_code: code, list_size_date: date, registered_patients: tot, country: "England", data_source: "NHSBSA_LISTSIZE" });
  });
  if (codeIdx < 0) throw new Error("No PRACTICE_CODE column");
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("gp_list_sizes").upsert(rows.slice(i, i+500), { onConflict: "practice_code,list_size_date" });
    if (error) throw error;
  }
  return rows.length;
}

async function processItem(item: any): Promise<{ rows?: number; error?: string }> {
  try {
    await markProcessing(item.id);
    let rows = 0;
    if (item.source === "NHS_SCOT_GP" && item.dataset.endsWith(":prescriber")) rows = await processScotlandPrescriber(item);
    else if (item.source === "NHS_SCOT_GP" && item.dataset.endsWith(":dispenser")) rows = await processScotlandDispenser(item);
    else if (item.source === "NHS_SCOT_LINKAGE") rows = await processScotlandLinkage(item);
    else if (item.source === "NHS_SCOT_LISTSIZE") rows = await processScotlandListsize(item);
    else if (item.source === "NHSBSA_LISTSIZE") rows = await processEngland(item);
    else throw new Error(`Unknown source ${item.source}`);
    await markDone(item, rows);
    return { rows };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await markFailed(item, msg);
    return { error: msg };
  }
}

async function worker(source: string, name: string) {
  let processed = 0;
  while (true) {
    const { data } = await sb.from("ingestion_queue")
      .select("id, source, dataset, resource_url, year, month")
      .eq("source", source).eq("status", "pending")
      .order("year", { ascending: false, nullsFirst: false })
      .order("month", { ascending: false, nullsFirst: false })
      .limit(1);
    const item = data?.[0];
    if (!item) break;
    const t0 = Date.now();
    const res = await processItem(item);
    const ms = Date.now() - t0;
    processed++;
    const tag = res.rows !== undefined ? `OK ${res.rows} rows` : `FAIL ${res.error}`;
    console.log(`[${name}] ${item.dataset} ${item.year}/${item.month ?? "-"} ${tag} (${ms}ms)`);
  }
  console.log(`[${name}] DONE, processed ${processed}`);
}

await Promise.all([
  worker("NHS_SCOT_GP", "scot-gp"),
  worker("NHS_SCOT_LINKAGE", "scot-link"),
  worker("NHS_SCOT_LISTSIZE", "scot-list"),
  worker("NHSBSA_LISTSIZE", "eng-list"),
]);
console.log("ALL DONE");

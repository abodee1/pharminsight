// Scotland — GP Practice Populations (quarterly list sizes).
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  streamCsv, buildHeaderIndex, alreadyHandled, enqueue,
  takeNextPending, markProcessing, markSuccess, markFailed,
  ckanResources, parseYearMonth,
} from "@/lib/ingest-utils.server";

const SOURCE = "NHS_SCOT_LISTSIZE";
const DATASET_ID = "gp-practice-populations";
const CKAN_BASE = "https://www.opendata.nhs.scot/api/3/action";

async function discover() {
  const skip = await alreadyHandled(SOURCE);
  const resources = (await ckanResources(CKAN_BASE, DATASET_ID))
    .filter((r) => r.format?.toUpperCase() === "CSV");
  const queue = [];
  for (const r of resources) {
    if (skip.has(r.url)) continue;
    const { year, month } = parseYearMonth(r.url, r.name);
    queue.push({ source: SOURCE, dataset: DATASET_ID, resource_url: r.url, year, month });
  }
  return enqueue(queue);
}

function parseDate(s: string): string | null {
  if (!s) return null;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function processOne() {
  const item = await takeNextPending(SOURCE);
  if (!item) return null;
  await markProcessing(item.id);
  try {
    let codeIdx = -1, nameIdx = -1, hbIdx = -1, patIdx = -1, dateIdx = -1, sexIdx = -1;
    const practices = new Map<string, { code: string; name: string; hb: string | null }>();
    const sizes = new Map<string, { code: string; date: string; patients: number }>();
    let rowNo = 0;
    await streamCsv(item.resource_url, (cells) => {
      if (rowNo++ === 0) {
        const h = buildHeaderIndex(cells);
        codeIdx = h.find("PracticeCode", "GPPracticeCode");
        nameIdx = h.find("PracticeName", "GPPracticeName");
        hbIdx = h.find("HBName", "HBT", "HB");
        // "AllAges" is the canonical column in the agesex CSVs (with a Sex=All row);
        // fall back to legacy column names where present.
        patIdx = h.find("AllAges", "NumberOfPatients", "Patients", "PracticeListSize");
        sexIdx = h.find("Sex");
        dateIdx = h.find("Date", "ExtractDate", "QuarterEnding");
        return;
      }
      if (codeIdx < 0) return;
      // When a Sex column is present, only sum the pre-aggregated "All" row to
      // avoid double counting (Male + Female + All would triple the list size).
      if (sexIdx >= 0) {
        const sex = (cells[sexIdx] ?? "").trim();
        if (sex && sex.toLowerCase() !== "all") return;
      }
      const code = (cells[codeIdx] ?? "").trim();
      if (!code) return;
      const date = dateIdx >= 0 ? parseDate((cells[dateIdx] ?? "").trim()) : null;
      const patients = patIdx >= 0 ? +(cells[patIdx] ?? "0").replace(/,/g, "") || 0 : 0;
      practices.set(code, {
        code, name: nameIdx >= 0 ? (cells[nameIdx] ?? "").trim() : code,
        hb: hbIdx >= 0 ? (cells[hbIdx] ?? "").trim() || null : null,
      });
      if (date) sizes.set(`${code}|${date}`, { code, date, patients });
    });
    if (codeIdx < 0) throw new Error("No PracticeCode column");
    if (rowNo <= 1) throw new Error("Empty CSV");

    const practiceRows = Array.from(practices.values()).map((p) => ({
      practice_code: p.code, practice_name: p.name, country: "Scotland",
      health_board: p.hb, status_code: "A",
    }));
    for (let i = 0; i < practiceRows.length; i += 500) {
      const { error } = await supabaseAdmin.from("gp_practices")
        .upsert(practiceRows.slice(i, i + 500), { onConflict: "practice_code" });
      if (error) throw error;
    }

    const sizeRows = Array.from(sizes.values()).map((s) => ({
      practice_code: s.code, list_size_date: s.date,
      registered_patients: s.patients, country: "Scotland", data_source: SOURCE,
    }));
    for (let i = 0; i < sizeRows.length; i += 500) {
      const { error } = await supabaseAdmin.from("gp_list_sizes")
        .upsert(sizeRows.slice(i, i + 500), { onConflict: "practice_code,list_size_date" });
      if (error) throw error;
    }
    await markSuccess({ ...item, source: SOURCE, rows: sizeRows.length });
    return { url: item.resource_url, rows: sizeRows.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ingest-scotland-gp-listsize] ${item.resource_url}`, msg);
    await markFailed({ ...item, source: SOURCE, error: msg });
    return { url: item.resource_url, error: msg };
  }
}

export const Route = createFileRoute("/api/public/hooks/ingest-scotland-gp-listsize")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const queued = await discover();
          const result = await processOne();
          return Response.json({ ok: true, queued, processed: result ? 1 : 0, result });
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
      GET: async () => Response.json({ ok: true }),
    },
  },
});

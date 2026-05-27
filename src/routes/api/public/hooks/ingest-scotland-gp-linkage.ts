// Scotland — Prescribed and Dispensed (quarterly GP→pharmacy linkage).
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  streamCsv, buildHeaderIndex, num, alreadyHandled, enqueue,
  takeNextPending, markProcessing, markSuccess, markFailed,
  ckanResources, parseQuarter,
} from "@/lib/ingest-utils.server";

const SOURCE = "NHS_SCOT_LINKAGE";
const DATASET_ID = "prescribed-dispensed";
const CKAN_BASE = "https://www.opendata.nhs.scot/api/3/action";

function isProvisional(year: number, month: number) {
  return year > 2023 || (year === 2023 && month >= 5);
}

async function discover() {
  const skip = await alreadyHandled(SOURCE);
  const resources = (await ckanResources(CKAN_BASE, DATASET_ID))
    .filter((r) => r.format?.toUpperCase() === "CSV");
  const queue = [];
  for (const r of resources) {
    if (skip.has(r.url)) continue;
    const { year, month } = parseQuarter(r.url, r.name);
    queue.push({ source: SOURCE, dataset: DATASET_ID, resource_url: r.url, year, month });
  }
  return enqueue(queue);
}

async function processOne() {
  const item = await takeNextPending(SOURCE);
  if (!item) return null;
  await markProcessing(item.id);
  try {
    let practiceIdx = -1, pharmIdx = -1, itemsIdx = -1, qIdx = -1, yIdx = -1;
    type Agg = { practice: string; ods: string; year: number; month: number; items: number };
    const agg = new Map<string, Agg>();
    let rowNo = 0;
    await streamCsv(item.resource_url, (cells) => {
      if (rowNo++ === 0) {
        const h = buildHeaderIndex(cells);
        practiceIdx = h.find("PracticeCode", "GPPracticeCode");
        pharmIdx = h.find("DispensLocationCode", "DispenserLocationCode");
        itemsIdx = h.find("NumberOfItems", "NumberOfPaidItems");
        qIdx = h.find("Quarter");
        yIdx = h.find("Year");
        return;
      }
      if (practiceIdx < 0 || pharmIdx < 0) return;
      const practice = (cells[practiceIdx] ?? "").trim();
      const ods = (cells[pharmIdx] ?? "").trim();
      if (!practice || !ods) return;
      let year = item.year ?? 0, month = item.month ?? 0;
      if (yIdx >= 0) {
        const ys = (cells[yIdx] ?? "").trim();
        if (/^\d{4}$/.test(ys)) year = +ys;
      }
      if (qIdx >= 0) {
        const qs = (cells[qIdx] ?? "").trim();
        const m = qs.match(/[1-4]/);
        if (m) month = [1, 4, 7, 10][+m[0] - 1];
      }
      if (!year || !month) return;
      const key = `${practice}|${ods}|${year}|${month}`;
      let c = agg.get(key);
      if (!c) { c = { practice, ods, year, month, items: 0 }; agg.set(key, c); }
      if (itemsIdx >= 0) c.items += num(cells[itemsIdx]);
    });
    if (practiceIdx < 0) throw new Error("No PracticeCode column");
    if (rowNo <= 1) throw new Error("Empty CSV");

    const rows = Array.from(agg.values()).map((a) => ({
      practice_code: a.practice, pharmacy_ods_code: a.ods,
      year: a.year, month: a.month,
      items_dispensed: Math.round(a.items),
      is_provisional: isProvisional(a.year, a.month),
      data_source: SOURCE,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabaseAdmin.from("gp_pharmacy_linkage")
        .upsert(rows.slice(i, i + 500), { onConflict: "practice_code,pharmacy_ods_code,year,month" });
      if (error) throw error;
    }
    await markSuccess({ ...item, source: SOURCE, rows: rows.length });
    return { url: item.resource_url, rows: rows.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ingest-scotland-gp-linkage] ${item.resource_url}`, msg);
    await markFailed({ ...item, source: SOURCE, error: msg });
    return { url: item.resource_url, error: msg };
  }
}

export const Route = createFileRoute("/api/public/hooks/ingest-scotland-gp-linkage")({
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

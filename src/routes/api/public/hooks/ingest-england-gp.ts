// England — Practice Level Prescribing Data (EPD, monthly).
// Streams large CSV (~1GB), aggregates SUM(ITEMS) by (PRACTICE_CODE, PERIOD),
// then upserts into gp_prescribing.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  streamCsv, buildHeaderIndex, num, alreadyHandled, enqueue,
  takeNextPending, markProcessing, markSuccess, markFailed,
  ckanResources, parseYearMonth,
} from "@/lib/ingest-utils.server";

const SOURCE = "NHSBSA_GP";
const CKAN_BASE = "https://opendata.nhsbsa.net/api/3/action";
const PACKAGES = ["english-prescribing-data-epd-snomed", "english-prescribing-data-epd"];

async function discover() {
  const skip = await alreadyHandled(SOURCE);
  const queue = [];
  for (const pkg of PACKAGES) {
    let resources: Awaited<ReturnType<typeof ckanResources>> = [];
    try { resources = await ckanResources(CKAN_BASE, pkg); } catch (e) {
      console.error(`[ingest-england-gp] CKAN ${pkg}: ${e}`);
      continue;
    }
    for (const r of resources) {
      if (r.format?.toUpperCase() !== "CSV") continue;
      if (skip.has(r.url)) continue;
      const { year, month } = parseYearMonth(r.url, r.name);
      queue.push({ source: SOURCE, dataset: pkg, resource_url: r.url, year, month });
    }
  }
  return enqueue(queue);
}

async function processOne() {
  const item = await takeNextPending(SOURCE);
  if (!item) return null;
  await markProcessing(item.id);
  try {
    let codeIdx = -1, nameIdx = -1, itemsIdx = -1, nicIdx = -1, periodIdx = -1;
    type Agg = { code: string; name: string; year: number; month: number; items: number; nic: number };
    const agg = new Map<string, Agg>();
    let rowNo = 0;
    await streamCsv(item.resource_url, (cells) => {
      if (rowNo++ === 0) {
        const h = buildHeaderIndex(cells);
        codeIdx = h.find("PRACTICE_CODE");
        nameIdx = h.find("PRACTICE_NAME");
        itemsIdx = h.find("ITEMS");
        nicIdx = h.find("NIC", "ACTUAL_COST");
        periodIdx = h.find("YEAR_MONTH", "PERIOD");
        return;
      }
      if (codeIdx < 0) return;
      const code = (cells[codeIdx] ?? "").trim();
      if (!code) return;
      let year = item.year ?? 0, month = item.month ?? 0;
      if (periodIdx >= 0) {
        const s = (cells[periodIdx] ?? "").trim();
        if (/^\d{6}$/.test(s)) { year = +s.slice(0, 4); month = +s.slice(4, 6); }
      }
      if (!year || !month) return;
      const key = `${code}|${year}|${month}`;
      let c = agg.get(key);
      if (!c) {
        c = {
          code, name: nameIdx >= 0 ? (cells[nameIdx] ?? "").trim() : code,
          year, month, items: 0, nic: 0,
        };
        agg.set(key, c);
      }
      if (itemsIdx >= 0) c.items += num(cells[itemsIdx]);
      if (nicIdx >= 0) c.nic += num(cells[nicIdx]);
    });
    if (codeIdx < 0) throw new Error("No PRACTICE_CODE column");
    if (rowNo <= 1) throw new Error("Empty CSV");

    const practices = Array.from(
      new Map(Array.from(agg.values()).map((a) => [a.code, {
        practice_code: a.code, practice_name: a.name, country: "England", status_code: "A",
      }])).values(),
    );
    for (let i = 0; i < practices.length; i += 500) {
      const { error } = await supabaseAdmin.from("gp_practices")
        .upsert(practices.slice(i, i + 500), { onConflict: "practice_code" });
      if (error) throw error;
    }

    const rows = Array.from(agg.values()).map((a) => ({
      practice_code: a.code, year: a.year, month: a.month, country: "England",
      total_items: Math.round(a.items), total_nic: a.nic,
      is_provisional: false, data_source: SOURCE,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabaseAdmin.from("gp_prescribing")
        .upsert(rows.slice(i, i + 500), { onConflict: "practice_code,year,month,country" });
      if (error) throw error;
    }
    await markSuccess({ ...item, source: SOURCE, rows: rows.length });
    return { url: item.resource_url, rows: rows.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ingest-england-gp] ${item.resource_url}`, msg);
    await markFailed({ ...item, source: SOURCE, error: msg });
    return { url: item.resource_url, error: msg };
  }
}

export const Route = createFileRoute("/api/public/hooks/ingest-england-gp")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const queued = await discover();
          const result = await processOne();
          const { count: pending } = await supabaseAdmin.from("ingestion_queue")
            .select("id", { count: "exact", head: true })
            .eq("source", SOURCE).eq("status", "pending");
          return Response.json({ ok: true, queued, processed: result ? 1 : 0, result, pending });
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
      GET: async () => {
        const { count: pending } = await supabaseAdmin.from("ingestion_queue")
          .select("id", { count: "exact", head: true })
          .eq("source", SOURCE).eq("status", "pending");
        return Response.json({ ok: true, pending });
      },
    },
  },
});

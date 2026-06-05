// Scotland — Prescriptions in the Community (monthly).
// Dataset 1 of the GP ingestion plan.
// Files: "Data by Prescriber Location" (GP prescribing) + "Data by Dispenser Location" (pharmacy dispensing).
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  streamCsv, buildHeaderIndex, num, alreadyHandled, enqueue,
  takeNextPending, markProcessing, markSuccess, markFailed,
  ckanResources, parseYearMonth,
} from "@/lib/ingest-utils.server";

const SOURCE = "NHS_SCOT_GP";
const DATASET_ID = "prescriptions-in-the-community";
const CKAN_BASE = "https://www.opendata.nhs.scot/api/3/action";

type Kind = "prescriber" | "dispenser";
const classify = (name: string): Kind | null => {
  if (/prescriber location|by prescriber/i.test(name)) return "prescriber";
  if (/dispenser location|by dispenser/i.test(name)) return "dispenser";
  return null;
};

async function discover() {
  const skip = await alreadyHandled(SOURCE);
  const resources = (await ckanResources(CKAN_BASE, DATASET_ID))
    .filter((r) => r.format?.toUpperCase() === "CSV" && classify(r.name) !== null);
  const queue = [];
  for (const r of resources) {
    if (skip.has(r.url)) continue;
    const kind = classify(r.name)!;
    const { year, month } = parseYearMonth(r.url, r.name);
    queue.push({
      source: SOURCE, dataset: `${DATASET_ID}:${kind}`,
      resource_url: r.url, year, month,
    });
  }
  return enqueue(queue);
}

async function processPrescriber(item: { id: string; dataset: string; resource_url: string; year: number | null; month: number | null }) {
  // Aggregate per (practice, year, month).
  type Agg = {
    practice_code: string; practice_name: string; health_board: string | null;
    year: number; month: number; items: number; nic: number;
  };
  const agg = new Map<string, Agg>();
  let codeIdx = -1, nameIdx = -1, hbIdx = -1, itemsIdx = -1, nicIdx = -1, pdmIdx = -1;
  let rowNo = 0;
  await streamCsv(item.resource_url, (cells) => {
    if (rowNo++ === 0) {
      const h = buildHeaderIndex(cells);
      codeIdx = h.find("GPPracticeCode", "PracticeCode", "GPPractice");
      nameIdx = h.find("GPPracticeName", "PracticeName");
      hbIdx = h.find("HBName", "HBT", "HB");
      itemsIdx = h.find("NumberOfPaidItems", "NumberOfItems", "PaidQuantity");
      nicIdx = h.find("GrossIngredientCost", "GIC");
      pdmIdx = h.find("PaidDateMonth");
      return;
    }
    if (codeIdx < 0) return;
    const code = (cells[codeIdx] ?? "").trim();
    if (!code) return;
    let year = item.year ?? 0, month = item.month ?? 0;
    if (pdmIdx >= 0) {
      const s = (cells[pdmIdx] ?? "").trim();
      if (/^\d{6}$/.test(s)) { year = +s.slice(0, 4); month = +s.slice(4, 6); }
    }
    if (!year || !month) return;
    const key = `${code}|${year}|${month}`;
    let c = agg.get(key);
    if (!c) {
      c = {
        practice_code: code,
        practice_name: nameIdx >= 0 ? (cells[nameIdx] ?? "").trim() : code,
        health_board: hbIdx >= 0 ? (cells[hbIdx] ?? "").trim() || null : null,
        year, month, items: 0, nic: 0,
      };
      agg.set(key, c);
    }
    if (itemsIdx >= 0) c.items += num(cells[itemsIdx]);
    if (nicIdx >= 0) c.nic += num(cells[nicIdx]);
  });
  if (codeIdx < 0) throw new Error("No GPPracticeCode column");
  if (rowNo <= 1) throw new Error("Empty CSV");

  // Upsert practices directory
  const practices = Array.from(
    new Map(Array.from(agg.values()).map((a) => [a.practice_code, {
      practice_code: a.practice_code, practice_name: a.practice_name,
      country: "Scotland", health_board: a.health_board, status_code: "A",
    }])).values(),
  );
  for (let i = 0; i < practices.length; i += 500) {
    const { error } = await supabaseAdmin.from("gp_practices")
      .upsert(practices.slice(i, i + 500), { onConflict: "practice_code" });
    if (error) throw error;
  }

  const rows = Array.from(agg.values()).map((a) => ({
    practice_code: a.practice_code, year: a.year, month: a.month,
    country: "Scotland", total_items: Math.round(a.items), total_nic: a.nic,
    is_provisional: false, data_source: SOURCE,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from("gp_prescribing")
      .upsert(rows.slice(i, i + 500), { onConflict: "practice_code,year,month,country" });
    if (error) throw error;
  }
  return rows.length;
}

async function processDispenser(item: { id: string; dataset: string; resource_url: string; year: number | null; month: number | null }) {
  type Agg = {
    ods: string; name: string; hb: string | null;
    year: number; month: number; items: number; gross: number;
  };
  const agg = new Map<string, Agg>();
  let odsIdx = -1, nameIdx = -1, hbIdx = -1, itemsIdx = -1, gicIdx = -1, pdmIdx = -1;
  let rowNo = 0;
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
    const ods = (cells[odsIdx] ?? "").trim();
    if (!ods) return;
    let year = item.year ?? 0, month = item.month ?? 0;
    if (pdmIdx >= 0) {
      const s = (cells[pdmIdx] ?? "").trim();
      if (/^\d{6}$/.test(s)) { year = +s.slice(0, 4); month = +s.slice(4, 6); }
    }
    if (!year || !month) return;
    const key = `${ods}|${year}|${month}`;
    let c = agg.get(key);
    if (!c) {
      c = {
        ods, name: nameIdx >= 0 ? (cells[nameIdx] ?? "").trim() : ods,
        hb: hbIdx >= 0 ? (cells[hbIdx] ?? "").trim() || null : null,
        year, month, items: 0, gross: 0,
      };
      agg.set(key, c);
    }
    if (itemsIdx >= 0) c.items += num(cells[itemsIdx]);
    if (gicIdx >= 0) c.gross += num(cells[gicIdx]);
  });
  if (odsIdx < 0) throw new Error("No DispensLocationCode column");
  if (rowNo <= 1) throw new Error("Empty CSV");

  const rows = Array.from(agg.values()).map((a) => ({
    pharmacy_ods_code: a.ods, pharmacy_name: a.name, health_board: a.hb,
    year: a.year, month: a.month, items_dispensed: Math.round(a.items),
    gross_cost: a.gross, data_source: SOURCE,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from("gp_dispensing_by_pharmacy")
      .upsert(rows.slice(i, i + 500), { onConflict: "pharmacy_ods_code,year,month" });
    if (error) throw error;
  }
  return rows.length;
}

async function processOne() {
  const item = await takeNextPending(SOURCE);
  if (!item) return null;
  await markProcessing(item.id);
  try {
    const rows = item.dataset.endsWith(":prescriber")
      ? await processPrescriber(item)
      : await processDispenser(item);
    await markSuccess({ ...item, source: SOURCE, rows });
    return { url: item.resource_url, rows };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ingest-scotland-gp] ${item.resource_url}`, msg);
    await markFailed({ ...item, source: SOURCE, error: msg });
    return { url: item.resource_url, error: msg };
  }
}

export const Route = createFileRoute("/api/public/hooks/ingest-scotland-gp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeHookRequest(request);
        if (!auth.ok) return new Response(auth.message, { status: auth.status });
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

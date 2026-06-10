import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeHookRequest } from "@/lib/hook-auth.server";

const SOURCE = "NWSSP_WALES";

type CkanResource = { id: string; name: string; url: string; format: string; created?: string; last_modified?: string };

// NWSSP (NHS Wales Shared Services Partnership) open data.
// Primary dispensing data is on data.gov.uk (same CKAN as NI); contractor activity is on the
// NWSSP open data portal.
// TODO: verify these dataset IDs — search "nwssp dispensing" at https://ckan.publishing.service.gov.uk
// and "pharmacy contractor activity" at https://opendata.nwssp.wales.nhs.uk/api/3/action.
const SOURCES = [
  {
    ckanBase: "https://ckan.publishing.service.gov.uk/api/3/action",
    dataset: "dispensing-by-pharmacy-contractor-wales",
    filter: (r: CkanResource) => r.format?.toUpperCase() === "CSV",
  },
  {
    // NWSSP open data CKAN — contractor activity (NMS, Pharmacy First, EPS, payments)
    ckanBase: "https://opendata.nwssp.wales.nhs.uk/api/3/action",
    dataset: "community-pharmacy-contractor-activity",
    filter: (r: CkanResource) => r.format?.toUpperCase() === "CSV",
  },
] as const;

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parseYearMonth(name: string, url: string, created?: string) {
  const text = (name + " " + url).toLowerCase();
  const m1 = text.match(/(?<![0-9])(20\d{2})(0[1-9]|1[0-2])(?![0-9])/);
  if (m1) return { year: +m1[1], month: +m1[2] };
  const m2 = name.match(/([A-Za-z]+)\s+(\d{4})/);
  if (m2) {
    const monthName = m2[1].toLowerCase();
    const month = MONTH_NAMES[monthName] ??
      Object.entries(MONTH_NAMES).find(([k]) => k.startsWith(monthName))?.[1];
    if (month) return { year: +m2[2], month };
  }
  const m3 = name.match(/(20\d{2})/) || url.match(/(20\d{2})/);
  if (m3) return { year: +m3[1], month: null as number | null };
  if (created) {
    const d = new Date(created);
    if (!isNaN(d.getTime())) return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  }
  return { year: null as number | null, month: null as number | null };
}

async function streamCsv(url: string, onRow: (cells: string[]) => void) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch ${res.status}`);
  if (!res.body) throw new Error("No body");
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

async function discover() {
  const skip = new Set<string>();
  {
    const { data } = await supabaseAdmin.from("ingestion_log")
      .select("resource_url").eq("source", SOURCE).eq("status", "success");
    for (const r of data ?? []) skip.add(r.resource_url);
  }
  {
    const { data } = await supabaseAdmin.from("ingestion_queue")
      .select("resource_url, status").eq("source", SOURCE);
    for (const r of data ?? []) if (["pending", "processing", "done"].includes(r.status)) skip.add(r.resource_url);
  }

  const queue: Array<{
    source: string; dataset: string; resource_url: string;
    year: number | null; month: number | null; status: string; error: string | null;
  }> = [];

  for (const src of SOURCES) {
    let res: Response;
    try {
      res = await fetch(`${src.ckanBase}/package_show?id=${src.dataset}`);
      if (!res.ok) { console.warn(`[ingest-wales] CKAN ${src.dataset}: ${res.status}`); continue; }
    } catch {
      console.warn(`[ingest-wales] Could not reach ${src.ckanBase} for ${src.dataset}`);
      continue;
    }
    const payload = (await res.json()) as { result?: { resources?: CkanResource[] } };
    const resources = (payload.result?.resources ?? []).filter(src.filter);
    for (const r of resources) {
      if (skip.has(r.url)) continue;
      const { year, month } = parseYearMonth(r.name, r.url, r.created ?? r.last_modified);
      queue.push({ source: SOURCE, dataset: src.dataset, resource_url: r.url, year, month, status: "pending", error: null });
    }
  }

  let queued = 0;
  for (let i = 0; i < queue.length; i += 200) {
    const chunk = queue.slice(i, i + 200);
    const { error } = await supabaseAdmin.from("ingestion_queue")
      .upsert(chunk, { onConflict: "source,dataset,resource_url" });
    if (!error) queued += chunk.length;
  }
  return queued;
}

async function processQueueItem(item: {
  id: string; dataset: string; resource_url: string;
  year: number | null; month: number | null;
}) {
  await supabaseAdmin.from("ingestion_queue")
    .update({ status: "processing", started_at: new Date().toISOString() }).eq("id", item.id);

  try {
    type Agg = {
      ods_code: string; name: string;
      address: string | null; postcode: string | null; region: string | null;
      year: number; month: number;
      items: number; eps_items: number; nms_count: number; pharmacy_first_count: number;
      flu_vaccinations: number; gross_cost: number; final_payment: number;
      pharmacy_first_payment: number;
    };
    const agg = new Map<string, Agg>();
    let headers: string[] = [];
    let idx: Record<string, number> = {};
    let rowCount = 0;

    const find = (...variants: string[]): number => {
      for (const v of variants) {
        const k = v.toLowerCase().replace(/[\s_]/g, "");
        if (idx[k] !== undefined) return idx[k];
      }
      return -1;
    };
    const num = (v: string | undefined) =>
      v ? Number(String(v).replace(/[£,"]/g, "").trim()) || 0 : 0;

    await streamCsv(item.resource_url, (cells) => {
      if (rowCount++ === 0) {
        headers = cells.map((c) => c.trim());
        headers.forEach((h, i) => { idx[h.toLowerCase().replace(/[\s_]/g, "")] = i; });
        return;
      }
      if (cells.length < 3) return;

      const ods = (cells[find("ContractorCode", "Contractor_Code", "PAIDAT_CODE", "PharmacyCode", "GPhCNumber")] ?? "").trim();
      if (!ods) return;

      let year = item.year ?? 0;
      let month = item.month ?? 0;
      const yms = (cells[find("YearMonth", "Year_Month", "YEAR_MONTH")] ?? "").trim();
      const ys = (cells[find("Year", "YEAR")] ?? "").trim();
      const ms = (cells[find("Month", "MONTH")] ?? "").trim();
      if (/^\d{4}-\d{2}$/.test(yms)) { year = +yms.slice(0, 4); month = +yms.slice(5, 7); }
      else if (/^\d{6}$/.test(yms)) { year = +yms.slice(0, 4); month = +yms.slice(4, 6); }
      else {
        if (/^\d{4}$/.test(ys)) year = +ys;
        if (/^\d{1,2}$/.test(ms)) month = +ms;
      }
      if (!year) return;

      const items = num(cells[find("Items", "NumberOfItems", "PrescriptionItems", "TotalItems", "PaidItems")]);
      const eps = num(cells[find("EPSItems", "EPS_Items", "ElectronicItems", "NumberOfEPSItems", "EPSPrescriptionItems")]);
      const nms = num(cells[find("NMSItems", "NMSCount", "NMS", "NewMedicineService", "NewMedicineServiceItems", "NMSConsultations")]);
      const pf = num(cells[find("PharmacyFirstItems", "PharmacyFirstCount", "PF_Items", "PharmacyFirst", "PharmacyFirstConsultations")]);
      const flu = num(cells[find("FluVaccinations", "FluItems", "InfluenzaItems", "FluAdministered")]);
      const grossCost = num(cells[find("GrossIngredientCost", "GIC", "GrossCost", "Gross_Cost")]);
      const finalPay = num(cells[find("FinalPayment", "NetPayment", "TotalPayment", "Final_Payment")]);
      const pfPay = num(cells[find("PharmacyFirstPayment", "PF_Payment", "PharmacyFirstFee")]);

      const key = `${ods}|${year}|${month}`;
      let cur = agg.get(key);
      if (!cur) {
        cur = {
          ods_code: ods,
          name: (cells[find("ContractorName", "Contractor_Name", "PharmacyName", "CONTRACTOR_NAME")] ?? "").trim() || ods,
          address: [
            cells[find("Address1", "AddressLine1", "ContractorAddressLine1")],
            cells[find("Address2", "AddressLine2", "ContractorAddressLine2")],
            cells[find("Address3", "AddressLine3", "ContractorAddressLine3")],
          ].map((s) => (s ?? "").trim()).filter(Boolean).join(", ") || null,
          postcode: (cells[find("Postcode", "PostCode", "ContractorPostcode")] ?? "").trim() || null,
          // Wales uses Local Health Boards (LHBs) instead of ICBs
          region: (cells[find("LHBName", "LHB_Name", "HealthBoard", "HealthBoardName", "LHB")] ?? "").trim() || null,
          year, month,
          items: 0, eps_items: 0, nms_count: 0, pharmacy_first_count: 0,
          flu_vaccinations: 0, gross_cost: 0, final_payment: 0, pharmacy_first_payment: 0,
        };
        agg.set(key, cur);
      }
      cur.items += items;
      cur.eps_items += eps;
      cur.nms_count += nms;
      cur.pharmacy_first_count += pf;
      cur.flu_vaccinations += flu;
      cur.gross_cost += grossCost;
      cur.final_payment += finalPay;
      cur.pharmacy_first_payment += pfPay;
    });

    if (rowCount <= 1) throw new Error("Empty CSV");

    const pharmacies = Array.from(
      new Map(Array.from(agg.values()).map((a) => [a.ods_code, {
        ods_code: a.ods_code, name: a.name,
        region: a.region, country: "Wales",
        address: a.address, postcode: a.postcode,
      }])).values(),
    );
    for (let i = 0; i < pharmacies.length; i += 500) {
      const { error } = await supabaseAdmin.from("pharmacies")
        .upsert(pharmacies.slice(i, i + 500), { onConflict: "ods_code" });
      if (error) throw error;
    }

    const odsList = pharmacies.map((p) => p.ods_code);
    const idMap = new Map<string, string>();
    for (let i = 0; i < odsList.length; i += 500) {
      const { data, error } = await supabaseAdmin.from("pharmacies")
        .select("id, ods_code").in("ods_code", odsList.slice(i, i + 500));
      if (error) throw error;
      for (const r of data ?? []) idMap.set(r.ods_code, r.id);
    }

    const dispRows = Array.from(agg.values())
      .filter((a) => idMap.has(a.ods_code) && a.month > 0)
      .map((a) => ({
        pharmacy_id: idMap.get(a.ods_code)!,
        year: a.year, month: a.month,
        items_dispensed: Math.round(a.items),
        eps_items: Math.round(a.eps_items),
        nms_count: Math.round(a.nms_count),
        pharmacy_first_count: Math.round(a.pharmacy_first_count),
        flu_vaccinations: Math.round(a.flu_vaccinations),
        gross_cost: a.gross_cost,
        final_payment: a.final_payment,
        pharmacy_first_payment: a.pharmacy_first_payment,
        is_actual_payment: a.final_payment > 0,
        data_source: SOURCE,
        is_provisional: false,
      }));

    // Contractor-activity dataset is authoritative for payment/service counts; dispensing dataset
    // owns items_dispensed. Supplementary datasets fill gaps without overwriting the primary.
    const isPrimary = item.dataset === "dispensing-by-pharmacy-contractor-wales";
    let inserted = 0;
    for (let i = 0; i < dispRows.length; i += 500) {
      const slice = dispRows.slice(i, i + 500);
      const { error } = await supabaseAdmin.from("dispensing_data")
        .upsert(slice, { onConflict: "pharmacy_id,year,month", ignoreDuplicates: !isPrimary });
      if (error) throw error;
      inserted += slice.length;
    }

    await supabaseAdmin.from("ingestion_log").insert({
      source: SOURCE, dataset: item.dataset, resource_url: item.resource_url,
      year: item.year, month: item.month, status: "success", rows_ingested: inserted,
    });
    await supabaseAdmin.from("ingestion_queue")
      .update({ status: "done", finished_at: new Date().toISOString() }).eq("id", item.id);

    return { inserted };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ingest-wales] ${item.resource_url}`, msg);
    await supabaseAdmin.from("ingestion_log").insert({
      source: SOURCE, dataset: item.dataset, resource_url: item.resource_url,
      year: item.year, month: item.month, status: "failed", error: msg,
    });
    await supabaseAdmin.from("ingestion_queue")
      .update({ status: "failed", error: msg, finished_at: new Date().toISOString() }).eq("id", item.id);
    return { error: msg };
  }
}

const DATASET_PRIORITY = [
  "dispensing-by-pharmacy-contractor-wales",
  "community-pharmacy-contractor-activity",
];

async function runBatch(batchSize = 1) {
  for (const ds of DATASET_PRIORITY) {
    const { data: queue, error } = await supabaseAdmin.from("ingestion_queue")
      .select("id, dataset, resource_url, year, month")
      .eq("source", SOURCE).eq("status", "pending").eq("dataset", ds)
      .order("year", { ascending: false }).order("month", { ascending: false })
      .limit(batchSize);
    if (error) throw error;
    if (queue?.length) return Promise.all(queue.map(processQueueItem));
  }
  return [];
}

export const Route = createFileRoute("/api/public/hooks/ingest-wales")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeHookRequest(request);
        if (!auth.ok) return new Response(auth.message, { status: auth.status });
        try {
          const url = new URL(request.url);
          const reingest = url.searchParams.get("reingest") === "1";
          let reset = 0;
          if (reingest) {
            await supabaseAdmin.from("ingestion_log").delete().eq("source", SOURCE);
            const { count } = await supabaseAdmin.from("ingestion_queue")
              .delete({ count: "exact" }).eq("source", SOURCE);
            reset = count ?? 0;
          }
          const queued = await discover();
          const results = reingest ? [] : await runBatch(1);
          const { count: pending } = await supabaseAdmin.from("ingestion_queue")
            .select("id", { count: "exact", head: true })
            .eq("source", SOURCE).eq("status", "pending");
          return Response.json({ ok: true, reingest, reset, queued, processed: results.length, results, pending });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[ingest-wales] fatal", msg);
          return Response.json({ ok: false, error: msg }, { status: 500 });
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

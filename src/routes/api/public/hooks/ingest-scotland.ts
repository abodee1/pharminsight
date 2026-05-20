import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOURCE = "PHS_SCOTLAND";
const CKAN_BASE = "https://www.opendata.nhs.scot/api/3/action";

const DATASETS = [
  {
    id: "prescriptions-in-the-community",
    monthly: true,
    filter: (name: string) =>
      /dispenser location|data by dispenser/i.test(name),
  },
  {
    id: "community-pharmacy-contractor-activity",
    monthly: false,
    filter: () => true,
  },
  {
    id: "prescribed-dispensed",
    monthly: false,
    filter: () => true,
  },
] as const;

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

type CkanResource = {
  id: string;
  name: string;
  url: string;
  format: string;
  created?: string;
  last_modified?: string;
};

function parseYearMonth(url: string, name: string, created?: string) {
  // 1. pitc202409.csv pattern
  const m1 = url.match(/pitc(\d{4})(\d{2})/i);
  if (m1) return { year: +m1[1], month: +m1[2] };

  // 2. "September 2024" / "Sep 2024"
  const m2 = name.match(/([A-Za-z]+)\s+(\d{4})/);
  if (m2) {
    const monthName = m2[1].toLowerCase();
    const month = MONTH_NAMES[monthName] ??
      Object.entries(MONTH_NAMES).find(([k]) => k.startsWith(monthName))?.[1];
    if (month) return { year: +m2[2], month };
  }

  // 3. plain year e.g. "2024" or "Contractor activity 2024"
  const m3 = name.match(/(20\d{2})/) || url.match(/(20\d{2})/);
  if (m3) return { year: +m3[1], month: null as number | null };

  // 4. fallback to created date
  if (created) {
    const d = new Date(created);
    if (!isNaN(d.getTime())) return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  }
  return { year: null as number | null, month: null as number | null };
}

function isProvisional(year: number | null, month: number | null) {
  if (!year) return false;
  if (year > 2023) return true;
  if (year === 2023 && (month ?? 0) >= 5) return true;
  return false;
}

// Streaming CSV parser — never holds the full file in memory.
// Calls onRow(cells) for each row as it arrives.
async function streamCsv(url: string, onRow: (cells: string[]) => void) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${res.status}`);
  if (!res.body) throw new Error("Response has no body stream");
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const flushRow = () => { row.push(cell); onRow(row); row = []; cell = ""; };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else inQuotes = false;
        } else cell += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ",") { row.push(cell); cell = ""; }
        else if (ch === "\n") { flushRow(); }
        else if (ch === "\r") { /* skip */ }
        else cell += ch;
      }
    }
  }
  // Tail
  const tail = decoder.decode();
  for (let i = 0; i < tail.length; i++) {
    const ch = tail[i];
    if (inQuotes) { if (ch === '"') inQuotes = false; else cell += ch; }
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { flushRow(); }
    else if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) flushRow();
}



async function discover() {
  // Pre-fetch the full set of already-successful URLs for this source in one go.
  const successUrls = new Set<string>();
  {
    const { data } = await supabaseAdmin
      .from("ingestion_log")
      .select("resource_url")
      .eq("source", SOURCE)
      .eq("status", "success");
    for (const r of data ?? []) successUrls.add(r.resource_url);
  }
  // Also skip URLs already pending/processing in the queue.
  {
    const { data } = await supabaseAdmin
      .from("ingestion_queue")
      .select("resource_url, status")
      .eq("source", SOURCE);
    for (const r of data ?? []) {
      if (["pending", "processing", "done"].includes(r.status)) successUrls.add(r.resource_url);
    }
  }

  const toQueue: Array<{
    source: string; dataset: string; resource_url: string;
    year: number | null; month: number | null; status: string; error: string | null;
  }> = [];

  for (const ds of DATASETS) {
    const res = await fetch(`${CKAN_BASE}/package_show?id=${ds.id}`);
    if (!res.ok) {
      console.error(`CKAN package_show failed for ${ds.id}: ${res.status}`);
      continue;
    }
    const payload = (await res.json()) as { result: { resources: CkanResource[] } };
    const resources = (payload.result?.resources ?? []).filter(
      (r) => r.format?.toUpperCase() === "CSV" && ds.filter(r.name),
    );

    for (const r of resources) {
      if (successUrls.has(r.url)) continue;
      const { year, month } = parseYearMonth(r.url, r.name, r.created ?? r.last_modified);
      toQueue.push({
        source: SOURCE, dataset: ds.id, resource_url: r.url, year, month, status: "pending",
        error: null,
      });
    }
  }

  let queued = 0;
  for (let i = 0; i < toQueue.length; i += 200) {
    const chunk = toQueue.slice(i, i + 200);
    const { error } = await supabaseAdmin
      .from("ingestion_queue")
      .upsert(chunk, { onConflict: "source,dataset,resource_url" });
    if (!error) queued += chunk.length;
  }
  return queued;
}

async function processQueueItem(item: {
  id: string;
  dataset: string;
  resource_url: string;
  year: number | null;
  month: number | null;
}) {
  await supabaseAdmin
    .from("ingestion_queue")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", item.id);

  try {
    // STREAMING: aggregate per (ods, year, month) without buffering the full CSV.
    // Memory stays ~O(unique pharmacies × months in file), not O(file size).
    type PField =
      | "pharmacy_first_payment" | "pharmacy_first_count" | "mcr_payment" | "ehc_items"
      | "methadone_items" | "smoking_cessation" | "gross_cost" | "final_payment"
      | "mcr_registrations" | "mcr_items" | "supervised_methadone_doses" | "smoking_cessation_payment";
    const PAYMENT_FIELDS: Record<PField, string[]> = {
      pharmacy_first_payment: ["PFPayment", "PharmacyFirstPayment", "Pharmacy_First_Payment", "PF_Payment", "PharmFirstPayment"],
      pharmacy_first_count: ["PFConsultations", "PFConsultation", "PharmacyFirstConsultations", "PFItems", "PharmacyFirstItems"],
      mcr_payment: ["MedicinesCareandReviewPayment", "MedicinesCareReviewPayment", "MCRPayment", "MCR_Payment", "MCR_Total", "CMSCapitationPayment"],
      mcr_registrations: ["MCRRegistrations", "MCR_Registrations", "MCRRegistered", "MedicinesCareReviewRegistrations"],
      mcr_items: ["MCRItems", "MCR_Items", "MedicinesCareReviewItems"],
      ehc_items: ["EHCItems", "EHC_Items", "EHC", "EmergencyContraception"],
      methadone_items: ["MethadoneItems", "Methadone_Items", "Methadone", "MethadoneSupervised", "MethadoneDispensingFeeNumber"],
      supervised_methadone_doses: ["SupervisedDispensingFeeNumber", "SupervisedConsumptions", "SupervisedMethadoneDoses"],
      smoking_cessation: ["SmokingCessationItems", "SmokingCessation", "Smoking_Cessation", "SC_Items"],
      smoking_cessation_payment: ["SmokingCessationPayment", "SC_Payment", "SmokingCessation_Payment"],
      gross_cost: ["GrossIngredientCost", "Gross_Cost", "GIC", "GrossIngCost", "GICTotal"],
      final_payment: ["FinalPayments", "FinalPayment", "Final_Payment", "TotalPayment", "NetPayment", "Total_Net_Payment"],
    };
    // PF service breakdown — friendly key → PHS *Consultations columns.
    // PFConsultations is the top-level acute service; PF{IPT,UTI,SIN,SHN,HAY}/BRC/EBC are sub-services.
    type PFService =
      | "acute" | "uti" | "impetigo" | "skin_infection" | "sexual_health"
      | "hayfever" | "bridging_contraception" | "emergency_contraception";
    const PF_SERVICE_FIELDS: Record<PFService, string[]> = {
      acute: ["PFConsultations"],
      uti: ["PFUTIConsultations"],
      impetigo: ["PFIPTConsultations"],
      skin_infection: ["PFSINConsultations"],
      sexual_health: ["PFSHNConsultations"],
      hayfever: ["PFHAYConsultations"],
      bridging_contraception: ["BRCConsultations"],
      emergency_contraception: ["EBCConsultations"],
    };
    const blankPayments = (): Record<PField, number> => ({
      pharmacy_first_payment: 0, pharmacy_first_count: 0, mcr_payment: 0, ehc_items: 0,
      methadone_items: 0, smoking_cessation: 0, gross_cost: 0, final_payment: 0,
      mcr_registrations: 0, mcr_items: 0, supervised_methadone_doses: 0, smoking_cessation_payment: 0,
    });
    const blankPFServices = (): Record<PFService, number> => ({
      acute: 0, uti: 0, impetigo: 0, skin_infection: 0,
      sexual_health: 0, hayfever: 0, bridging_contraception: 0, emergency_contraception: 0,
    });

    type Agg = {
      ods_code: string; name: string; region: string | null;
      year: number; month: number; items: number;
      payments: Record<PField, number>;
      pf_services: Record<PFService, number>;
    };
    const agg = new Map<string, Agg>();

    let headers: string[] = [];
    let headerIdx: Record<string, number> = {};
    let odsIdx = -1, nameIdx = -1, regionIdx = -1, itemsIdx = -1, monthIdx = -1, yearIdx = -1;
    const paymentIdxByField: Partial<Record<PField, number>> = {};
    const pfServiceIdxByField: Partial<Record<PFService, number>> = {};
    const missingPayments: PField[] = [];

    const findIdx = (variants: string[]): number => {
      for (const v of variants) {
        const norm = v.toLowerCase().replace(/[\s_]/g, "");
        const idx = headerIdx[norm];
        if (idx !== undefined) return idx;
      }
      return -1;
    };
    const num = (v: string | undefined) =>
      v ? Number(String(v).replace(/[£,"]/g, "").trim()) || 0 : 0;

    let rowCount = 0;
    await streamCsv(item.resource_url, (cells) => {
      if (rowCount === 0) {
        headers = cells.map((c) => c.trim());
        headerIdx = {};
        headers.forEach((h, i) => { headerIdx[h.toLowerCase().replace(/[\s_]/g, "")] = i; });
        odsIdx = findIdx(["DispensLocationCode", "DispenserLocationCode", "DispLocationCode", "DispenserLocation", "ContractorCode", "Contractor"]);
        nameIdx = findIdx(["DispensLocationName", "DispenserLocationName", "DispLocationName", "ContractorName"]);
        regionIdx = findIdx(["HBName", "HealthBoardName", "HBT", "HB"]);
        itemsIdx = findIdx(["NumberOfPaidItems", "PaidQuantity", "Items"]);
        monthIdx = findIdx(["PaidDateMonth"]);
        yearIdx = findIdx(["Year"]);
        for (const f of Object.keys(PAYMENT_FIELDS) as PField[]) {
          const idx = findIdx(PAYMENT_FIELDS[f]);
          if (idx >= 0) paymentIdxByField[f] = idx;
          else if (item.dataset === "community-pharmacy-contractor-activity") missingPayments.push(f);
        }
        for (const s of Object.keys(PF_SERVICE_FIELDS) as PFService[]) {
          const idx = findIdx(PF_SERVICE_FIELDS[s]);
          if (idx >= 0) pfServiceIdxByField[s] = idx;
        }
        rowCount++;
        return;
      }
      rowCount++;
      if (cells.length === 1 && cells[0] === "") return;
      if (odsIdx < 0) return;
      const ods = (cells[odsIdx] ?? "").trim();
      if (!ods) return;

      let year = item.year ?? 0;
      let month = item.month ?? 0;
      if (monthIdx >= 0) {
        const s = (cells[monthIdx] ?? "").trim();
        if (/^\d{6}$/.test(s)) { year = +s.slice(0, 4); month = +s.slice(4, 6); }
      }
      if (yearIdx >= 0) {
        const ys = (cells[yearIdx] ?? "").trim();
        if (/^\d{4}$/.test(ys)) {
          year = +ys;
          if (monthIdx < 0) month = 0;
        }
      }
      if (!year) return;

      const key = `${ods}|${year}|${month}`;
      let cur = agg.get(key);
      if (!cur) {
        cur = {
          ods_code: ods,
          name: nameIdx >= 0 ? ((cells[nameIdx] ?? "").trim() || ods) : ods,
          region: regionIdx >= 0 ? ((cells[regionIdx] ?? "").trim() || null) : null,
          year, month, items: 0, payments: blankPayments(),
        };
        agg.set(key, cur);
      }
      if (itemsIdx >= 0) cur.items += num(cells[itemsIdx]);
      for (const f of Object.keys(PAYMENT_FIELDS) as PField[]) {
        const idx = paymentIdxByField[f];
        if (idx !== undefined) cur.payments[f] += num(cells[idx]);
      }
    });

    if (odsIdx < 0) throw new Error("No ods code column found");
    if (rowCount <= 1) throw new Error("Empty CSV");

    // Log missing payment columns once per file (not per row)
    for (const f of missingPayments) {
      await supabaseAdmin.from("schema_alerts").insert({
        source: SOURCE, dataset: item.dataset, resource_url: item.resource_url,
        missing_field: f, tried_variants: PAYMENT_FIELDS[f], available_headers: headers,
      });
    }




    // Upsert pharmacies in chunks
    const pharmacies = Array.from(
      new Map(
        Array.from(agg.values()).map((a) => [a.ods_code, {
          ods_code: a.ods_code,
          name: a.name,
          region: a.region,
          country: "Scotland",
        }]),
      ).values(),
    );

    for (let i = 0; i < pharmacies.length; i += 500) {
      const { error } = await supabaseAdmin
        .from("pharmacies")
        .upsert(pharmacies.slice(i, i + 500), { onConflict: "ods_code" });
      if (error) throw error;
    }

    // Look up pharmacy ids
    const odsList = pharmacies.map((p) => p.ods_code);
    const idMap = new Map<string, string>();
    for (let i = 0; i < odsList.length; i += 500) {
      const slice = odsList.slice(i, i + 500);
      const { data, error } = await supabaseAdmin
        .from("pharmacies")
        .select("id, ods_code")
        .in("ods_code", slice);
      if (error) throw error;
      for (const r of data ?? []) idMap.set(r.ods_code, r.id);
    }

    // Build dispensing rows
    const dispRows = Array.from(agg.values())
      .filter((a) => idMap.has(a.ods_code) && a.month > 0)
      .map((a) => ({
        pharmacy_id: idMap.get(a.ods_code)!,
        year: a.year,
        month: a.month,
        items_dispensed: a.items,
        gross_cost: a.payments.gross_cost,
        pharmacy_first_payment: a.payments.pharmacy_first_payment,
        pharmacy_first_count: Math.round(a.payments.pharmacy_first_count),
        mcr_payment: a.payments.mcr_payment,
        mcr_registrations: Math.round(a.payments.mcr_registrations),
        mcr_items: Math.round(a.payments.mcr_items),
        ehc_items: Math.round(a.payments.ehc_items),
        methadone_items: Math.round(a.payments.methadone_items),
        supervised_methadone_doses: Math.round(a.payments.supervised_methadone_doses),
        smoking_cessation: Math.round(a.payments.smoking_cessation),
        smoking_cessation_payment: a.payments.smoking_cessation_payment,
        final_payment: a.payments.final_payment,
        is_actual_payment: a.payments.final_payment > 0,
        data_source: SOURCE,
        is_provisional: isProvisional(a.year, a.month),
      }));

    // Contractor-activity is the authoritative source for per-pharmacy payment data,
    // so it does a full upsert. Other datasets only insert rows that don't already
    // exist (ignoreDuplicates) so they never overwrite verified payment data.
    const isAuthoritative = item.dataset === "community-pharmacy-contractor-activity";
    let inserted = 0;
    for (let i = 0; i < dispRows.length; i += 500) {
      const slice = dispRows.slice(i, i + 500);
      const { error } = await supabaseAdmin
        .from("dispensing_data")
        .upsert(slice, { onConflict: "pharmacy_id,year,month", ignoreDuplicates: !isAuthoritative });
      if (error) throw error;
      inserted += slice.length;
    }

    await supabaseAdmin.from("ingestion_log").insert({
      source: SOURCE,
      dataset: item.dataset,
      resource_url: item.resource_url,
      year: item.year,
      month: item.month,
      status: "success",
      rows_ingested: inserted,
    });
    await supabaseAdmin
      .from("ingestion_queue")
      .update({ status: "done", finished_at: new Date().toISOString() })
      .eq("id", item.id);

    return { inserted };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ingest-scotland] ${item.resource_url}`, msg);
    await supabaseAdmin.from("ingestion_log").insert({
      source: SOURCE,
      dataset: item.dataset,
      resource_url: item.resource_url,
      year: item.year,
      month: item.month,
      status: "failed",
      error: msg,
    });
    await supabaseAdmin
      .from("ingestion_queue")
      .update({ status: "failed", error: msg, finished_at: new Date().toISOString() })
      .eq("id", item.id);
    return { error: msg };
  }
}

// Priority order: contractor-activity (payment data) first, then prescribed-dispensed,
// then the heavy prescriptions-in-the-community files.
const DATASET_PRIORITY = [
  "community-pharmacy-contractor-activity",
  "prescribed-dispensed",
  "prescriptions-in-the-community",
];

async function runBatch(batchSize = 3) {
  for (const ds of DATASET_PRIORITY) {
    const { data: queue, error } = await supabaseAdmin
      .from("ingestion_queue")
      .select("id, dataset, resource_url, year, month")
      .eq("source", SOURCE)
      .eq("status", "pending")
      .eq("dataset", ds)
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .limit(batchSize);
    if (error) throw error;
    if (queue?.length) return Promise.all(queue.map(processQueueItem));
  }
  return [];
}


export const Route = createFileRoute("/api/public/hooks/ingest-scotland")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const reingest = url.searchParams.get("reingest") === "1";
          let reset = 0;
          if (reingest) {
            await supabaseAdmin.from("ingestion_log").delete().eq("source", SOURCE);
            const { count } = await supabaseAdmin
              .from("ingestion_queue")
              .delete({ count: "exact" })
              .eq("source", SOURCE);
            reset = count ?? 0;
          }
          const queued = await discover();
          // Process at most 1 item per request to stay under the proxy timeout.
          // The button can be clicked repeatedly (or polled) to drain the queue.
          const results = reingest ? [] : await runBatch(1);
          const { count: pending } = await supabaseAdmin
            .from("ingestion_queue")
            .select("id", { count: "exact", head: true })
            .eq("source", SOURCE)
            .eq("status", "pending");
          return Response.json({
            ok: true,
            reingest,
            reset,
            queued,
            processed: results.length,
            results,
            pending,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[ingest-scotland] fatal", msg);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
      GET: async () => {
        const { count: pending } = await supabaseAdmin
          .from("ingestion_queue")
          .select("id", { count: "exact", head: true })
          .eq("source", SOURCE)
          .eq("status", "pending");
        return Response.json({ ok: true, pending });
      },
    },
  },
});

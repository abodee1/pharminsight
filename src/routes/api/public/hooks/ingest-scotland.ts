import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeHookRequest } from "@/lib/hook-auth.server";

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

// PHS Scotland Health Board codes → full NHS names
const SCOTLAND_HB_CODES: Record<string, string> = {
  S08000015: "NHS Ayrshire and Arran",
  S08000016: "NHS Borders",
  S08000017: "NHS Dumfries and Galloway",
  S08000018: "NHS Fife",
  S08000019: "NHS Forth Valley",
  S08000020: "NHS Grampian",
  S08000021: "NHS Greater Glasgow and Clyde",
  S08000022: "NHS Highland",
  S08000023: "NHS Lanarkshire",
  S08000024: "NHS Lothian",
  S08000025: "NHS Orkney",
  S08000026: "NHS Shetland",
  S08000027: "NHS Tayside",
  S08000028: "NHS Western Isles",
  // Post-2019 remapped codes
  S08000029: "NHS Fife",
  S08000030: "NHS Tayside",
  S08000031: "NHS Greater Glasgow and Clyde",
  S08000032: "NHS Lanarkshire",
};

function resolveScotlandHB(raw: string | null): string | null {
  if (!raw) return null;
  return SCOTLAND_HB_CODES[raw.toUpperCase()] ?? raw;
}

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
  if (!year || !month) return false;
  // Provisional if within the last 3 months — PHS payment auditing lag.
  const now = new Date();
  const cutoffMonth = now.getUTCMonth() + 1 - 3;
  const adjYear = cutoffMonth <= 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const adjMonth = cutoffMonth <= 0 ? cutoffMonth + 12 : cutoffMonth;
  if (year > adjYear) return true;
  if (year === adjYear && month >= adjMonth) return true;
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
      | "mcr_registrations" | "mcr_items" | "supervised_methadone_doses" | "smoking_cessation_payment"
      | "eps_items";
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
      // Scotland uses PIS (Prescribing Information System) for all dispensing — no paper vs EPS split
      // in published CSVs. If PHS ever adds an explicit column we pick it up; otherwise falls back to items.
      eps_items: ["EPSItems", "EPS_Items", "ElectronicItems", "ElectronicPrescriptionItems", "NumberOfEPSItems"],
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
      eps_items: 0,
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
        regionIdx = findIdx(["HBName", "HealthBoardName", "HBTName", "HBT", "HB", "HBCode", "HealthBoard", "HealthBoardCode"]);
        itemsIdx = findIdx(["NumberOfPaidItems", "PaidQuantity", "Items"]);
        monthIdx = findIdx(["PaidDateMonth"]);
        yearIdx = findIdx(["Year"]);
        // These payment amounts are not published in community-pharmacy-contractor-activity
        // (they're in a separate BSO payments file not on CKAN). Suppress alerts for them.
        const KNOWN_ABSENT_IN_CONTRACTOR_ACTIVITY: PField[] = ["pharmacy_first_payment", "mcr_payment"];
        for (const f of Object.keys(PAYMENT_FIELDS) as PField[]) {
          const idx = findIdx(PAYMENT_FIELDS[f]);
          if (idx >= 0) paymentIdxByField[f] = idx;
          else if (
            item.dataset === "community-pharmacy-contractor-activity" &&
            !KNOWN_ABSENT_IN_CONTRACTOR_ACTIVITY.includes(f)
          ) missingPayments.push(f);
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
          region: resolveScotlandHB(regionIdx >= 0 ? ((cells[regionIdx] ?? "").trim() || null) : null),
          year, month, items: 0, payments: blankPayments(), pf_services: blankPFServices(),
        };
        agg.set(key, cur);
      }
      const row = cur;
      if (itemsIdx >= 0) row.items += num(cells[itemsIdx]);
      for (const f of Object.keys(PAYMENT_FIELDS) as PField[]) {
        const idx = paymentIdxByField[f];
        if (idx !== undefined) row.payments[f] += num(cells[idx]);
      }
      for (const s of Object.keys(PF_SERVICE_FIELDS) as PFService[]) {
        const idx = pfServiceIdxByField[s];
        if (idx !== undefined) row.pf_services[s] += num(cells[idx]);
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




    // Build upsert payload. CRITICAL: when the CSV row has no real name
    // (so `a.name === a.ods_code`) or no resolved health board, we must NOT
    // downgrade an existing row's good name/region. We split into two passes:
    //   - "rich" rows: full upsert (CSV had a name AND a HB)
    //   - "poor" rows: insert-only (ignoreDuplicates) so the row is created
    //     if missing, but existing values are preserved.
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

    const rich = pharmacies.filter((p) => p.name && p.name !== p.ods_code);
    const poor = pharmacies.filter((p) => !p.name || p.name === p.ods_code);

    // Rich pass: full upsert without region (region handled separately below)
    for (let i = 0; i < rich.length; i += 500) {
      const rows = rich.slice(i, i + 500).map(({ region, ...r }) => r);
      const { error } = await supabaseAdmin
        .from("pharmacies")
        .upsert(rows, { onConflict: "ods_code" });
      if (error) throw new Error(error.message || JSON.stringify(error));
    }

    // Poor pass: insert only, never overwrite an existing real name.
    for (let i = 0; i < poor.length; i += 500) {
      const rows = poor.slice(i, i + 500).map(({ region, ...r }) => r);
      const { error } = await supabaseAdmin
        .from("pharmacies")
        .upsert(rows, { onConflict: "ods_code", ignoreDuplicates: true });
      if (error) throw new Error(error.message || JSON.stringify(error));
    }

    // Update region grouped by health board — only when we actually resolved one,
    // so we never overwrite a good value with null
    const byHB = new Map<string, string[]>();
    for (const p of pharmacies) {
      if (p.region) {
        if (!byHB.has(p.region)) byHB.set(p.region, []);
        byHB.get(p.region)!.push(p.ods_code);
      }
    }
    for (const [region, codes] of byHB) {
      for (let i = 0; i < codes.length; i += 500) {
        const { error } = await supabaseAdmin
          .from("pharmacies")
          .update({ region })
          .in("ods_code", codes.slice(i, i + 500));
        if (error) throw new Error(error.message || JSON.stringify(error));
      }
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
        // PIS covers all Scottish dispensing electronically; use explicit column if PHS ever adds one,
        // otherwise treat items_dispensed as the EPS equivalent (accurate for Scotland).
        eps_items: Math.round(a.payments.eps_items || a.items),
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
        pharmacy_first_services: Object.fromEntries(
          Object.entries(a.pf_services).map(([k, v]) => [k, Math.round(v)]),
        ),
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

async function runBatch() {
  // community-pharmacy-contractor-activity and prescribed-dispensed are large multi-pharmacy
  // annual files — process 1 at a time to stay safely under the proxy timeout.
  // prescriptions-in-the-community Dispenser Location files are small (~1,800 rows for Scotland)
  // so 3 in parallel is safe and drains the backfill queue 3× faster.
  const batchSizes: Record<string, number> = {
    "community-pharmacy-contractor-activity": 1,
    "prescribed-dispensed": 1,
    "prescriptions-in-the-community": 3,
  };
  for (const ds of DATASET_PRIORITY) {
    const batchSize = batchSizes[ds] ?? 1;
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
        const auth = await authorizeHookRequest(request);
        if (!auth.ok) return new Response(auth.message, { status: auth.status });
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
          const results = reingest ? [] : await runBatch();
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

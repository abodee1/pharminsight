import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeHookRequest } from "@/lib/hook-auth.server";

const SOURCE = "NHSBSA";
const CKAN_BASE = "https://opendata.nhsbsa.net/api/3/action";
const DATASET = "pharmacy-and-appliance-contractor-dispensing-data";

type CkanResource = { id: string; name: string; url: string; format: string };

function parseYearMonth(name: string, url: string) {
  // dispensing_data_YYYYMM or DISPENSING_DATA_YYYYMM
  const m = (url + " " + name).match(/(\d{4})(\d{2})/);
  if (m) return { year: +m[1], month: +m[2] };
  return { year: null as number | null, month: null as number | null };
}

// Streaming CSV (quoted-field aware)
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
        if (ch === '"') { if (t[i+1] === '"') { cell += '"'; i++; } else q = false; }
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

// CONTENT_GROUP|CONTENT → our schema column
type Bucket =
  | "items_dispensed" | "eps_items" | "nms_count" | "flu_vaccinations"
  | "pharmacy_first_count";
const CONTENT_MAP: Record<string, Bucket> = {
  "Prescription Count|Items": "items_dispensed",
  "Prescription Count|Items processed via Electronic Prescription Service (EPS)": "eps_items",
  "Advanced Services|New Medicine Service (NMS) interventions declared": "nms_count",
  "Advanced Services|Community Pharmacy Adult Influenza Administered Fees": "flu_vaccinations",
  "Advanced Services|Community Pharmacy Childhood Influenza Administered Fees": "flu_vaccinations",
};
// Pharmacy First sub-services → PF service breakdown JSONB key
const PF_MAP: Record<string, string> = {
  "Advanced Services|Pharmacy First Clinical Pathways Consultations - Acute Otitis Media": "otitis_media",
  "Advanced Services|Pharmacy First Clinical Pathways Consultations - Acute Sore Throat": "sore_throat",
  "Advanced Services|Pharmacy First Clinical Pathways Consultations - Impetigo": "impetigo",
  "Advanced Services|Pharmacy First Clinical Pathways Consultations - Infected Insect Bites": "insect_bites",
  "Advanced Services|Pharmacy First Clinical Pathways Consultations - Shingles": "shingles",
  "Advanced Services|Pharmacy First Clinical Pathways Consultations - Sinusitis": "sinusitis",
  "Advanced Services|Pharmacy First Clinical Pathways Consultations - Uncomplicated UTI": "uti",
  "Advanced Services|Pharmacy First Minor Illness Referral Consultations": "minor_illness",
  "Advanced Services|Pharmacy First Urgent Medicine Supply Consultations": "urgent_supply",
};

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
    for (const r of data ?? []) if (["pending","processing","done"].includes(r.status)) skip.add(r.resource_url);
  }

  const res = await fetch(`${CKAN_BASE}/package_show?id=${DATASET}`);
  if (!res.ok) throw new Error(`CKAN ${res.status}`);
  const payload = (await res.json()) as { result: { resources: CkanResource[] } };
  const resources = (payload.result?.resources ?? []).filter((r) => r.format?.toUpperCase() === "CSV");

  const queue: Array<{ source: string; dataset: string; resource_url: string; year: number | null; month: number | null; status: string; error: string | null }> = [];
  for (const r of resources) {
    if (skip.has(r.url)) continue;
    const { year, month } = parseYearMonth(r.name, r.url);
    queue.push({ source: SOURCE, dataset: DATASET, resource_url: r.url, year, month, status: "pending", error: null });
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

async function processQueueItem(item: { id: string; resource_url: string; year: number | null; month: number | null }) {
  await supabaseAdmin.from("ingestion_queue")
    .update({ status: "processing", started_at: new Date().toISOString() }).eq("id", item.id);

  try {
    type Agg = {
      ods_code: string; name: string; region: string | null; postcode: string | null; address: string | null;
      year: number; month: number;
      items_dispensed: number; eps_items: number; nms_count: number;
      flu_vaccinations: number; pharmacy_first_count: number;
      pf_services: Record<string, number>;
    };
    const agg = new Map<string, Agg>();
    let headers: string[] = [];
    let idx: Record<string, number> = {};
    let rowCount = 0;

    await streamCsv(item.resource_url, (cells) => {
      if (rowCount++ === 0) {
        headers = cells.map((c) => c.trim());
        headers.forEach((h, i) => { idx[h.toUpperCase()] = i; });
        return;
      }
      if (cells.length < headers.length - 2) return;
      const ym = (cells[idx["YEAR_MONTH"]] ?? "").trim(); // YYYY-MM
      if (!/^\d{4}-\d{2}$/.test(ym)) return;
      const year = +ym.slice(0, 4);
      const month = +ym.slice(5, 7);
      const ods = (cells[idx["CONTRACTOR_CODE"]] ?? "").trim();
      if (!ods) return;
      const acctType = (cells[idx["PHARMACY_ACCOUNT_TYPE"]] ?? "").trim();
      // Only community pharmacy/appliance contractors (skip dispensing doctors etc.)
      if (acctType && !/Pharmacy|Appliance/i.test(acctType)) return;
      const cg = (cells[idx["CONTENT_GROUP"]] ?? "").trim();
      const c = (cells[idx["CONTENT"]] ?? "").trim();
      const value = Number((cells[idx["VALUE"]] ?? "0").replace(/[£,]/g, "")) || 0;

      const key = `${ods}|${year}|${month}`;
      let cur = agg.get(key);
      if (!cur) {
        cur = {
          ods_code: ods,
          name: (cells[idx["CONTRACTOR_NAME"]] ?? "").trim() || ods,
          region: (cells[idx["ICB_NAME"]] ?? "").trim() || null,
          postcode: (cells[idx["POSTCODE"]] ?? "").trim() || null,
          address: [
            cells[idx["ADDRESS_1"]], cells[idx["ADDRESS_2"]],
            cells[idx["ADDRESS_3"]], cells[idx["ADDRESS_4"]],
          ].map((s) => (s ?? "").trim()).filter(Boolean).join(", ") || null,
          year, month,
          items_dispensed: 0, eps_items: 0, nms_count: 0, flu_vaccinations: 0,
          pharmacy_first_count: 0, pf_services: {},
        };
        agg.set(key, cur);
      }
      const mapKey = `${cg}|${c}`;
      const bucket = CONTENT_MAP[mapKey];
      if (bucket) cur[bucket] += value;
      const pfKey = PF_MAP[mapKey];
      if (pfKey) {
        cur.pf_services[pfKey] = (cur.pf_services[pfKey] || 0) + value;
        cur.pharmacy_first_count += value;
      }
    });

    if (rowCount <= 1) throw new Error("Empty CSV");

    const pharmacies = Array.from(
      new Map(Array.from(agg.values()).map((a) => [a.ods_code, {
        ods_code: a.ods_code, name: a.name, region: a.region,
        country: "England", address: a.address, postcode: a.postcode,
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
        items_dispensed: Math.round(a.items_dispensed),
        eps_items: Math.round(a.eps_items),
        nms_count: Math.round(a.nms_count),
        flu_vaccinations: Math.round(a.flu_vaccinations),
        pharmacy_first_count: Math.round(a.pharmacy_first_count),
        pharmacy_first_services: Object.fromEntries(
          Object.entries(a.pf_services).map(([k, v]) => [k, Math.round(v)]),
        ),
        data_source: SOURCE,
        is_provisional: false,
        is_actual_payment: false,
      }));

    let inserted = 0;
    for (let i = 0; i < dispRows.length; i += 500) {
      const slice = dispRows.slice(i, i + 500);
      const { error } = await supabaseAdmin.from("dispensing_data")
        .upsert(slice, { onConflict: "pharmacy_id,year,month" });
      if (error) throw error;
      inserted += slice.length;
    }

    await supabaseAdmin.from("ingestion_log").insert({
      source: SOURCE, dataset: DATASET, resource_url: item.resource_url,
      year: item.year, month: item.month, status: "success", rows_ingested: inserted,
    });
    await supabaseAdmin.from("ingestion_queue")
      .update({ status: "done", finished_at: new Date().toISOString() }).eq("id", item.id);

    return { inserted };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ingest-england] ${item.resource_url}`, msg);
    await supabaseAdmin.from("ingestion_log").insert({
      source: SOURCE, dataset: DATASET, resource_url: item.resource_url,
      year: item.year, month: item.month, status: "failed", error: msg,
    });
    await supabaseAdmin.from("ingestion_queue")
      .update({ status: "failed", error: msg, finished_at: new Date().toISOString() }).eq("id", item.id);
    return { error: msg };
  }
}

async function runBatch(batchSize = 1) {
  const { data: queue, error } = await supabaseAdmin.from("ingestion_queue")
    .select("id, resource_url, year, month")
    .eq("source", SOURCE).eq("status", "pending")
    .order("year", { ascending: false }).order("month", { ascending: false })
    .limit(batchSize);
  if (error) throw error;
  return queue?.length ? Promise.all(queue.map(processQueueItem)) : [];
}

export const Route = createFileRoute("/api/public/hooks/ingest-england")({
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
          console.error("[ingest-england] fatal", msg);
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

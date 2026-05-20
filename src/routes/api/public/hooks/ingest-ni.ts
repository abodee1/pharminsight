import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOURCE = "HSCNI_BSO";
const CKAN_BASE = "https://ckan.publishing.service.gov.uk/api/3/action";
const DATASET = "dispensing-by-contractor";

type CkanResource = { id: string; name: string; url: string; format: string };

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parseYearMonth(name: string, url: string) {
  const text = (name + " " + url).toLowerCase();
  const m = text.match(/(january|february|march|april|may|june|july|august|september|october|november|december)[ ,-]+(\d{4})/);
  if (m) return { year: +m[2], month: MONTHS[m[1]] };
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
  const resources = (payload.result?.resources ?? []).filter(
    (r) => r.format?.toUpperCase() === "CSV" && /dispensed items by gp and pharmacy/i.test(r.name),
  );

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
    // Each row: Practice + Chemist (pharmacy code) + Items.
    // Aggregate items per Chemist per month.
    type Agg = {
      ods_code: string; name: string; address: string | null; postcode: string | null;
      year: number; month: number; items: number;
    };
    const agg = new Map<string, Agg>();
    let headers: string[] = [];
    let idx: Record<string, number> = {};
    let rowCount = 0;

    await streamCsv(item.resource_url, (cells) => {
      if (rowCount++ === 0) {
        headers = cells.map((c) => c.trim());
        headers.forEach((h, i) => { idx[h.toLowerCase().replace(/\s+/g, "")] = i; });
        return;
      }
      if (cells.length < 5) return;
      const chemist = (cells[idx["chemist"]] ?? "").trim();
      if (!chemist || chemist === "0") return;
      const ods = `NI${chemist}`;
      let year = item.year ?? 0;
      let month = item.month ?? 0;
      const ys = (cells[idx["year"]] ?? "").trim();
      const ms = (cells[idx["month"]] ?? "").trim();
      if (/^\d{4}$/.test(ys)) year = +ys;
      if (/^\d{1,2}$/.test(ms)) month = +ms;
      if (!year || !month) return;
      const items = Number((cells[idx["numberofitems"]] ?? "0").replace(/,/g, "")) || 0;

      const key = `${ods}|${year}|${month}`;
      let cur = agg.get(key);
      if (!cur) {
        cur = {
          ods_code: ods,
          name: (cells[idx["contractorname"]] ?? "").trim() || ods,
          address: [
            cells[idx["contractoraddressline1"]], cells[idx["contractoraddressline2"]],
            cells[idx["contractoraddressline3"]], cells[idx["contractoraddressline4"]],
          ].map((s) => (s ?? "").trim().replace(/-+$/, "").trim()).filter(Boolean).join(", ") || null,
          postcode: (cells[idx["contractorpostcode"]] ?? "").trim() || null,
          year, month, items: 0,
        };
        agg.set(key, cur);
      }
      cur.items += items;
    });

    if (rowCount <= 1) throw new Error("Empty CSV");

    const pharmacies = Array.from(
      new Map(Array.from(agg.values()).map((a) => [a.ods_code, {
        ods_code: a.ods_code, name: a.name,
        region: null, country: "Northern Ireland",
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
    console.error(`[ingest-ni] ${item.resource_url}`, msg);
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

export const Route = createFileRoute("/api/public/hooks/ingest-ni")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
          console.error("[ingest-ni] fatal", msg);
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
